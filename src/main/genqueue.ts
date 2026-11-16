import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { buildPrompt, fileBase } from '../shared/genTemplates'
import type { GenAction, GenBatch, GenJob, GenStartInput } from '../shared/types'
import { AiError } from './ai'
import { imageThumb, saveStockJpeg } from './frames'
import { extFor, generateImage, RefusedError } from './imagegen'
import { updateMeta } from './metadata'
import { getAiKey, getSettings } from './store'
import { upscaleImage } from './upscaler'
import { writeZip } from './zip'

/**
 * Antrean Buat Gambar: 2 gambar sekaligus, coba ulang otomatis untuk gangguan sementara,
 * hasil disimpan sementara di folder data aplikasi sampai dipilih "Simpan" atau "Buang".
 * Kalau ZIP otomatis aktif: begitu satu kelompok selesai, semua hasilnya disimpan jadi JPG lalu di-ZIP.
 */

type Stored = Omit<GenJob, 'thumb'> & { raw?: string; refPath?: string }
type Data = { jobs: Stored[]; batches: GenBatch[] }

const MAX_RUNNING = 2
const MAX_ATTEMPTS = 3
const KEEP_JOBS = 2000
const TERMINAL: GenJob['status'][] = ['ready', 'saved', 'discarded', 'failed', 'rejected', 'canceled']

const dir = () => path.join(app.getPath('userData'), 'gen-cache')
const dataFile = () => path.join(app.getPath('userData'), 'gen.json')
const thumbPath = (id: string) => path.join(dir(), `thumb-${id}.jpg`)

export function defaultGenDir(): string {
  return path.join(app.getPath('pictures'), 'Stock Uploader')
}

export class GenQueue {
  private data: Data = { jobs: [], batches: [] }
  private running = new Map<string, AbortController>()
  private thumbCache = new Map<string, string>()
  private saveTimer: NodeJS.Timeout | null = null
  private emitTimer: NodeJS.Timeout | null = null
  private busyBatches = new Set<string>()
  private stopping = false
  private readonly notify: (text: string) => void

  constructor(notify: (text: string) => void) {
    this.notify = notify
  }

