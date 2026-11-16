import { BrowserWindow, nativeImage, type NativeImage } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { AlphaInfo, AlphaOptions, AlphaProgress, AlphaResult } from '../shared/types'
import { detectBackground, downscale, encodePng, encodePsd, extractAlpha, type BgKind } from './alpha'
import { expandPaths } from './files'
import { previewJpegFile, psdPreviewJpeg } from './frames'
import { getMeta, updateMeta } from './metadata'
import { writeZip } from './zip'
import { ALPHA_AGENCIES, agencyScale, isAlphaAgency, planAgencyFiles, skippedForAi, type AlphaAgency } from '../shared/alphaAgency'

/** Proses Transparan di proses utama: baca gambar (nativeImage), hitung alpha, tulis PNG/JPG/PSD. */

const IMAGE_EXT = ['jpg', 'jpeg', 'png']
let cancel = false
let running = false

/** nativeImage memberi piksel BGRA di Windows/Mac; cek sekali supaya pasti. */
let bgra: boolean | null = null
function isBgra(): boolean {
  if (bgra !== null) return bgra
  const red = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
  )
  const b = red.toBitmap()
  bgra = b[2] > 200 && b[0] < 50
  return bgra
}

function toRgba(img: NativeImage): { data: Uint8Array; w: number; h: number } {
  const { width: w, height: h } = img.getSize()
  const src = img.toBitmap()
  const out = new Uint8Array(w * h * 4)
  const swap = isBgra()
  for (let i = 0; i < w * h * 4; i += 4) {
    out[i] = swap ? src[i + 2] : src[i]
    out[i + 1] = src[i + 1]
    out[i + 2] = swap ? src[i] : src[i + 2]
    out[i + 3] = src[i + 3]
  }
  return { data: out, w, h }
}

function load(file: string, minMp: boolean, agencies: AlphaAgency[]): NativeImage {
  let img = nativeImage.createFromPath(file)
  if (img.isEmpty()) throw new Error('Gambar tidak bisa dibaca (hanya JPG/PNG).')
  const { width, height } = img.getSize()
  let s = minMp && width * height < 4_000_000 ? Math.sqrt(6_000_000 / (width * height)) : 1
  // Paket agensi: perbesar sampai memenuhi syarat semua agensi terpilih (mis. 123RF 6 MP, Freepik 2.000 px).
  s = Math.max(s, agencyScale(width, height, agencies))
  if (s > 1) img = img.resize({ width: Math.round(width * s), height: Math.round(height * s), quality: 'best' })
  return img
}

/** Batas bawah PSD Freepik (1,5 MB). */
const FREEPIK_PSD_MIN = 1.5 * 1024 * 1024

