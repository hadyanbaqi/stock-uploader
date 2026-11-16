import { app, BrowserWindow, nativeImage } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AiMode } from '../shared/metadata'
import { encodePng } from './alpha'
import { flattenOnWhite, readPsdComposite } from './psd'

/**
 * Membaca gambar dan video memakai mesin Chromium bawaan Electron (jendela tersembunyi),
 * jadi tidak perlu ffmpeg tambahan. Hasilnya gambar kecil untuk AI + data teknis.
 */

export type Preview = {
  images: string[]
  labels?: string[]
  thumb: string
  tech: string
}

const HELPER = `<!doctype html><meta charset="utf-8"><body><script>
function sample(c, w, h) {
  const g = c.getContext('2d')
  const d = g.getImageData(0, 0, w, h).data
  let transparent = false, green = 0, edge = 0
  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 40))) {
    for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 40))) {
      const i = (y * w + x) * 4
      if (d[i + 3] < 250) transparent = true
      const border = x < w * 0.08 || x > w * 0.92 || y < h * 0.08 || y > h * 0.92
      if (border) { edge++; if (d[i + 1] > 170 && d[i] < 110 && d[i + 2] < 110) green++ }
    }
  }
  return { transparent, green: edge > 0 && green / edge > 0.6 }
}
function jpeg(src, w, h, q) {
  const o = document.createElement('canvas'); o.width = w; o.height = h
  const g = o.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.drawImage(src, 0, 0, w, h)
  return o.toDataURL('image/jpeg', q)
}
window.grabImage = async (url, max) => {
  const img = new Image(); img.src = url
  await img.decode()
  const w0 = img.naturalWidth || 1024, h0 = img.naturalHeight || 1024
  const s = Math.min(1, max / Math.max(w0, h0)), w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  c.getContext('2d').drawImage(img, 0, 0, w, h)
  const info = sample(c, w, h)
  const ts = Math.min(1, 320 / Math.max(w, h))
  return { data: jpeg(c, w, h, 0.85), thumb: jpeg(c, Math.round(w * ts), Math.round(h * ts), 0.75), width: w0, height: h0, ...info }
}
// Gambar hasil AI → JPG siap stok: diperbesar kalau di bawah minPx piksel (Adobe minta minimal 4 MP).
window.stockJpeg = async (url, minPx, targetPx, q) => {
  const img = new Image(); img.src = url
  await img.decode()
  const w0 = img.naturalWidth, h0 = img.naturalHeight
  const s = w0 * h0 < minPx ? Math.sqrt(targetPx / (w0 * h0)) : 1
  const w = Math.round(w0 * s), h = Math.round(h0 * s)
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h)
  return { data: c.toDataURL('image/jpeg', q), width: w, height: h, srcWidth: w0, srcHeight: h0 }
}
// JPG preview dari PNG transparan: latar hitam/putih/petak/belah/warna + teks opsional.
window.previewJpeg = async (url, style, color, text, q) => {
  const img = new Image(); img.src = url
  await img.decode()
  const w = img.naturalWidth, h = img.naturalHeight
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d')
  if (style === 'checker') {
    const cell = Math.max(8, Math.round(Math.max(w, h) / 64))
    for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) {
      g.fillStyle = ((x / cell + y / cell) | 0) % 2 ? '#cccccc' : '#ffffff'; g.fillRect(x, y, cell, cell)
    }
  } else if (style === 'split') {
    g.fillStyle = '#000000'; g.fillRect(0, 0, w / 2, h); g.fillStyle = '#ffffff'; g.fillRect(w / 2, 0, w - w / 2, h)
  } else {
    g.fillStyle = style === 'white' ? '#ffffff' : style === 'color' ? color : '#000000'; g.fillRect(0, 0, w, h)
  }
  g.drawImage(img, 0, 0)
  if (text) {
    const size = Math.round(h * 0.06)
    g.font = '800 ' + size + 'px "Helvetica Neue", Arial, sans-serif'
    g.textAlign = 'center'; g.textBaseline = 'bottom'
    const y = h - Math.round(h * 0.05)
    const draw = (x, fill) => { g.fillStyle = fill; g.fillText(text, x, y) }
    if (style === 'split') { g.save(); g.beginPath(); g.rect(0, 0, w / 2, h); g.clip(); draw(w / 2, '#ffffff'); g.restore(); g.save(); g.beginPath(); g.rect(w / 2, 0, w, h); g.clip(); draw(w / 2, '#000000'); g.restore() }
    else { g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = size / 6; draw(w / 2, style === 'white' || style === 'checker' ? '#111111' : '#ffffff') }
  }
  return c.toDataURL('image/jpeg', q)
}
window.grabVideo = async (url, count, cell, cols) => {
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('codec')) })
  let dur = v.duration
  const w0 = v.videoWidth, h0 = v.videoHeight
  if (!w0 || !h0) throw new Error('codec')
  if (!isFinite(dur)) {
    // Sebagian file tidak mencatat durasi di awal: lompat ke ujung supaya durasinya terbaca.
    await new Promise((res) => { const done = () => { v.ondurationchange = null; res() }; v.ondurationchange = () => isFinite(v.duration) && done(); v.currentTime = 1e9; setTimeout(done, 5000) })
    dur = v.duration
    if (!isFinite(dur) || dur <= 0) throw new Error('codec')
  }
  const seek = (t) => new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('seek')), 15000)
    v.onseeked = () => { clearTimeout(timer); res() }
    v.currentTime = t
  })
  const fw = cell, fh = Math.round(cell * h0 / w0)
  const c = document.createElement('canvas'); c.width = fw; c.height = fh
  const g = c.getContext('2d')
  const tiny = () => { const t = document.createElement('canvas'); t.width = 32; t.height = 18; const tg = t.getContext('2d'); tg.drawImage(v, 0, 0, 32, 18); return tg.getImageData(0, 0, 32, 18).data }
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 4) / 3 }
  await seek(Math.min(0.02, dur / 10)); const first = tiny()
  await seek(Math.max(0, dur - 0.04)); const last = tiny()
  const frames = [], times = []
  let info = { transparent: false, green: false }
  for (let i = 0; i < count; i++) {
    const t = Math.min(dur - 0.05, dur * (i + 0.5) / count)
    await seek(Math.max(0, t))
    g.drawImage(v, 0, 0, fw, fh)
    if (i === Math.floor(count / 2)) info = sample(c, fw, fh)
    frames.push(c.toDataURL('image/jpeg', 0.8)); times.push(t)
  }
  let sheet = ''
  if (cols > 0) {
    const rows = Math.ceil(count / cols)
    const s = document.createElement('canvas'); s.width = fw * cols; s.height = fh * rows
    const sg = s.getContext('2d'); sg.fillStyle = '#000'; sg.fillRect(0, 0, s.width, s.height)
    for (let i = 0; i < frames.length; i++) {
      const im = new Image(); im.src = frames[i]; await im.decode()
      sg.drawImage(im, (i % cols) * fw, Math.floor(i / cols) * fh)
    }
    sheet = s.toDataURL('image/jpeg', 0.82)
  }
  const ti = new Image(); ti.src = frames[Math.floor(count / 2)]; await ti.decode()
  const ts = 320 / Math.max(fw, fh)
  return { frames: cols > 0 ? [] : frames, times, sheet, thumb: jpeg(ti, Math.round(fw * ts), Math.round(fh * ts), 0.75), duration: dur, width: w0, height: h0, loop: diff(first, last) < 6, ...info }
}
</script>`

