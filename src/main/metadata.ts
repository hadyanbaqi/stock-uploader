import { app, BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { AGENCY_CSV, canInject, cleanKeywords, EMPTY_META, type FileMeta, type MetaRecord } from '../shared/metadata'
import { generateMeta } from './ai'
import { buildCsv } from './csv'
import { lookupCsv } from './csvimport'
import { makePreview, psdPreviewJpeg, PSD_PREVIEW_MIN } from './frames'
import { injectMeta } from './inject'
import { getAiKey, getSettings } from './store'

/** Metadata per file, disimpan di metadata.json; gambar kecil di folder thumbs/. */
type Stored = Omit<MetaRecord, 'thumb' | 'status'> & { status: Exclude<MetaRecord['status'], 'generating'> }

const dataFile = () => path.join(app.getPath('userData'), 'metadata.json')
const thumbDir = () => path.join(app.getPath('userData'), 'thumbs')
const thumbFile = (p: string) => path.join(thumbDir(), createHash('sha1').update(p).digest('hex') + '.jpg')

let records: Record<string, Stored> | null = null
const thumbs = new Map<string, string>()
const busy = new Set<string>()
const queue: string[] = []
let running = 0
let cancelled = false
let saveTimer: NodeJS.Timeout | null = null

async function load(): Promise<Record<string, Stored>> {
  if (records) return records
  try {
    records = JSON.parse(await fs.readFile(dataFile(), 'utf8')) as Record<string, Stored>
    // Data lama bisa berisi keyword dengan karakter khusus; rapikan sekali saat dimuat.
    for (const r of Object.values(records)) if (Array.isArray(r.keywords)) r.keywords = cleanKeywords(r.keywords)
  } catch {
    records = {}
  }
  return records
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flushMeta(), 400)
}

