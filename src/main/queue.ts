import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AddResult, QueueAction, QueueTask } from '../shared/types'
import type { ConnectionTarget } from './connection.ts'
import { explainError } from './connection.ts'
import { isPermanent, uploadFile, type UploadOptions, type UploadOutcome } from './transfer.ts'
import { agencyAccepts } from '../shared/presets.ts'

export type ResolvedAccount = { name: string; color: string; agency?: string; target: ConnectionTarget }

export type QueueDeps = {
  /** File JSON tempat antrean disimpan. */
  file: string
  /** Data akun + password; null kalau akun sudah dihapus. */
  resolve: (accountId: string) => Promise<ResolvedAccount | null>
  onChange: (tasks: QueueTask[]) => void
  /** Dipanggil sekali saat tugas berhasil atau gagal permanen (untuk riwayat). */
  onFinished?: (task: QueueTask, agency: string) => void
  /** Sudah pernah berhasil dikirim ke akun ini? (cegah dobel) */
  wasSent?: (accountId: string, fileName: string, size: number) => boolean
  upload?: (t: ConnectionTarget, localPath: string, opts: UploadOptions) => Promise<UploadOutcome>
  /** Jeda sebelum coba ulang ke-1, ke-2, ke-3 (ms). */
  retryDelays?: number[]
  perAccount?: number
}

type Running = { ctl: AbortController; reason?: 'pause' | 'cancel' }

const MAX_TOTAL = 10
const ACTIVE: QueueTask['status'][] = ['queued', 'uploading', 'retrying', 'paused']

export class UploadQueue {
  private tasks: QueueTask[] = []
  private running = new Map<string, Running>()
  private timers = new Map<string, NodeJS.Timeout>()
  private emitTimer: NodeJS.Timeout | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private saving: Promise<void> = Promise.resolve()
  private perAccount: number
  private stopping = false
  private readonly retryDelays: number[]
  private readonly upload: NonNullable<QueueDeps['upload']>

  private readonly deps: QueueDeps

  constructor(deps: QueueDeps) {
    this.deps = deps
    this.perAccount = deps.perAccount ?? 2
    this.retryDelays = deps.retryDelays ?? [5_000, 20_000, 60_000]
    this.upload = deps.upload ?? uploadFile
  }