  async init(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(dataFile(), 'utf8')) as Partial<Data>
      this.data = { jobs: Array.isArray(raw.jobs) ? raw.jobs : [], batches: Array.isArray(raw.batches) ? raw.batches : [] }
    } catch {
      this.data = { jobs: [], batches: [] }
    }
    for (const j of this.data.jobs) {
      if (j.status === 'running') j.status = 'queued'
      j.upscale = undefined
    }
    await fs.mkdir(dir(), { recursive: true })
    this.pump()
  }

  /** Daftar tanpa gambar kecil (diambil terpisah lewat thumbs supaya tiap pembaruan tetap ringan). */
  list(): { jobs: GenJob[]; batches: GenBatch[] } {
    const jobs = this.data.jobs.map(({ raw: _raw, refPath: _ref, ...pub }) => ({ ...pub }))
    return { jobs, batches: [...this.data.batches] }
  }

  async thumbs(ids: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const id of ids.slice(0, 200)) {
      const t = await this.thumb(id)
      if (t) out[id] = t
    }
    return out
  }

  private async thumb(id: string): Promise<string | undefined> {
    if (this.thumbCache.has(id)) return this.thumbCache.get(id)
    try {
      const url = `data:image/jpeg;base64,${(await fs.readFile(thumbPath(id))).toString('base64')}`
      this.thumbCache.set(id, url)
      return url
    } catch {
      return undefined
    }
  }

  async start(input: GenStartInput): Promise<{ queued: number; batchId: string }> {
    if (!(await getAiKey())) throw new Error('Isi API key Ciora dulu di halaman Pengaturan.')
    const prompts = input.prompts.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length >= 3)
    if (!prompts.length) throw new Error('Tulis minimal satu prompt.')
    if (!input.model) throw new Error('Pilih model gambar dulu.')
    const variants = Math.max(1, Math.min(4, Math.round(input.variants) || 1))
    if (prompts.length * variants > 1000) throw new Error('Maksimal 1.000 gambar sekali jalan.')
    if (input.refPath && !existsSync(input.refPath)) throw new Error('Gambar referensi tidak ditemukan.')

    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    let folder = `gen-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
    const taken = new Set(this.data.batches.map((b) => b.folder))
    for (let i = 2; taken.has(folder); i++) folder = folder.replace(/(-\d+)?$/, '') + `-${i}`
    const batch: GenBatch = {
      id: randomUUID(),
      folder,
      autoZip: Boolean(input.autoZip),
      createdAt: Date.now(),
      refName: input.refPath ? path.basename(input.refPath) : undefined
    }
    if (input.clearPrevious) for (const b of this.data.batches) b.hidden = true
    this.data.batches.push(batch)
    for (const prompt of prompts) {
      for (let v = 0; v < variants; v++) {
        this.data.jobs.push({
          id: randomUUID(),
          batchId: batch.id,
          prompt,
          fullPrompt: buildPrompt(prompt, input.template),
          template: input.template,
          model: input.model,
          aspect: input.aspect,
          status: 'queued',
          attempt: 0,
          createdAt: Date.now(),
          refPath: input.refPath
        })
      }
    }
    this.trim()
    this.changed()
    this.pump()
    return { queued: prompts.length * variants, batchId: batch.id }
  }

  async action(action: GenAction, ids: string[]): Promise<void> {
    const want = new Set(ids)
    const jobs = this.data.jobs.filter((j) => want.has(j.id))
    if (action === 'keep') {
      await this.keep(jobs)
    } else if (action === 'discard') {
      for (const j of jobs) {
        if (j.status !== 'ready') continue
        await this.dropRaw(j)
        j.status = 'discarded'
      }
    } else if (action === 'retry') {
      for (const j of jobs) {
        if (j.status === 'failed' || j.status === 'rejected' || j.status === 'canceled') {
          j.status = 'queued'
          j.attempt = 0
          j.error = undefined
        }
      }
    } else if (action === 'again') {
      for (const j of jobs) {
        const { id: _id, raw: _raw, savedPath: _s, width: _w, height: _h, error: _e, finishedAt: _f, ...rest } = j
        this.data.jobs.push({ ...rest, id: randomUUID(), status: 'queued', attempt: 0, createdAt: Date.now() })
      }
    } else if (action === 'cancel') {
      for (const j of jobs) {
        if (j.status === 'queued') j.status = 'canceled'
        else if (j.status === 'running') this.running.get(j.id)?.abort()
      }
    }
    this.changed()
    this.pump()
    for (const b of new Set(jobs.map((j) => j.batchId))) void this.checkBatch(b)
  }

  async clear(discard: boolean): Promise<void> {
    for (const b of this.data.batches) b.hidden = true
    if (discard) {
      for (const j of this.data.jobs) {
        if (j.status === 'queued') j.status = 'canceled'
        else if (j.status === 'running') this.running.get(j.id)?.abort()
        else if (j.status === 'ready') {
          await this.dropRaw(j)
          j.status = 'discarded'
        }
      }
    }
    this.changed()
  }

  /** Path gambar ukuran asli (data URL) untuk dilihat besar. */
  async full(id: string): Promise<string | null> {
    const j = this.data.jobs.find((x) => x.id === id)
    const src = j?.status === 'saved' ? j.savedPath : j?.raw
    if (!src || !existsSync(src)) return null
    const ext = path.extname(src).slice(1).toLowerCase()
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    return `data:${mime};base64,${(await fs.readFile(src)).toString('base64')}`
  }

  async zip(batchId: string): Promise<{ zipPath: string; count: number }> {
    const b = this.data.batches.find((x) => x.id === batchId)
    if (!b) throw new Error('Kelompok tidak ditemukan.')
    const files = this.data.jobs
      .filter((j) => j.batchId === batchId && j.status === 'saved' && j.savedPath && existsSync(j.savedPath))
      .map((j) => j.savedPath!)
    if (!files.length) throw new Error('Belum ada gambar tersimpan di kelompok ini.')
    const root = await this.outDir()
    const zipPath = path.join(root, `${b.folder}.zip`)
    const r = await writeZip(zipPath, files)
    b.zipPath = zipPath
    this.changed()
    return { zipPath, count: r.count }
  }

  private async outDir(): Promise<string> {
    const s = await getSettings()
    const d = s.genDir || defaultGenDir()
    await fs.mkdir(d, { recursive: true })
    return d
  }

  private async keep(jobs: Stored[]): Promise<number> {
    let saved = 0
    const up = (await getSettings()).genUpscale
    let upscaleError = ''
    let upscaled = 0
    for (const j of jobs) {
      if (j.status !== 'ready' || !j.raw) continue
      const b = this.data.batches.find((x) => x.id === j.batchId)
      const folder = path.join(await this.outDir(), b?.folder ?? 'gen')
      await fs.mkdir(folder, { recursive: true })
      const freeName = (ext: string) => {
        for (let n = 1; ; n++) {
          const d = path.join(folder, `${fileBase(j.prompt, n)}.${ext}`)
          if (!existsSync(d)) return d
        }
      }
      try {
        let dest = ''
        let aiScale = ''
        if (up?.enabled) {
          // Upscale AI di komputer ini; kalau gagal, tetap disimpan seperti biasa (JPG ≥ 4 MP).
          dest = freeName(up.format)
          j.upscale = 0
          this.changed()
          try {
            const r = await upscaleImage(j.raw, dest, up, (p) => {
              j.upscale = p
              this.changed()
            })
            j.width = r.width
            j.height = r.height
            aiScale = r.capped ? 'maks' : `${up.scale}×`
            upscaled++
          } catch (err) {
            await fs.rm(dest, { force: true })
            upscaleError ||= (err as Error).message
            dest = ''
          } finally {
            j.upscale = undefined
          }
        }
        if (!dest) {
          dest = freeName('jpg')
          const r = await saveStockJpeg(j.raw, dest)
          j.width = r.width
          j.height = r.height
        }
        j.upscaled = aiScale || undefined
        j.savedPath = dest
        j.status = 'saved'
        await this.dropRaw(j)
        // Prompt dipakai sebagai petunjuk saat membuat metadata; gambar ditandai AI generatif.
        await updateMeta(dest, { aiGenerated: true, notes: `Made with generative AI. Prompt: ${j.prompt}`.slice(0, 500) }).catch(() => undefined)
        saved++
      } catch (err) {
        j.error = `Gagal menyimpan: ${(err as Error).message}`
      }
      this.changed()
    }
    if (upscaleError) {
      this.notify(`Upscale AI gagal${upscaled ? ` untuk sebagian gambar (${upscaled} berhasil)` : ''}: ${upscaleError} Gambar tetap disimpan tanpa upscale AI.`)
    }
    return saved
  }

  private async dropRaw(j: Stored): Promise<void> {
    if (j.raw) await fs.unlink(j.raw).catch(() => undefined)
    j.raw = undefined
  }

  private pump(): void {
    const free = MAX_RUNNING - this.running.size
    if (free <= 0) return
    const next = this.data.jobs.filter((j) => j.status === 'queued' && !this.running.has(j.id)).slice(0, free)
    for (const j of next) void this.run(j)
  }

  private async run(j: Stored): Promise<void> {
    const ctl = new AbortController()
    this.running.set(j.id, ctl)
    j.status = 'running'
    j.startedAt = Date.now()
    j.attempt++
    j.error = undefined
    this.changed()
    try {
      const key = await getAiKey()
      if (!key) throw new AiError('Isi API key Ciora dulu di halaman Pengaturan.', 0, false)
      let ref: string | undefined
      if (j.refPath) {
        const ext = path.extname(j.refPath).slice(1).toLowerCase()
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
        ref = `data:${mime};base64,${(await fs.readFile(j.refPath)).toString('base64')}`
      }
      const img = await generateImage({ apiKey: key, model: j.model, prompt: j.fullPrompt, aspect: j.aspect, ref, signal: ctl.signal })
      const raw = path.join(dir(), `raw-${j.id}.${extFor(img.mime)}`)
      await fs.writeFile(raw, img.data)
      j.raw = raw
      const t = await imageThumb(raw, 640)
      await fs.writeFile(thumbPath(j.id), Buffer.from(t.data.split(',')[1], 'base64'))
      this.thumbCache.set(j.id, t.data)
      j.width = t.width
      j.height = t.height
      j.status = 'ready'
      j.finishedAt = Date.now()
    } catch (err) {
      const e = err as AiError
      if (ctl.signal.aborted) {
        j.status = this.stopping ? 'queued' : 'canceled'
      } else if (err instanceof RefusedError) {
        j.status = 'rejected'
        j.error = e.message
      } else if (e?.retryable && j.attempt < MAX_ATTEMPTS) {
        j.status = 'queued'
        j.error = `${e.message} Dicoba lagi…`
        await new Promise((r) => setTimeout(r, 4000 * j.attempt))
      } else {
        j.status = 'failed'
        j.error = String(e?.message ?? err)
      }
      if (j.status !== 'queued') j.finishedAt = Date.now()
    } finally {
      this.running.delete(j.id)
      this.changed()
      this.pump()
      void this.checkBatch(j.batchId)
    }
  }

  /** Semua gambar satu kelompok selesai + ZIP otomatis aktif → simpan semua lalu ZIP. */
  private async checkBatch(batchId: string): Promise<void> {
    const b = this.data.batches.find((x) => x.id === batchId)
    if (!b || !b.autoZip || this.busyBatches.has(batchId)) return
    const mine = this.data.jobs.filter((j) => j.batchId === batchId)
    if (!mine.length || !mine.every((j) => TERMINAL.includes(j.status))) return
    const ready = mine.filter((j) => j.status === 'ready')
    if (!ready.length && b.zipPath) return
    this.busyBatches.add(batchId)
    try {
      await this.keep(ready)
      const saved = mine.filter((j) => j.status === 'saved').length
      if (!saved) return
      const r = await this.zip(batchId)
      const failed = mine.filter((j) => j.status === 'failed' || j.status === 'rejected').length
      this.notify(`${r.count} gambar disimpan dan di-ZIP: ${path.basename(r.zipPath)}${failed ? ` · ${failed} gagal` : ''}`)
    } catch (err) {
      this.notify(`ZIP gagal: ${(err as Error).message}`)
    } finally {
      this.busyBatches.delete(batchId)
    }
  }

  /** Riwayat dibatasi supaya file data tetap kecil; gambar sementara yang ikut terhapus dibersihkan. */
  private trim(): void {
    if (this.data.jobs.length <= KEEP_JOBS) return
    const drop = this.data.jobs.splice(0, this.data.jobs.length - KEEP_JOBS)
    for (const j of drop) {
      if (j.raw) void fs.unlink(j.raw).catch(() => undefined)
      void fs.unlink(thumbPath(j.id)).catch(() => undefined)
      this.thumbCache.delete(j.id)
    }
    const used = new Set(this.data.jobs.map((j) => j.batchId))
    this.data.batches = this.data.batches.filter((b) => used.has(b.id))
  }

  private changed(): void {
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null
        void this.flush()
      }, 500)
    }
    if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('gen:changed')
      }, 250)
    }
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const tmp = `${dataFile()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.data), 'utf8')
    await fs.rename(tmp, dataFile())
  }

  shutdown(): Promise<void> {
    this.stopping = true
    for (const c of this.running.values()) c.abort()
    return this.flush()
  }
}