let win: BrowserWindow | null = null
let chain: Promise<unknown> = Promise.resolve()

async function helper(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed()) return win
  const file = path.join(app.getPath('userData'), 'pembaca-media.html')
  await fs.writeFile(file, HELPER, 'utf8')
  win = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      // Jendela ini hanya membuka file lokal milik pengguna dan tidak pernah membuka internet;
      // webSecurity dimatikan supaya frame video lokal boleh dibaca ke canvas.
      webSecurity: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  await win.loadFile(file)
  return win
}

export function closeHelper(): void {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}

function run<T>(script: string): Promise<T> {
  const job = chain.then(async () => {
    const w = await helper()
    return (await Promise.race([
      w.webContents.executeJavaScript(script, true),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 90_000))
    ])) as T
  })
  chain = job.catch(() => undefined)
  return job
}

const PREVIEW_EXT = ['jpg', 'jpeg', 'png']

/** Untuk EPS/AI/ZIP: cari gambar pratinjau dengan nama sama (mis. bunga.eps → bunga.jpg). */
function siblingPreview(filePath: string): string | null {
  const base = filePath.slice(0, filePath.length - path.extname(filePath).length)
  for (const e of PREVIEW_EXT) for (const x of [e, e.toUpperCase()]) if (existsSync(`${base}.${x}`)) return `${base}.${x}`
  return null
}

