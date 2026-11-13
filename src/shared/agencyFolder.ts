/**
 * Kenali agensi dari nama folder, mis. ".../Microstok/ADOBE-STOCK/14/file.jpg" → adobe.
 * Nama folder dibandingkan tanpa tanda baca dan huruf besar/kecil, jadi "Adobe Stock",
 * "ADOBE-STOCK" dan "adobe_stock" sama saja. Folder terdalam yang cocok yang dipakai.
 */
const ALIASES: Record<string, string> = {
  ADOBESTOCK: 'adobe',
  ADOBE: 'adobe',
  SHUTTERSTOCK: 'shutterstock',
  VECTEEZY: 'vecteezy',
  FREEPIK: 'freepik',
  DREAMSTIME: 'dreamstime',
  POND5: 'pond5',
  '123RF': '123rf',
  DEPOSITPHOTOS: 'depositphotos',
  ALAMY: 'alamy'
}

export type FolderAgency = { agency: string; /** Path folder agensi itu (tanpa nama file). */ dir: string; folderName: string }

export function agencyFromPath(p: string): FolderAgency | null {
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/'
  const parts = p.split(/[\\/]/)
  // Bagian terakhir adalah nama file, jadi mulai dari folder tempat file itu.
  for (let i = parts.length - 2; i >= 0; i--) {
    const agency = ALIASES[parts[i].toUpperCase().replace(/[^A-Z0-9]/g, '')]
    if (agency) return { agency, dir: parts.slice(0, i + 1).join(sep), folderName: parts[i] }
  }
  return null
}
