/**
 * Adobe Stock SFTP (dashboard: Upload → "Importing files using SFTP", Nov 2026):
 * - sftp://sftp.contributor.adobestock.com (port 22), username = ID kontributor (angka), password dari "Generate password".
 * - Kirim file satu per satu di folder utama: file di dalam folder atau arsip (ZIP) TIDAK dihitung.
 * - Vektor (EPS/AI/SVG) dikirim sendiri; Adobe membuat pratinjau JPEG otomatis, jadi JPG pasangannya jangan ikut dikirim
 *   (kalau ikut, JPG itu masuk sebagai ilustrasi terpisah).
 * - PNG: panduan resmi hanya menyebut unggah web; lewat SFTP tidak dilarang tapi juga tidak dijamin. Tetap dikirim.
 */
export const ADOBE_HOST = 'sftp.contributor.adobestock.com'
export const ADOBE_VECTOR_EXT = ['eps', 'ai', 'svg']
export const ADOBE_ACCEPTS = ['jpg', 'jpeg', 'png', ...ADOBE_VECTOR_EXT, 'mov', 'mp4']

/** JPG yang punya EPS/AI/SVG bernama sama = pratinjau vektor, bukan file untuk dijual di Adobe. */
export function isAdobeVectorPreview(fileName: string, hasSibling: (ext: string) => boolean): boolean {
  return /\.jpe?g$/i.test(fileName) && ADOBE_VECTOR_EXT.some(hasSibling)
}