  /** Muat antrean dari disk. Upload yang terputus karena aplikasi ditutup dilanjutkan lagi. */
  async init(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.deps.file, 'utf8')) as { tasks?: QueueTask[] }
      this.tasks = Array.isArray(raw.tasks) ? raw.tasks : []
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Antrean rusak, mulai kosong:', err)
      this.tasks = []
    }
    for (const t of this.tasks) {
      if (t.status === 'uploading' || t.status === 'retrying') {
        t.status = 'queued'
        t.speed = 0
        t.nextRetryAt = undefined
      }
    }
    this.pump()
  }

  list(): QueueTask[] {
    return this.tasks.map((t) => ({ ...t }))
  }

  activeCount(): number {
    return this.tasks.filter((t) => t.status === 'uploading' || t.status === 'queued' || t.status === 'retrying').length
  }

  setPerAccount(n: number): void {
    this.perAccount = Math.max(1, Math.min(5, Math.round(n)))
    this.pump()
  }

  async add(paths: string[], accountIds: string[], force = false): Promise<AddResult> {
    const result: AddResult = { added: 0, duplicates: 0, sameName: 0, missing: 0, alreadySent: 0, wrongType: 0 }
    const accounts = new Map<string, ResolvedAccount>()
    for (const id of new Set(accountIds)) {
      const acc = await this.deps.resolve(id)
      if (acc) accounts.set(id, acc)
    }
    const now = Date.now()
    for (const filePath of new Set(paths)) {
      let size: number
      try {
        const st = await fs.stat(filePath)
        if (!st.isFile()) throw new Error('bukan file')
        size = st.size
      } catch {
        result.missing += accounts.size
        continue
      }
      const fileName = path.basename(filePath)
      const ext = path.extname(fileName).slice(1).toLowerCase()
      for (const [accountId, acc] of accounts) {
        // Server agensi menolak jenis file ini (mis. PNG ke Freepik → "permission denied"); jangan dikirim.
        const rule = agencyAccepts(acc.agency)
        if (rule && !rule.exts.includes(ext)) {
          result.wrongType++
          result.wrongTypeNote ??= `${rule.name} hanya menerima ${rule.exts.filter((x) => x !== 'jpeg').map((x) => x.toUpperCase()).join(', ')} lewat FTP`
          continue
        }
        if (!force && this.deps.wasSent?.(accountId, fileName, size)) {
          result.alreadySent++
          continue
        }
        const pending = this.tasks.filter((t) => t.accountId === accountId && ACTIVE.includes(t.status))
        if (pending.some((t) => t.filePath === filePath)) {
          result.duplicates++
          continue
        }
        // Dua file berbeda dengan nama sama akan saling menimpa di server.
        if (pending.some((t) => t.fileName.toLowerCase() === fileName.toLowerCase())) {
          result.sameName++
          continue
        }
        this.tasks.push({
          id: randomUUID(),
          filePath,
          fileName,
          size,
          accountId,
          accountName: acc.name,
          accountColor: acc.color,
          status: 'queued',
          sent: 0,
          speed: 0,
          attempt: 0,
          maxAttempts: this.retryDelays.length + 1,
          addedAt: now
        })
        result.added++
      }
    }
    this.changed(true)
    this.pump()
    return result
  }

  action(action: QueueAction, ids: string[]): void {
    for (const id of ids) {
      const t = this.tasks.find((x) => x.id === id)
      if (!t) continue
      const run = this.running.get(id)
      switch (action) {
        case 'pause':
          if (run) {
            run.reason = 'pause'
            run.ctl.abort()
          } else if (t.status === 'queued' || t.status === 'retrying') {
            this.clearTimer(id)
            t.status = 'paused'
            t.nextRetryAt = undefined
          }
          break
        case 'resume':
          if (t.status === 'paused') {
            t.status = 'queued'
            t.attempt = 0
          }
          break
        case 'cancel':
          if (run) {
            run.reason = 'cancel'
            run.ctl.abort()
          } else if (t.status !== 'done' && t.status !== 'canceled') {
            this.clearTimer(id)
            t.status = 'canceled'
            t.nextRetryAt = undefined
            t.speed = 0
          }
          break
        case 'retry':
          if (t.status === 'failed' || t.status === 'canceled') {
            t.status = 'queued'
            t.attempt = 0
            t.error = undefined
            t.errorDetail = undefined
          }
          break
        case 'remove':
          if (run) {
            run.reason = 'cancel'
            run.ctl.abort()
          }
          this.clearTimer(id)
          this.tasks = this.tasks.filter((x) => x.id !== id)
          break
      }
    }
    this.changed(true)
    this.pump()
  }

  pauseAll(paused: boolean): void {
    const ids = this.tasks
      .filter((t) => (paused ? ['queued', 'uploading', 'retrying'].includes(t.status) : t.status === 'paused'))
      .map((t) => t.id)
    this.action(paused ? 'pause' : 'resume', ids)
  }

  clearDone(): void {
    this.tasks = this.tasks.filter((t) => t.status !== 'done')
    this.changed(true)
  }

  /** Tunggu semua penyimpanan selesai (dipakai saat aplikasi ditutup dan di tes). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.save()
    }
    await this.saving
  }

  /** Hentikan semua upload tanpa mengubah status (dipakai saat aplikasi ditutup). */
  async shutdown(): Promise<void> {
    this.stopping = true
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    for (const run of this.running.values()) run.ctl.abort()
    await this.flush()
  }

  private pump(): void {
    const perAcc = new Map<string, number>()
    for (const id of this.running.keys()) {
      const t = this.tasks.find((x) => x.id === id)
      if (t) perAcc.set(t.accountId, (perAcc.get(t.accountId) ?? 0) + 1)
    }
    for (const t of this.tasks) {
      if (this.running.size >= MAX_TOTAL) break
      if (t.status !== 'queued') continue
      const n = perAcc.get(t.accountId) ?? 0
      if (n >= this.perAccount) continue
      perAcc.set(t.accountId, n + 1)
      void this.run(t)
    }
  }

  private async run(t: QueueTask): Promise<void> {
    const run: Running = { ctl: new AbortController() }
    this.running.set(t.id, run)
    t.status = 'uploading'
    t.attempt++
    t.error = undefined
    t.errorDetail = undefined
    t.nextRetryAt = undefined
    t.speed = 0
    t.startedAt ??= Date.now()
    this.changed(true)

    let sample = { at: Date.now(), bytes: t.sent }
    let agency = ''
    const attemptStart = Date.now()
    try {
      const acc = await this.deps.resolve(t.accountId)
      agency = acc?.agency ?? ''
      if (!acc) throw Object.assign(new Error('Akun sudah dihapus, atau password-nya belum diisi (cek halaman Akun).'), { permanent: true, friendly: true })
      let st
      try {
        st = await fs.stat(t.filePath)
      } catch {
        throw Object.assign(new Error('File asli tidak ditemukan. Mungkin sudah dipindah atau dihapus.'), { permanent: true, friendly: true })
      }
      // File berubah sejak masuk antrean: kirim ulang dari awal.
      const resume = t.sent > 0 && st.size === t.size
      if (st.size !== t.size) {
        t.size = st.size
        t.sent = 0
      }
      sample = { at: Date.now(), bytes: t.sent }

      const out = await this.upload(acc.target, t.filePath, {
        signal: run.ctl.signal,
        resume,
        onProgress: (sent) => {
          t.sent = sent
          const now = Date.now()
          const dt = now - sample.at
          if (dt >= 1000 || sent < sample.bytes) {
            const inst = sent >= sample.bytes ? ((sent - sample.bytes) * 1000) / dt : 0
            t.speed = t.speed > 0 ? t.speed * 0.6 + inst * 0.4 : inst
            sample = { at: now, bytes: sent }
          }
          this.changed(false)
        }
      })
      t.status = 'done'
      t.sent = t.size
      t.speed = 0
      t.finishedAt = Date.now()
      t.resumedFrom = out.resumedFrom > 0 ? out.resumedFrom : undefined
      t.lastAttemptMs = Date.now() - attemptStart
      this.deps.onFinished?.(t, agency)
    } catch (err) {
      t.speed = 0
      if (this.stopping) {
        t.status = 'queued'
      } else if (run.reason === 'pause') {
        t.status = 'paused'
      } else if (run.reason === 'cancel') {
        t.status = 'canceled'
      } else {
        const friendly = (err as { friendly?: boolean }).friendly
        const { message, detail } = friendly ? { message: (err as Error).message, detail: '' } : explainError(err)
        t.error = message
        t.errorDetail = detail || undefined
        if (!isPermanent(err) && t.attempt < t.maxAttempts) {
          const delay = this.retryDelays[t.attempt - 1] ?? this.retryDelays[this.retryDelays.length - 1]
          t.status = 'retrying'
          t.nextRetryAt = Date.now() + delay
          this.timers.set(
            t.id,
            setTimeout(() => {
              this.timers.delete(t.id)
              if (t.status !== 'retrying') return
              t.status = 'queued'
              t.nextRetryAt = undefined
              this.pump()
            }, delay)
          )
        } else {
          t.status = 'failed'
          t.finishedAt = Date.now()
          this.deps.onFinished?.(t, agency)
        }
      }
    } finally {
      this.running.delete(t.id)
      this.changed(true)
      this.pump()
    }
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
  }

  /** Kabari tampilan (dibatasi 4x per detik) dan simpan ke disk. */
  private changed(important: boolean): void {
    if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null
        this.deps.onChange(this.list())
      }, 250)
    }
    if (important) {
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null
        this.save()
      }, 300)
    } else if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null
        this.save()
      }, 3000)
    }
  }

  private save(): void {
    const data = JSON.stringify({ version: 1, tasks: this.tasks })
    this.saving = this.saving.then(async () => {
      try {
        await fs.mkdir(path.dirname(this.deps.file), { recursive: true })
        const tmp = `${this.deps.file}.tmp`
        await fs.writeFile(tmp, data, 'utf8')
        await fs.rename(tmp, this.deps.file)
      } catch (err) {
        console.error('Gagal menyimpan antrean:', err)
      }
    })
  }
}
