import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FileKind, PickedFile, PickResult } from '../shared/types'

export const FILE_KINDS: Record<string, FileKind> = {
  mp4: 'video',
  mov: 'video',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  psd: 'image',
  psb: 'image',
  eps: 'vector',
  ai: 'vector',
  svg: 'vector',
  zip: 'archive'
}

const MAX_FILES = 5000

/** Ubah daftar file/folder menjadi daftar file yang bisa diupload (folder dibuka sampai ke dalam). */
export async function expandPaths(paths: string[]): Promise<PickResult> {
  const seen = new Set<string>()
  const files: PickedFile[] = []
  let skipped = 0

  async function visit(p: string, depth: number): Promise<void> {
    if (files.length >= MAX_FILES) return
    let st
    try {
      st = await fs.stat(p)
    } catch {
      skipped++
      return
    }
    if (st.isDirectory()) {
      if (depth > 6) return
      let names: string[]
      try {
        names = await fs.readdir(p)
      } catch {
        skipped++
        return
      }
      names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      for (const n of names) {
        if (n.startsWith('.') || n.startsWith('~$')) continue
        await visit(path.join(p, n), depth + 1)
      }
      return
    }
    if (!st.isFile()) return
    const name = path.basename(p)
    const ext = path.extname(name).slice(1).toLowerCase()
    const kind = FILE_KINDS[ext]
    if (!kind || name.startsWith('.')) {
      skipped++
      return
    }
    const key = path.resolve(p)
    if (seen.has(key)) return
    seen.add(key)
    files.push({ path: key, name, size: st.size, ext, kind })
  }

  for (const p of paths) await visit(p, 0)
  return { files, skipped }
}