const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const fromHex = (h: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function background(rgba: Uint8Array, w: number, h: number, o: AlphaOptions): { kind: BgKind; color: [number, number, number] } {
  if (o.bg === 'black') return { kind: 'black', color: [0, 0, 0] }
  if (o.bg === 'white') return { kind: 'white', color: [255, 255, 255] }
  if (o.bg === 'color') return { kind: 'color', color: fromHex(o.color) }
  return detectBackground(rgba, w, h)
}

export async function expandImages(paths: string[]): Promise<string[]> {
  const r = await expandPaths(paths)
  return r.files.filter((f) => IMAGE_EXT.includes(f.ext)).map((f) => f.path)
}

export async function inspect(paths: string[]): Promise<AlphaInfo[]> {
  const out: AlphaInfo[] = []
  for (const p of paths.slice(0, 2000)) {
    try {
      const img = nativeImage.createFromPath(p)
      if (img.isEmpty()) continue
      const { width, height } = img.getSize()
      const small = img.resize({ width: Math.min(320, width) })
      const px = toRgba(small)
      const bg = detectBackground(px.data, px.w, px.h)
      out.push({ path: p, name: path.basename(p), width, height, bg: bg.kind, color: hex(bg.color), thumb: `data:image/jpeg;base64,${small.toJPEG(75).toString('base64')}` })
    } catch {
      // lewati file rusak
    }
  }
  return out
}

/** Sebelum/sesudah dalam ukuran kecil untuk penggeser pratinjau. */
export async function preview(file: string, o: AlphaOptions): Promise<{ before: string; after: string; bg: string; color: string }> {
  const img = nativeImage.createFromPath(file)
  if (img.isEmpty()) throw new Error('Gambar tidak bisa dibaca.')
  const { width } = img.getSize()
  const small = width > 1000 ? img.resize({ width: 1000, quality: 'good' }) : img
  const px = toRgba(small)
  const bg = background(px.data, px.w, px.h, o)
  const fg = extractAlpha(px.data, px.w, px.h, { bg: bg.color, floor: o.floor, glow: o.glow })
  const png = await encodePng(fg, px.w, px.h)
  return {
    before: `data:image/jpeg;base64,${small.toJPEG(85).toString('base64')}`,
    after: `data:image/png;base64,${png.toString('base64')}`,
    bg: bg.kind,
    color: hex(bg.color)
  }
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** Nama file keluaran (tanpa ekstensi), maksimal 30 karakter termasuk ".png". */
export function outName(src: string, i: number, o: Pick<AlphaOptions, 'naming' | 'prefix'>, total: number): string {
  const digits = Math.max(3, String(total).length)
  if (o.naming === 'sequence') {
    const prefix = (o.prefix || 'vfx').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'vfx'
    const num = String(i + 1).padStart(digits, '0')
    return `${prefix.slice(0, 30 - 4 - 1 - num.length)}-${num}`
  }
  const base = path.basename(src, path.extname(src)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'efek'
  return base.slice(0, 26).replace(/-+$/, '')
}

export function cancelRun(): void {
  cancel = true
}

export async function runAlpha(paths: string[], o: AlphaOptions): Promise<AlphaResult> {
  if (running) throw new Error('Masih ada proses Transparan yang berjalan.')
  const files = paths.filter((p) => existsSync(p))
  if (!files.length) throw new Error('Belum ada gambar.')
  running = true
  cancel = false
  const outDir = o.outDir || path.join(path.dirname(files[0]), `transparan-${stamp()}`)
  await fs.mkdir(outDir, { recursive: true })
  const result: AlphaResult = { outDir, pngs: [], files: 0, errors: [], canceled: false }
  const written: string[] = []
  const used = new Set<string>()
  const agencies = (o.agencies ?? []).filter(isAlphaAgency)
  const aiSkipped = new Map<AlphaAgency, number>()
  let smallPsd = 0
  if (agencies.length) result.agencyFiles = []
  const taken = (b: string) =>
    used.has(b) || existsSync(path.join(outDir, `${b}.png`)) || planAgencyFiles(b, agencies).some((f) => existsSync(path.join(outDir, ...f.rel.split('/'))))
  const send = (p: AlphaProgress) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('alpha:progress', p)
  }
  try {
    for (let i = 0; i < files.length; i++) {
      if (cancel) {
        result.canceled = true
        break
      }
      const src = files[i]
      send({ done: i, total: files.length, current: path.basename(src), errors: result.errors.length })
      try {
        let base = outName(src, i, o, files.length)
        for (let n = 2; taken(base); n++) base = `${outName(src, i, o, files.length).slice(0, 26 - String(n).length)}-${n}`
        used.add(base)
        const img = load(src, o.minMp, agencies)
        const px = toRgba(img)
        const small = downscale(px.data, px.w, px.h, 400)
        const bg = background(small.data, small.w, small.h, o)
        const fg = extractAlpha(px.data, px.w, px.h, { bg: bg.color, floor: o.floor, glow: o.glow })
        const png = path.join(outDir, `${base}.png`)
        await fs.writeFile(png, await encodePng(fg, px.w, px.h))
        written.push(png)
        result.pngs.push(png)
        if (o.jpg) {
          const jpg = path.join(outDir, `${base}-preview.jpg`.length <= 30 ? `${base}-preview.jpg` : `${base.slice(0, 22)}-pv.jpg`)
          await previewJpegFile(png, jpg, o.jpgStyle, o.jpgColor, o.jpgText.trim())
          written.push(jpg)
        }
        if (o.psd) {
          const psd = path.join(outDir, `${base}.psd`)
          await fs.writeFile(psd, encodePsd(fg, px.w, px.h, bg.color, 'Efek'))
          written.push(psd)
        }
        // Tanda AI dan catatan ikut dari file asal (mis. hasil Buat Gambar).
        const m = await getMeta(src)
        const ai = Boolean(m?.aiGenerated) || Boolean(o.aiSource)
        await updateMeta(png, {
          aiGenerated: ai,
          notes: [m?.notes, 'Transparent PNG: isolated effect on transparent background, no background.'].filter(Boolean).join(' ').slice(0, 500)
        }).catch(() => undefined)

        if (agencies.length) {
          const skip = skippedForAi(agencies, ai)
          for (const a of skip) aiSkipped.set(a, (aiSkipped.get(a) ?? 0) + 1)
          const use = agencies.filter((a) => !skip.includes(a))
          let psdFile = ''
          for (const f of planAgencyFiles(base, use)) {
            const dest = path.join(outDir, ...f.rel.split('/'))
            await fs.mkdir(path.dirname(dest), { recursive: true })
            if (f.kind === 'png') {
              await fs.copyFile(png, dest)
            } else if (f.kind === 'psd') {
              const buf = encodePsd(fg, px.w, px.h, bg.color, 'Efek')
              await fs.writeFile(dest, buf)
              if (f.agency === 'freepik' && buf.length < FREEPIK_PSD_MIN) smallPsd++
              psdFile = dest
            } else if (f.agency === 'freepik' && psdFile) {
              // Pratinjau Freepik = gambar gabungan PSD itu sendiri, sisi terpanjang maks 10.000 px.
              await psdPreviewJpeg(psdFile, dest)
            } else {
              // JPG bersih: efek di atas latar aslinya, tanpa teks (siap jual, bukan pratinjau).
              await previewJpegFile(png, dest, 'color', hex(bg.color), '')
            }
            written.push(dest)
            if (f.main) {
              result.agencyFiles!.push(dest)
              const kind = f.kind === 'png' ? 'Transparent PNG: isolated effect on transparent background.' : 'Effect on solid background, easy to blend (screen/multiply).'
              await updateMeta(dest, { aiGenerated: ai, notes: [m?.notes, kind].filter(Boolean).join(' ').slice(0, 500) }).catch(() => undefined)
            }
          }
        }
      } catch (err) {
        result.errors.push({ path: src, error: String((err as Error)?.message ?? err) })
      }
      // Beri kesempatan antrean upload dan tampilan bergerak di antara gambar besar.
      await new Promise((r) => setImmediate(r))
    }
    result.files = written.length
    if (agencies.length) {
      result.notes = []
      for (const [a, n] of aiSkipped) result.notes.push(`${ALPHA_AGENCIES[a].label}: ${n} gambar AI dilewati (agensi ini menolak konten AI).`)
      if (smallPsd) result.notes.push(`Freepik: ${smallPsd} PSD di bawah 1,5 MB (batas minimal Freepik). Pakai gambar lebih besar.`)
    }
    if (o.zip && written.length) {
      const zipPath = `${outDir}.zip`
      await writeZip(zipPath, written, outDir)
      result.zipPath = zipPath
    }
    send({ done: files.length, total: files.length, current: '', errors: result.errors.length })
    return result
  } finally {
    running = false
  }
}