export async function flushMeta(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  if (!records) return
  const tmp = `${dataFile()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(records), 'utf8')
  await fs.rename(tmp, dataFile())
}

async function thumbOf(p: string): Promise<string | undefined> {
  if (thumbs.has(p)) return thumbs.get(p)
  try {
    const b = await fs.readFile(thumbFile(p))
    const url = `data:image/jpeg;base64,${b.toString('base64')}`
    thumbs.set(p, url)
    return url
  } catch {
    return undefined
  }
}

async function view(p: string): Promise<MetaRecord> {
  const all = await load()
  const r = all[p]
  return { ...(r ?? fresh(p, 0)), status: busy.has(p) ? 'generating' : (r?.status ?? 'none'), thumb: await thumbOf(p) }
}

function fresh(p: string, size: number): Stored {
  return { ...EMPTY_META, path: p, name: path.basename(p), size, status: 'none' }
}

async function emit(p: string): Promise<void> {
  const rec = await view(p)
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('meta:record', rec)
}

/** Data metadata untuk daftar file. File yang berubah dari luar dianggap file baru. */
export async function listMeta(paths: string[]): Promise<MetaRecord[]> {
  const all = await load()
  const out: MetaRecord[] = []
  for (const p of paths) {
    let size = 0
    try {
      size = (await fs.stat(p)).size
    } catch {
      // file hilang: tetap tampilkan apa yang ada
    }
    const r = all[p]
    if (!r || (size && r.size !== size)) {
      all[p] = { ...fresh(p, size), notes: r?.notes ?? '' }
      thumbs.delete(p)
      scheduleSave()
    }
    out.push(await view(p))
  }
  return out
}

export async function updateMeta(p: string, patch: Partial<FileMeta>): Promise<MetaRecord> {
  const all = await load()
  const r = all[p] ?? fresh(p, (await fs.stat(p).catch(() => ({ size: 0 }))).size)
  const next: Stored = { ...r, ...patch }
  if (patch.keywords) {
    next.keywords = cleanKeywords(patch.keywords)
  }
  if (patch.title !== undefined) next.title = patch.title.slice(0, 200)
  const edited = ['title', 'description', 'keywords', 'adobeCategory', 'ssCategories', 'aiGenerated'].some((k) => k in patch)
  if (edited && (next.title || next.keywords.length)) {
    next.status = 'ready'
    next.error = undefined
  }
  all[p] = next
  scheduleSave()
  await emit(p)
  return view(p)
}

/**
 * Tambah keyword manual ke banyak file sekaligus (semua atau yang dipilih).
 * Keyword dibersihkan dari karakter khusus, tidak dobel, maksimal 49 per file.
 * "front" = di depan (masuk 10 keyword terpenting), "back" = di belakang.
 */
export async function addKeywords(
  paths: string[],
  words: string[],
  position: 'front' | 'back'
): Promise<{ updated: number; unchanged: number; skippedBusy: number; full: number; keywords: string[] }> {
  const add = cleanKeywords(words)
  const out = { updated: 0, unchanged: 0, skippedBusy: 0, full: 0, keywords: add }
  if (!add.length) return out
  const all = await load()
  for (const p of paths) {
    if (busy.has(p) || queue.includes(p)) {
      out.skippedBusy++
      continue
    }
    const cur = all[p]?.keywords ?? []
    // Yang sudah ada tidak dobel; kalau ditaruh di depan, pindah ke depan.
    const merged = position === 'front' ? cleanKeywords([...add, ...cur]) : cleanKeywords([...cur, ...add])
    if (merged.join('|') === cur.join('|')) {
      out.unchanged++
      if (position === 'back' && cur.length >= 49 && !add.every((w) => cur.includes(w))) out.full++
      continue
    }
    if (position === 'back' && cur.length >= 49) out.full++
    const prev = all[p]
    const prevStatus = prev?.status ?? 'none'
    const hadTitle = Boolean(prev?.title)
    await updateMeta(p, { keywords: merged })
    // File yang belum punya judul tetap "Belum ada", supaya tombol "Buat metadata" masih menghitungnya.
    if (!hadTitle && all[p]) {
      all[p].status = prevStatus
      scheduleSave()
      await emit(p)
    }
    out.updated++
  }
  return out
}

/** Masukkan file ke antrean generate AI (2 file sekaligus). */
export async function generate(paths: string[], overwrite: boolean): Promise<{ queued: number; skipped: number }> {
  if (!(await getAiKey())) throw new Error('Isi API key Ciora dulu di halaman Pengaturan.')
  const all = await load()
  cancelled = false
  let queued = 0
  let skipped = 0
  for (const p of paths) {
    const r = all[p]
    if (busy.has(p) || queue.includes(p)) continue
    // Hemat kredit: file yang sudah punya metadata tidak di-generate ulang, kecuali diminta.
    if (!overwrite && r && (r.status === 'ready' || r.status === 'saved') && r.title) {
      skipped++
      continue
    }
    queue.push(p)
    busy.add(p)
    queued++
    void emit(p)
  }
  pump()
  return { queued, skipped }
}

export function cancelGenerate(): void {
  cancelled = true
  for (const p of queue.splice(0)) {
    busy.delete(p)
    void emit(p)
  }
}

function pump(): void {
  while (running < 2 && queue.length) {
    const p = queue.shift()!
    running++
    void runOne(p).finally(() => {
      running--
      busy.delete(p)
      void emit(p)
      pump()
    })
  }
}

async function runOne(p: string): Promise<void> {
  const all = await load()
  const st = await fs.stat(p).catch(() => null)
  const r = all[p] ?? fresh(p, st?.size ?? 0)
  try {
    if (!st) throw new Error('File tidak ditemukan.')
    const settings = await getSettings()
    const key = await getAiKey()
    if (!key) throw new Error('Isi API key Ciora dulu di halaman Pengaturan.')
    const pv = await makePreview(p, settings.aiMode)
    await fs.mkdir(thumbDir(), { recursive: true })
    await fs.writeFile(thumbFile(p), Buffer.from(pv.thumb.split(',')[1], 'base64'))
    thumbs.set(p, pv.thumb)
    if (cancelled) throw new Error('Dibatalkan.')
    const res = await generateMeta({
      apiKey: key,
      mode: settings.aiMode,
      images: pv.images,
      labels: pv.labels,
      fileName: path.basename(p),
      tech: pv.tech,
      notes: r.notes,
      prev: r
    })
    all[p] = {
      ...r,
      ...res.meta,
      notes: r.notes,
      size: st.size,
      status: 'ready',
      model: res.model,
      generatedAt: Date.now(),
      tech: pv.tech,
      error: undefined
    }
  } catch (err) {
    const keep = r.status === 'saved' ? 'saved' : 'ready'
    all[p] = { ...r, status: r.title ? keep : 'error', error: String((err as Error)?.message ?? err) }
  }
  scheduleSave()
}

/** JPG pratinjau dengan nama sama di folder yang sama, kalau ada. */
function previewSibling(p: string): string | null {
  const base = p.slice(0, p.length - path.extname(p).length)
  for (const e of ['jpg', 'jpeg', 'JPG', 'JPEG']) if (existsSync(`${base}.${e}`)) return `${base}.${e}`
  return null
}

export async function inject(
  paths: string[]
): Promise<{ saved: number; csvOnly: number; failed: number; previews: number; smallPreviews: string[] }> {
  const all = await load()
  const backupDir = path.join(app.getPath('userData'), 'cadangan-file-asli')
  let saved = 0
  let csvOnly = 0
  let failed = 0
  let previews = 0
  const smallPreviews: string[] = []
  for (const p of paths) {
    const r = all[p]
    if (!r || !r.title || busy.has(p)) continue
    const ext = path.extname(p).slice(1)
    if (!canInject(ext)) {
      csvOnly++
      continue
    }
    try {
      await injectMeta(p, r, backupDir)
      const st = await fs.stat(p)
      all[p] = { ...r, size: st.size, status: 'saved', injectedAt: Date.now(), error: undefined }
      saved++
      // Freepik/Magnific: PSD wajib disertai JPG pratinjau bernama sama. Buat kalau belum ada.
      if ((ext.toLowerCase() === 'psd' || ext.toLowerCase() === 'psb') && !previewSibling(p)) {
        const jpg = `${p.slice(0, p.length - path.extname(p).length)}.jpg`
        try {
          const size = await psdPreviewJpeg(p, jpg)
          await injectMeta(jpg, r, backupDir)
          previews++
          if (Math.max(size.width, size.height) < PSD_PREVIEW_MIN) smallPreviews.push(path.basename(jpg))
        } catch (err) {
          all[p] = { ...all[p], error: `Metadata tertanam, tapi JPG pratinjau gagal dibuat: ${String((err as Error)?.message ?? err)}` }
        }
      }
    } catch (err) {
      const msg = String((err as Error)?.message ?? err)
      all[p] = {
        ...r,
        error: /movie fragments/i.test(msg)
          ? 'Video ini berformat MP4 terfragmen (mis. hasil rekaman layar), jadi tidak bisa ditanami. Metadata tetap masuk lewat CSV.'
          : `Gagal menanam: ${msg.replace(/&#39;/g, "'")}`
      }
      failed++
    }
    await emit(p)
  }
  scheduleSave()
  return { saved, csvOnly, failed, previews, smallPreviews }
}

