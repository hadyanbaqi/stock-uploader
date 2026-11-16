import { ExifTool } from 'exiftool-vendored'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { canInject, type FileMeta } from '../shared/metadata.ts'

let tool: ExifTool | null = null

function et(): ExifTool {
  tool ??= new ExifTool({ maxProcs: 2, taskTimeoutMillis: 60_000 })
  return tool
}

export async function closeExifTool(): Promise<void> {
  if (tool) await tool.end().catch(() => undefined)
  tool = null
}

/**
 * Tanam judul, deskripsi, dan keyword ke file.
 * Sebelum diubah, file asli disalin dulu ke `backupDir` (sekali saja per file).
 */
export async function injectMeta(filePath: string, meta: FileMeta, backupDir: string): Promise<void> {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (!canInject(ext)) throw new Error(`File .${ext.toUpperCase()} tidak bisa ditanami metadata. Pakai CSV.`)

  await fs.mkdir(backupDir, { recursive: true })
  const backup = path.join(backupDir, path.basename(filePath))
  try {
    await fs.copyFile(filePath, backup, fs.constants.COPYFILE_EXCL)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }

  const keywords = meta.keywords.slice(0, 49)
  const tags: Record<string, unknown> = {
    'XMP-dc:Title': meta.title,
    'XMP-dc:Description': meta.description,
    'XMP-dc:Subject': keywords,
    'XMP-photoshop:Headline': meta.title
  }
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'psd' || ext === 'psb') {
    // PSD menyimpan IPTC di bagian resource Photoshop; ExifTool bisa menulisnya.
    Object.assign(tags, {
      'IPTC:ObjectName': meta.title.slice(0, 64),
      'IPTC:Headline': meta.title,
      'IPTC:Caption-Abstract': meta.description,
      'IPTC:Keywords': keywords,
      'EXIF:ImageDescription': meta.description,
      'EXIF:XPTitle': meta.title,
      'EXIF:XPKeywords': keywords.join(';')
    })
  }
  if (ext === 'mp4' || ext === 'mov') {
    Object.assign(tags, {
      'QuickTime:Title': meta.title,
      'QuickTime:Description': meta.description,
      'QuickTime:Keywords': keywords.join(', ')
    })
  }
  // Tulis berurutan per file, dan ganti file asli setelah berhasil (salinan sudah dibuat di atas).
  await et().write(filePath, tags as never, ['-overwrite_original', '-codedcharacterset=utf8', '-charset', 'iptc=utf8'])
}

/** Baca kembali metadata yang tertanam (dipakai untuk tes). */
export async function readMeta(filePath: string): Promise<{ title?: string; description?: string; keywords: string[] }> {
  const t = (await et().read(filePath)) as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : v ? String(v).split(/,\s*/) : [])
  return {
    title: (t.Title ?? t.ObjectName ?? t.Headline) as string | undefined,
    description: (t.Description ?? t['Caption-Abstract']) as string | undefined,
    keywords: list(t.Subject ?? t.Keywords)
  }
}
