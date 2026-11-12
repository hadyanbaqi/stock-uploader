import { app, BrowserWindow, nativeImage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { saveAccount } from './accounts'
import type { UploadQueue } from './queue'
import type { AccountInput } from '../shared/types'
import { setAiKey } from './store'
import { exportCsv, generate, inject, listMeta } from './metadata'
import { readMeta } from './inject'

/**
 * Uji ujung-ke-ujung (hanya jalan kalau SU_E2E diisi, dipakai scripts/test-app.mts):
 * simpan akun uji → masukkan file ke antrean → tangkap layar → tunggu selesai → tulis hasil.
 */
type E2EConfig = {
  accounts: AccountInput[]
  files: string[]
  folder: string
  out: string
  shots: string
  /** Folder kerja untuk tes metadata (AI tiruan lewat SU_AI_BASE). */
  metaDir?: string
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runE2E(configPath: string, win: BrowserWindow, queue: UploadQueue): Promise<void> {
  const cfg = JSON.parse(await fs.readFile(configPath, 'utf8')) as E2EConfig
  const shot = async (name: string) => {
    const img = await win.webContents.capturePage()
    await fs.writeFile(path.join(cfg.shots, `${name}.png`), img.toPNG())
  }
  const result: Record<string, unknown> = {}
  try {
    await new Promise<void>((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', () => r()) : r()))
    const ids: string[] = []
    for (const a of cfg.accounts) ids.push((await saveAccount(a)).id)

    // Lewat jembatan tampilan, sama seperti saat folder diseret.
    result.expanded = await win.webContents.executeJavaScript(
      `window.api.expandPaths(${JSON.stringify([cfg.folder])}).then(r => ({ files: r.files.length, skipped: r.skipped }))`
    )
    await win.webContents.executeJavaScript(`location.hash = 'upload'`)
    await wait(1200)
    await shot('1-upload')

    result.added = await win.webContents.executeJavaScript(
      `window.api.queueAdd(${JSON.stringify(cfg.files)}, ${JSON.stringify(ids)})`
    )
    await win.webContents.executeJavaScript(`location.hash = 'queue'`)
    await wait(2500)
    await shot('2-antrean-berjalan')

    const end = Date.now() + 10 * 60_000
    while (queue.activeCount() > 0 && Date.now() < end) await wait(500)
    await wait(800)
    await shot('3-antrean-selesai')
    result.tasks = queue.list()

    // Cegah dobel: file yang sama ke akun yang sama harus dilewati.
    await wait(500)
    result.readd = await win.webContents.executeJavaScript(
      `window.api.queueAdd(${JSON.stringify(cfg.files)}, ${JSON.stringify(ids)})`
    )
    result.history = await win.webContents.executeJavaScript(`window.api.historyList().then(h => h.length)`)
    await win.webContents.executeJavaScript(`location.hash = 'history'`)
    await wait(1200)
    await shot('4-riwayat')

    if (cfg.metaDir) result.meta = await metadataFlow(cfg, win, shot)
  } catch (err) {
    result.error = String((err as Error)?.stack ?? err)
  }
  await fs.writeFile(cfg.out, JSON.stringify(result, null, 2))
  app.quit()
}

/** Buat video uji 3 detik (warna bergerak) dengan perekam bawaan Chromium. */
async function makeVideo(file: string): Promise<string | false> {
  const w = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, sandbox: true } })
  try {
    await w.loadURL('data:text/html,<body></body>')
    const b64 = (await w.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 360
      const g = c.getContext('2d'); let f = 0
      const draw = () => { const h = (f * 4) % 360; g.fillStyle = 'hsl(' + h + ',80%,50%)'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.beginPath(); g.arc(80 + (f * 9) % 480, 180, 50, 0, 7); g.fill(); f++ }
      draw()
      const timer = setInterval(draw, 33)
      const mime = ['video/mp4;codecs=avc1', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm'
      window.__mime = mime
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime })
      const parts = []
      rec.ondataavailable = (e) => parts.push(e.data)
      rec.onstop = async () => { clearInterval(timer); const buf = await new Blob(parts).arrayBuffer(); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); resolve(btoa(s)) }
      rec.onerror = reject
      rec.start(); setTimeout(() => rec.stop(), 3000)
    })`)) as string
    await fs.writeFile(file, Buffer.from(b64, 'base64'))
    return String(await w.webContents.executeJavaScript('window.__mime'))
  } catch {
    return false
  } finally {
    w.destroy()
  }
}

async function metadataFlow(cfg: E2EConfig, win: BrowserWindow, shot: (n: string) => Promise<void>): Promise<Record<string, unknown>> {
  const dir = cfg.metaDir!
  const out: Record<string, unknown> = {}
  // Gambar uji: gradasi biru 800x500 (dibuat dari bitmap mentah).
  const W = 800
  const H = 500
  const bmp = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      bmp[i] = 255 // B (format BGRA)
      bmp[i + 1] = Math.round((x / W) * 200)
      bmp[i + 2] = Math.round((y / H) * 80)
      bmp[i + 3] = 255
    }
  const jpg = path.join(dir, 'gradasi-biru.jpg')
  await fs.writeFile(jpg, nativeImage.createFromBitmap(bmp, { width: W, height: H }).toJPEG(90))
  const svg = path.join(dir, 'ikon-daun.svg')
  await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><circle cx="200" cy="200" r="150" fill="#2a9d8f"/></svg>')
  const video = path.join(dir, 'klip-warna.mp4')
  out.videoMade = await makeVideo(video)
  const files = [jpg, svg, ...(out.videoMade ? [video] : [])]

  await setAiKey('kunci-uji-palsu')
  await listMeta(files)
  out.generate = await generate(files, false)
  const end = Date.now() + 120_000
  let recs = await listMeta(files)
  while (recs.some((r) => r.status === 'generating') && Date.now() < end) {
    await wait(300)
    recs = await listMeta(files)
  }
  out.records = recs.map((r) => ({ name: r.name, status: r.status, title: r.title, keywords: r.keywords.length, tech: r.tech, error: r.error, thumb: Boolean(r.thumb) }))

  await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('su-test-files', { detail: ${JSON.stringify(files)} })); location.hash = 'metadata'`)
  await wait(1500)
  await shot('5-metadata')

  out.inject = await inject(files)
  out.injectErrors = (await listMeta(files)).filter((r) => r.error).map((r) => `${r.name}: ${r.error}`)
  const back = await readMeta(jpg)
  out.readBack = back
  out.csv = await exportCsv(files, ['adobe', 'shutterstock'], dir)

  await win.webContents.executeJavaScript(`location.hash = 'settings'`)
  await wait(800)
  await shot('6-pengaturan')
  return out
}