export async function exportCsv(paths: string[], agencies: string[], folder: string): Promise<{ files: string[]; rows: number }> {
  const all = await load()
  const items = paths
    .map((p) => all[p])
    .filter((r): r is Stored => Boolean(r?.title && r.keywords.length))
    .map((r) => ({ name: r.name, ext: path.extname(r.name).slice(1), meta: r }))
  if (!items.length) throw new Error('Belum ada file yang punya metadata.')
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const files: string[] = []
  for (const a of agencies) {
    if (!AGENCY_CSV.some((x) => x.key === a)) continue
    const f = path.join(folder, `metadata-${a}-${stamp}.csv`)
    await fs.writeFile(f, buildCsv(a, items), 'utf8')
    files.push(f)
  }
  return { files, rows: items.length }
}

/**
 * Isi metadata dari CSV yang sudah ada (tanpa AI). `csvFiles` kosong = cari CSV otomatis di sekitar file.
 * File yang sudah punya metadata tidak ditimpa, kecuali `overwrite`.
 */
export async function importFromCsv(
  paths: string[],
  csvFiles: string[] | undefined,
  overwrite: boolean
): Promise<{ filled: number; notFound: number; skipped: number; sources: string[] }> {
  const all = await load()
  const want: string[] = []
  let skipped = 0
  for (const p of paths) {
    const r = all[p]
    if (busy.has(p)) continue
    if (!overwrite && r?.title && (r.status === 'ready' || r.status === 'saved')) {
      skipped++
      continue
    }
    want.push(p)
  }
  const found = await lookupCsv(want, csvFiles)
  const sources = new Set<string>()
  let filled = 0
  for (const p of want) {
    const m = found.get(p)
    if (!m) continue
    const st = await fs.stat(p).catch(() => null)
    const r = all[p] ?? fresh(p, st?.size ?? 0)
    const meta = m.meta
    all[p] = {
      ...r,
      ...meta,
      description: meta.description || r.description || meta.title || r.title,
      size: st?.size ?? r.size,
      status: 'ready',
      model: `CSV: ${m.sources.join(' + ')}`,
      generatedAt: Date.now(),
      error: undefined
    }
    m.sources.forEach((s) => sources.add(s))
    filled++
    await emit(p)
  }
  if (filled) scheduleSave()
  return { filled, notFound: want.length - filled, skipped, sources: [...sources] }
}

/** File yang ditandai "Dibuat dengan AI generatif". */
export async function aiFlags(paths: string[]): Promise<string[]> {
  const all = await load()
  return paths.filter((p) => all[p]?.aiGenerated)
}

/** Metadata tersimpan untuk satu file (tanpa membuat baru). */
export async function getMeta(p: string): Promise<FileMeta | null> {
  const r = (await load())[p]
  return r ?? null
}
