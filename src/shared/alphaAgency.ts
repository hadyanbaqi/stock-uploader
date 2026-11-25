/**
 * Transparan → paket per agensi. Tiap agensi minta jenis file berbeda untuk efek di latar transparan:
 * Adobe/Vecteezy/Pond5 menerima PNG transparan, Shutterstock/123RF/Dreamstime/Depositphotos/Alamy hanya JPG,
 * Freepik minta PSD + JPG pratinjau bernama sama. Nama folder sama dengan yang dikenali agencyFromPath.
 * Aturan dicek November 2026 (lihat README bagian "Transparan per agensi").
 */

export type AlphaAgency = 'adobe' | 'shutterstock' | 'freepik' | 'vecteezy' | 'pond5' | '123rf' | 'dreamstime' | 'depositphotos' | 'alamy'
export type AlphaOutKind = 'png' | 'jpg' | 'psd'

export type AlphaAgencyRule = {
  folder: string
  label: string
  /** File yang ditulis; yang pertama adalah file utama (yang diberi metadata/diupload). */
  files: AlphaOutKind[]
  /** Minimal megapiksel. */
  minMp: number
  /** Minimal sisi terpanjang (px). */
  minSide?: number
  /** Minimal sisi terpendek (px), mis. Magnific: tiap sisi ≥ 2.000 px. */
  minShort?: number
  /** Maksimal sisi terpanjang untuk JPG (px). */
  maxSide?: number
  /** false = agensi ini menolak gambar buatan AI; file AI dilewati untuk agensi ini. */
  acceptsAi: boolean
  note: string
}

export const ALPHA_AGENCIES: Record<AlphaAgency, AlphaAgencyRule> = {
  adobe: {
    folder: 'ADOBE-STOCK',
    label: 'Adobe Stock',
    files: ['png'],
    minMp: 4,
    acceptsAi: true,
    note: 'PNG transparan 4–100 MP, maks 45 MB, sRGB. Unggah lewat portal web Contributor; centang "dibuat dengan AI" bila perlu.'
  },
  shutterstock: {
    folder: 'SHUTTERSTOCK',
    label: 'Shutterstock',
    files: ['jpg'],
    minMp: 4,
    acceptsAi: false,
    note: 'JPG ≥ 4 MP sRGB (efek di atas latar aslinya). PNG dan PSD ditolak; EPS hanya untuk vektor asli, bukan efek piksel. Gambar AI tidak diterima.'
  },
  freepik: {
    folder: 'FREEPIK',
    label: 'Magnific (Freepik)',
    files: ['psd', 'jpg'],
    minMp: 0,
    minShort: 2000,
    maxSide: 10000,
    acceptsAi: true,
    note: 'PSD (1,5–325 MB) + JPG pratinjau bernama sama (0,5–80 MB), tiap sisi 2.000–10.000 px. Upload lewat sFTP ke folder psd/ (otomatis).'
  },
  vecteezy: {
    folder: 'VECTEEZY',
    label: 'Vecteezy',
    files: ['png'],
    minMp: 4,
    acceptsAi: true,
    note: 'PNG transparan ≥ 4 MP, maks 50 MB. Tandai bila dibuat dengan AI.'
  },
  pond5: {
    folder: 'POND5',
    label: 'Pond5',
    files: ['png'],
    minMp: 4,
    minSide: 2000,
    acceptsAi: false,
    note: 'PNG transparan, minimal 2.000 px. Konten AI generatif ditolak.'
  },
  '123rf': {
    folder: '123RF',
    label: '123RF',
    files: ['jpg'],
    minMp: 6,
    acceptsAi: true,
    note: 'JPG ≥ 6 MP, maks 30 MB. PNG/PSD tidak diterima. Tandai bila dibuat dengan AI.'
  },
  dreamstime: {
    folder: 'DREAMSTIME',
    label: 'Dreamstime',
    files: ['jpg'],
    minMp: 3,
    acceptsAi: true,
    note: 'JPG ≥ 3 MP. Tandai bila dibuat dengan AI.'
  },
  depositphotos: {
    folder: 'DEPOSITPHOTOS',
    label: 'Depositphotos',
    files: ['jpg'],
    minMp: 4,
    acceptsAi: true,
    note: 'JPG ≥ 4 MP. Tandai bila dibuat dengan AI.'
  },
  alamy: {
    folder: 'ALAMY',
    label: 'Alamy',
    files: ['jpg'],
    minMp: 6,
    acceptsAi: false,
    note: 'JPG ≥ 17 MB tanpa kompresi (±6 MP), lewat folder Stock di FTP. Konten AI ditolak.'
  }
}

export const ALPHA_AGENCY_ORDER = Object.keys(ALPHA_AGENCIES) as AlphaAgency[]

export function isAlphaAgency(v: unknown): v is AlphaAgency {
  return typeof v === 'string' && v in ALPHA_AGENCIES
}

export type AgencyOutFile = { agency: AlphaAgency; kind: AlphaOutKind; /** relatif ke folder keluaran, pakai "/" */ rel: string; main: boolean }

/** Daftar file yang ditulis untuk satu gambar. Freepik: nama.psd + nama.jpg (nama sama, wajib). */
export function planAgencyFiles(base: string, agencies: AlphaAgency[]): AgencyOutFile[] {
  const out: AgencyOutFile[] = []
  for (const a of ALPHA_AGENCY_ORDER) {
    if (!agencies.includes(a)) continue
    const r = ALPHA_AGENCIES[a]
    r.files.forEach((kind, i) => out.push({ agency: a, kind, rel: `${r.folder}/${base}.${kind}`, main: i === 0 }))
  }
  return out
}

/** Faktor perbesaran (≥ 1) supaya gambar memenuhi semua agensi terpilih (megapiksel dan sisi terpanjang). */
export function agencyScale(w: number, h: number, agencies: AlphaAgency[]): number {
  if (!(w > 0 && h > 0)) return 1
  let s = 1
  for (const a of agencies) {
    const r = ALPHA_AGENCIES[a]
    if (!r) continue
    const mp = r.minMp * 1_000_000
    if (w * h * s * s < mp) s = Math.sqrt(mp / (w * h))
    if (r.minSide && Math.max(w, h) * s < r.minSide) s = r.minSide / Math.max(w, h)
    if (r.minShort && Math.min(w, h) * s < r.minShort) s = r.minShort / Math.min(w, h)
  }
  // Sedikit lebih dari batas supaya pembulatan tidak membuatnya kurang 1 piksel.
  return s > 1 ? s * 1.002 : 1
}

/** Agensi yang dilewati untuk file ini (mis. gambar AI ke Shutterstock). */
export function skippedForAi(agencies: AlphaAgency[], aiGenerated: boolean): AlphaAgency[] {
  return aiGenerated ? agencies.filter((a) => !ALPHA_AGENCIES[a].acceptsAi) : []
}

/**
 * Nama file di folder utama Transparan. PNG, JPG, dan PSD memakai nama dasar yang SAMA
 * (beda ekstensi saja), karena Freepik mewajibkan JPG pratinjau bernama sama dengan PSD-nya.
 */
export function rootFileNames(base: string): { png: string; jpg: string; psd: string } {
  return { png: `${base}.png`, jpg: `${base}.jpg`, psd: `${base}.psd` }
}
