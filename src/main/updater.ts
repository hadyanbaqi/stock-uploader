/**
 * Pembaruan aplikasi: cek latest.json di repo rilis publik, unduh installer (dicek SHA-256), lalu pasang.
 * Windows: installer NSIS dijalankan senyap lalu aplikasi dibuka lagi.
 * Mac: .app lama diganti lewat skrip setelah aplikasi tertutup; kalau tidak bisa, DMG dibuka untuk dipasang manual.
 */
import { app, net, shell } from 'electron'
import { spawn } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { RELEASES_REPO, type UpdateState } from '../shared/update'
import {
  assetUrl,
  compareVersions,
  downloadVerified,
  fetchManifest,
  macBundlePath,
  macCannotReplace,
  macInstallScript,
  manifestUrl,
  pickAsset,
  type UpdateAsset,
  type UpdateManifest
} from './updatecore'
import { getSettings } from './store'

const FIRST_CHECK_MS = 15_000
const EVERY_MS = 6 * 60 * 60 * 1000

export class Updater {
  private state: UpdateState
  private manifest: UpdateManifest | null = null
  private asset: UpdateAsset | null = null
  private file: string | null = null
  private abort: AbortController | null = null
  private timer: NodeJS.Timeout | null = null
  private readonly enabled: boolean

  constructor(private readonly emit: (s: UpdateState) => void) {
    // Hanya aplikasi terpasang; tidak saat pengembangan atau saat tes otomatis.
    this.enabled = app.isPackaged && !process.env.SU_USERDATA && !process.env.SU_SMOKE && !process.env.SU_E2E && !process.env.SU_NO_UPDATE
    this.state = { status: this.enabled ? 'idle' : 'disabled', current: app.getVersion() }
  }

  getState(): UpdateState {
    return this.state
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch }
    this.emit(this.state)
  }

  private get dir(): string {
    return path.join(app.getPath('userData'), 'pembaruan')
  }

  /** Cek otomatis beberapa detik setelah dibuka, lalu tiap 6 jam (kalau diizinkan di Pengaturan). */
  start(): void {
    if (!this.enabled) return
    const tick = async () => {
      if ((await getSettings()).autoUpdate === false) return
      if (['idle', 'none', 'error'].includes(this.state.status)) await this.check().catch(() => undefined)
    }
    setTimeout(() => void tick(), FIRST_CHECK_MS)
    this.timer = setInterval(() => void tick(), EVERY_MS)
    void this.cleanup()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.abort?.abort()
  }

  /** Hapus sisa unduhan versi lama. */
  private async cleanup(): Promise<void> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[])
    for (const n of names) if (!n.endsWith('.sh') && !n.endsWith('.log')) await fs.rm(path.join(this.dir, n), { force: true }).catch(() => undefined)
  }

  async check(): Promise<UpdateState> {
    if (!this.enabled) return this.state
    if (['checking', 'downloading', 'installing'].includes(this.state.status)) return this.state
    this.set({ status: 'checking', error: undefined })
    try {
      const m = await fetchManifest((u, i) => net.fetch(u, i), manifestUrl(RELEASES_REPO), AbortSignal.timeout(20_000))
      const checkedAt = Date.now()
      if (!m || compareVersions(m.version, app.getVersion()) <= 0) {
        this.manifest = null
        this.set({ status: 'none', latest: m?.version, notes: undefined, checkedAt })
        return this.state
      }
      const pick = pickAsset(m, process.platform, process.arch)
      if ('error' in pick) {
        this.set({ status: 'error', latest: m.version, error: pick.error, checkedAt })
        return this.state
      }
      this.manifest = m
      this.asset = pick.asset
      const sameFile = this.file && path.basename(this.file) === pick.asset.name
      this.set({
        status: sameFile ? 'ready' : 'available',
        latest: m.version,
        notes: m.notes,
        date: m.date,
        size: pick.asset.size,
        checkedAt,
        manual: process.platform === 'darwin' ? await this.macManual() : false
      })
    } catch (e) {
      this.set({ status: 'error', error: friendly(e), checkedAt: Date.now() })
    }
    return this.state
  }

  async download(): Promise<UpdateState> {
    if (!this.manifest || !this.asset) return this.state
    if (this.state.status === 'downloading' || this.state.status === 'ready') return this.state
    await fs.mkdir(this.dir, { recursive: true })
    const dest = path.join(this.dir, this.asset.name)
    this.abort = new AbortController()
    this.set({ status: 'downloading', progress: 0, error: undefined })
    try {
      await downloadVerified(
        (u, i) => net.fetch(u, i),
        assetUrl(RELEASES_REPO, this.manifest.version, this.asset.name),
        dest,
        this.asset,
        (done, total) => this.set({ progress: total ? done / total : 0 }),
        this.abort.signal
      )
      this.file = dest
      this.set({ status: 'ready', progress: 1 })
    } catch (e) {
      const cancelled = this.abort.signal.aborted
      this.set({ status: cancelled ? 'available' : 'error', progress: undefined, error: cancelled ? undefined : friendly(e) })
    } finally {
      this.abort = null
    }
    return this.state
  }

  cancelDownload(): void {
    this.abort?.abort()
  }

  /** Mac: apakah .app bisa diganti otomatis? true = harus manual (DMG dibuka). */
  private async macManual(): Promise<boolean> {
    const bundle = macBundlePath(process.execPath)
    if (!bundle || macCannotReplace(bundle)) return true
    try {
      await fs.access(path.dirname(bundle), constants.W_OK)
      await fs.access(bundle, constants.W_OK)
      return false
    } catch {
      return true
    }
  }

  /** Tutup aplikasi dan pasang versi baru. `quit` = cara keluar aplikasi (melewati konfirmasi antrean). */
  async install(quit: () => void): Promise<UpdateState> {
    if (this.state.status !== 'ready' || !this.file) return this.state
    const file = this.file
    try {
      if (process.platform === 'win32') {
        this.set({ status: 'installing' })
        // /S = senyap (pakai folder instalasi yang lama), --force-run = buka aplikasi setelah selesai.
        spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
        setTimeout(quit, 800)
      } else if (process.platform === 'darwin') {
        const bundle = macBundlePath(process.execPath)
        if (!bundle || (await this.macManual())) {
          // Tidak bisa diganti di tempat: buka DMG, pengguna menyeret ke Applications.
          const err = await shell.openPath(file)
          if (err) throw new Error(err)
          this.set({ status: 'ready', manual: true })
          return this.state
        }
        this.set({ status: 'installing' })
        const script = path.join(this.dir, 'pasang.sh')
        await fs.writeFile(script, macInstallScript({ pid: process.pid, dmg: file, bundle, log: path.join(this.dir, 'pasang.log') }), { mode: 0o755 })
        spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' }).unref()
        setTimeout(quit, 500)
      } else {
        throw new Error('Pembaruan otomatis hanya untuk Windows dan Mac.')
      }
    } catch (e) {
      this.set({ status: 'error', error: `Gagal memasang: ${friendly(e)}` })
    }
    return this.state
  }
}

function friendly(e: unknown): string {
  const msg = String((e as Error)?.message ?? e)
  if (/abort|timeout/i.test(msg)) return 'Server pembaruan tidak menjawab. Cek internet lalu coba lagi.'
  if (/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|fetch failed/i.test(msg)) return 'Tidak ada internet atau github.com tidak bisa dihubungi.'
  return msg
}
