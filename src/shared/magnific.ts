/**
 * Magnific (dulu Freepik) sFTP, aturan Nov 2026 (magnific.com/ai/contributors/ftp-upload-method):
 * - sftp://uploads.magnific.com port 60022; FTP port 21 sudah tidak dipakai.
 * - Hanya untuk kontributor dengan ≥ 1.000 file terbit. Password dibuat di dashboard (Files → Upload via FTP → Get password).
 * - File TIDAK boleh di root: harus di subfolder di dalam photo/, psd/, vector/, video/, video_template/.
 */

export const MAGNIFIC_HOST = 'uploads.magnific.com'
export const MAGNIFIC_PORT = 60022
export const MAGNIFIC_FOLDERS = ['photo', 'psd', 'vector', 'video', 'video_template'] as const
export type MagnificFolder = (typeof MAGNIFIC_FOLDERS)[number]

const VECTOR_EXT = ['eps', 'ai', 'svg']
const PSD_EXT = ['psd']
const VIDEO_EXT = ['mp4', 'mov']

/** Jenis file yang diterima lewat sFTP Magnific (svg/ai opsional, menemani EPS bernama sama). */
export const MAGNIFIC_ACCEPTS = ['jpg', 'jpeg', 'eps', 'ai', 'svg', 'psd', ...VIDEO_EXT]

const extOf = (name: string) => (/\.([^./\\]+)$/.exec(name)?.[1] ?? '').toLowerCase()

/**
 * Folder tujuan untuk satu file. JPG ikut pasangannya: kalau ada EPS/AI/SVG bernama sama → vector,
 * kalau ada PSD bernama sama → psd, selain itu foto.
 * `hasSibling(ext)` = apakah ada file bernama sama dengan ekstensi itu di folder yang sama.
 */
export function magnificFolder(fileName: string, hasSibling: (ext: string) => boolean): MagnificFolder | null {
  const ext = extOf(fileName)
  if (VECTOR_EXT.includes(ext)) return 'vector'
  if (PSD_EXT.includes(ext)) return 'psd'
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (ext === 'jpg' || ext === 'jpeg') {
    if (VECTOR_EXT.some(hasSibling)) return 'vector'
    if (PSD_EXT.some(hasSibling)) return 'psd'
    return 'photo'
  }
  return null
}

/** Nama subfolder yang aman (huruf, angka, - dan _). */
export function cleanSubfolder(s: string): string {
  return s
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function defaultSubfolder(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `upload-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Folder di server untuk file ini. `accountDir` = isian "Folder tujuan" akun:
 * - kosong → "<jenis>/upload-YYYY-MM-DD"
 * - nama biasa, mis. "batch-1" → "<jenis>/batch-1"
 * - sudah diawali salah satu folder Magnific (mis. "photo/batch-1") → dipakai apa adanya.
 */
export function magnificRemoteDir(accountDir: string, fileName: string, hasSibling: (ext: string) => boolean, now = new Date()): string {
  const dir = accountDir.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const first = dir.split('/')[0]
  const isTop = (MAGNIFIC_FOLDERS as readonly string[]).includes(first)
  if (isTop && dir.includes('/')) return dir
  const folder = magnificFolder(fileName, hasSibling) ?? 'photo'
  // Cuma "photo"/"vector"/… tanpa subfolder: root folder itu juga ditolak, jadi pakai subfolder tanggal.
  const sub = (isTop ? '' : cleanSubfolder(dir.split('/').pop() ?? '')) || defaultSubfolder(now)
  return `${folder}/${sub}`
}

/** Akun Freepik lama (FTP port 21) → perlu dipindah ke sFTP Magnific. */
export function isOldFreepikTarget(t: { protocol: string; host: string; port: number }): boolean {
  return t.protocol !== 'sftp' || t.port !== MAGNIFIC_PORT || !/magnific\.com$/i.test(t.host.trim())
}
