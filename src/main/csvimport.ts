import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ADOBE_CATEGORIES, SHUTTERSTOCK_CATEGORIES, cleanKeywords, type FileMeta } from '../shared/metadata.ts'
import { parseCsv, type CsvTable } from './csvtable.ts'

/**
 * Metadata yang sudah ada di CSV (metadata-master.csv, adobe-stock.csv, shutterstock.csv, vecteezy.csv,
 * atau CSV agensi lain) dipakai langsung, tanpa AI. Dicocokkan lewat nama file.
 */
export type CsvMeta = Partial<Pick<FileMeta, 'title' | 'description' | 'keywords' | 'adobeCategory' | 'ssCategories'>>
export type CsvMatch = { meta: CsvMeta; sources: string[] }

const COLS = {
  file: ['filename', 'file name', 'file', 'originalfilename', 'oldfilename'],
  title: ['title', 'image name'],
  description: ['description'],
  keywords: ['keywords', 'keyword', 'tags'],
  adobeCategory: ['adobecategory', 'category'],
  ssCategories: ['categories']
}

function keywordsOf(v: string): string[] {
  return cleanKeywords(v.split(/[,;]/))
}

/** Baris CSV → metadata per nama file (huruf kecil). */
export function metaFromTable(t: CsvTable): Map<string, CsvMeta> {
  const out = new Map<string, CsvMeta>()
  const [head, ...rows] = t.rows
  if (!head) return out
  const h = head.map((x) => x.toLowerCase().trim())
  const col = (names: string[]) => h.findIndex((x) => names.includes(x))
  const iFile = col(COLS.file)
  if (iFile < 0) return out
  const iTitle = col(COLS.title)
  const iDesc = col(COLS.description)
  const iKw = col(COLS.keywords)
  const iCat = col(COLS.adobeCategory)
  const iSs = col(COLS.ssCategories)
  for (const r of rows) {
    const name = (r[iFile] ?? '').trim()
    if (!name) continue
    const m: CsvMeta = {}
    const title = iTitle >= 0 ? (r[iTitle] ?? '').replace(/\s+/g, ' ').trim() : ''
    if (title) m.title = title.slice(0, 200)
    const desc = iDesc >= 0 ? (r[iDesc] ?? '').replace(/\s+/g, ' ').trim() : ''
    if (desc) m.description = desc.slice(0, 200)
    const kw = iKw >= 0 ? keywordsOf(r[iKw] ?? '') : []
    if (kw.length) m.keywords = kw
    const cat = iCat >= 0 ? Number((r[iCat] ?? '').trim()) : NaN
    if (ADOBE_CATEGORIES[cat]) m.adobeCategory = cat
    if (iSs >= 0) {
      const ss = (r[iSs] ?? '')
        .split(',')
        .map((c) => SHUTTERSTOCK_CATEGORIES.find((x) => x.toLowerCase() === c.trim().toLowerCase()))
        .filter((c): c is string => Boolean(c))
      if (ss.length) m.ssCategories = [...new Set(ss)].slice(0, 2)
    }
    if (Object.keys(m).length) out.set(name.toLowerCase(), m)
  }
  return out
}

/** Urutan sumber: master dulu (paling lengkap), lalu Adobe, Vecteezy, Shutterstock, lainnya. */
function rank(file: string): number {
  const n = path.basename(file).toLowerCase()
  if (n.includes('master')) return 0
  if (n.includes('adobe')) return 1
  if (n.includes('vecteezy')) return 2
  if (n.includes('shutterstock')) return 3
  return 4
}

/** CSV di sekitar file: folder file itu dan sampai 3 folder di atasnya, plus metadata-master.csv di _FILE-KERJA. */
export async function nearbyCsv(filePath: string): Promise<string[]> {
  const out: string[] = []
  let dir = path.dirname(filePath)
  for (let up = 0; up <= 3; up++) {
    try {
      for (const n of await fs.readdir(dir)) {
        if (/\.csv$/i.test(n) && !n.startsWith('.') && !/backup|cadangan/i.test(n)) out.push(path.join(dir, n))
      }
    } catch {
      // folder tidak bisa dibaca
    }
    for (const m of [path.join(dir, '_FILE-KERJA', 'metadata-master.csv')]) {
      try {
        if ((await fs.stat(m)).isFile()) out.push(m)
      } catch {
        // tidak ada
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return out
}

const cache = new Map<string, { mtime: number; size: number; map: Map<string, CsvMeta> }>()

async function readCsv(file: string): Promise<Map<string, CsvMeta>> {
  const st = await fs.stat(file)
  if (st.size > 50 * 1024 * 1024) return new Map()
  const hit = cache.get(file)
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.map
  const map = metaFromTable(parseCsv(await fs.readFile(file, 'utf8')))
  cache.set(file, { mtime: st.mtimeMs, size: st.size, map })
  return map
}

/** Gabung beberapa sumber: tiap kolom diambil dari sumber dengan urutan teratas yang mengisinya. */
export function mergeMeta(found: { file: string; meta: CsvMeta }[]): CsvMatch | null {
  if (!found.length) return null
  const sorted = [...found].sort((a, b) => rank(a.file) - rank(b.file))
  const meta: CsvMeta = {}
  const sources = new Set<string>()
  for (const f of sorted) {
    for (const k of Object.keys(f.meta) as (keyof CsvMeta)[]) {
      if (meta[k] === undefined) {
        ;(meta as Record<string, unknown>)[k] = f.meta[k]
        sources.add(path.basename(f.file))
      }
    }
  }
  if (!meta.title && !meta.keywords?.length) return null
  return { meta, sources: [...sources] }
}

/**
 * Cari metadata untuk tiap file. `csvFiles` = CSV yang dipilih sendiri;
 * kosong = cari otomatis di sekitar tiap file.
 */
export async function lookupCsv(paths: string[], csvFiles?: string[]): Promise<Map<string, CsvMatch>> {
  const out = new Map<string, CsvMatch>()
  const dirCsv = new Map<string, string[]>()
  for (const p of paths) {
    let files = csvFiles
    if (!files?.length) {
      const d = path.dirname(p)
      if (!dirCsv.has(d)) dirCsv.set(d, await nearbyCsv(p))
      files = dirCsv.get(d)!
    }
    const key = path.basename(p).toLowerCase()
    const found: { file: string; meta: CsvMeta }[] = []
    for (const f of files) {
      try {
        const m = (await readCsv(f)).get(key)
        if (m) found.push({ file: f, meta: m })
      } catch {
        // CSV rusak atau terkunci: lewati
      }
    }
    const merged = mergeMeta(found)
    if (merged) out.set(p, merged)
  }
  return out
}