type ImageGrab = { data: string; thumb: string; width: number; height: number; transparent: boolean; green: boolean }
type VideoGrab = {
  frames: string[]
  times: number[]
  sheet: string
  thumb: string
  duration: number
  width: number
  height: number
  loop: boolean
  transparent: boolean
  green: boolean
}

export async function makePreview(filePath: string, mode: AiMode): Promise<Preview> {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (ext === 'mp4' || ext === 'mov') {
    const detail = mode === 'detail'
    const url = pathToFileURL(filePath).href
    let v: VideoGrab
    try {
      v = await run<VideoGrab>(`grabVideo(${JSON.stringify(url)}, ${detail ? 12 : 9}, ${detail ? 640 : 480}, ${detail ? 0 : 3})`)
    } catch (err) {
      const msg = String((err as Error)?.message ?? err)
      if (msg.includes('codec')) throw new Error('Video ini tidak bisa dibaca (mis. ProRes atau codec khusus). Pakai versi MP4/H.264 untuk membuat metadata.')
      throw new Error(`Gagal membaca video: ${msg}`)
    }
    const res = v.width >= 3840 ? '4K' : v.width >= 1920 || v.height >= 1920 ? 'Full HD' : v.width >= 1280 ? 'HD' : ''
    const tech = [
      `video ${v.width}x${v.height}${res ? ` (${res})` : ''}`,
      `${v.duration.toFixed(1)} seconds`,
      v.height > v.width ? 'vertical' : '',
      v.loop ? 'first and last frame match (likely seamless loop)' : '',
      v.green ? 'green screen background' : ''
    ]
      .filter(Boolean)
      .join(', ')
    return detail
      ? { images: v.frames, labels: v.times.map((t) => `Frame at ${t.toFixed(1)}s:`), thumb: v.thumb, tech }
      : { images: [v.sheet], thumb: v.thumb, tech: `${tech}; contact sheet of 9 frames in time order` }
  }

  let source = filePath
  let tempFile: string | null = null
  let psdInfo: { width: number; height: number; hasAlpha: boolean } | null = null
  if (!['jpg', 'jpeg', 'png', 'svg'].includes(ext)) {
    const sib = siblingPreview(filePath)
    if (sib) {
      source = sib
    } else if (ext === 'psd' || ext === 'psb') {
      // PSD tanpa JPG pratinjau: baca gambar gabungannya langsung.
      const img = readPsdComposite(await fs.readFile(filePath), 1024)
      psdInfo = { width: img.width, height: img.height, hasAlpha: img.hasAlpha }
      tempFile = path.join(app.getPath('temp'), `su-psd-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
      await fs.writeFile(tempFile, await encodePng(img.rgba, img.w, img.h))
      source = tempFile
    } else {
      throw new Error(`File .${ext.toUpperCase()} tidak bisa dilihat langsung. Taruh gambar JPG pratinjau dengan nama yang sama di folder yang sama (mis. ${path.basename(filePath, path.extname(filePath))}.jpg).`)
    }
  }
  let im: ImageGrab
  try {
    im = await run<ImageGrab>(`grabImage(${JSON.stringify(pathToFileURL(source).href)}, 1024)`).catch((err) => {
      throw new Error(`Gagal membaca gambar: ${String((err as Error)?.message ?? err)}`)
    })
  } finally {
    if (tempFile) await fs.rm(tempFile, { force: true })
  }
  const isPsd = ext === 'psd' || ext === 'psb'
  const kind = ext === 'eps' || ext === 'ai' || ext === 'svg' ? 'vector illustration' : ext === 'zip' ? 'file package' : isPsd ? 'layered PSD design file' : 'image'
  const width = psdInfo?.width ?? im.width
  const height = psdInfo?.height ?? im.height
  const tech = [
    `${kind} ${width}x${height}`,
    (psdInfo ? psdInfo.hasAlpha : im.transparent) && ext !== 'jpg' && ext !== 'jpeg' ? 'transparent background' : '',
    im.green ? 'green screen background' : ''
  ]
    .filter(Boolean)
    .join(', ')
  return { images: [im.data], thumb: im.thumb, tech }
}

/** Gambar kecil (data URL JPEG) untuk galeri. */
export async function imageThumb(filePath: string, max = 640): Promise<{ data: string; width: number; height: number }> {
  const im = await run<ImageGrab>(`grabImage(${JSON.stringify(pathToFileURL(filePath).href)}, ${max})`)
  return { data: im.data, width: im.width, height: im.height }
}

/** Simpan gambar sebagai JPG kualitas 95; diperbesar ke ±6 MP kalau di bawah 4 MP. */
export async function saveStockJpeg(src: string, dest: string): Promise<{ width: number; height: number; upscaled: boolean }> {
  const r = await run<{ data: string; width: number; height: number; srcWidth: number; srcHeight: number }>(
    `stockJpeg(${JSON.stringify(pathToFileURL(src).href)}, 4000000, 6000000, 0.95)`
  )
  await fs.writeFile(dest, Buffer.from(r.data.split(',')[1], 'base64'))
  return { width: r.width, height: r.height, upscaled: r.width !== r.srcWidth }
}

/** JPG preview dari PNG transparan (lihat previewJpeg di jendela pembantu). */
export async function previewJpegFile(png: string, dest: string, style: string, color: string, text: string): Promise<void> {
  const url = await run<string>(
    `previewJpeg(${JSON.stringify(pathToFileURL(png).href)}, ${JSON.stringify(style)}, ${JSON.stringify(color)}, ${JSON.stringify(text)}, 0.92)`
  )
  await fs.writeFile(dest, Buffer.from(url.split(',')[1], 'base64'))
}

/** nativeImage memakai urutan piksel BGRA di Windows/Mac; cek sekali supaya pasti. */
let nativeBgra: boolean | null = null
function isNativeBgra(): boolean {
  if (nativeBgra !== null) return nativeBgra
  const red = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
  )
  const b = red.toBitmap()
  nativeBgra = b[2] > 200 && b[0] < 50
  return nativeBgra
}

/** Batas pratinjau Freepik/Magnific untuk PSD: sisi terpanjang 2.000–10.000 px. */
export const PSD_PREVIEW_MIN = 2000
export const PSD_PREVIEW_MAX = 10000

/**
 * Buat JPG pratinjau dari gambar gabungan PSD (transparan → putih), sisi terpanjang paling besar 10.000 px.
 * Mengembalikan ukuran hasil.
 */
export async function psdPreviewJpeg(psdPath: string, dest: string): Promise<{ width: number; height: number }> {
  const img = readPsdComposite(await fs.readFile(psdPath), PSD_PREVIEW_MAX)
  const px = img.hasAlpha ? flattenOnWhite(img.rgba) : img.rgba
  if (isNativeBgra()) {
    for (let i = 0; i < px.length; i += 4) {
      const t = px[i]
      px[i] = px[i + 2]
      px[i + 2] = t
    }
  }
  const ni = nativeImage.createFromBitmap(Buffer.from(px.buffer, px.byteOffset, px.byteLength), { width: img.w, height: img.h })
  if (ni.isEmpty()) throw new Error('JPG pratinjau gagal dibuat dari PSD.')
  await fs.writeFile(dest, ni.toJPEG(92))
  return { width: img.w, height: img.h }
}
