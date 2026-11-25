/** Kategori dan aturan metadata yang dipakai bersama oleh proses utama dan tampilan. */

export const ADOBE_CATEGORIES: Record<number, string> = {
  1: 'Animals',
  2: 'Buildings and Architecture',
  3: 'Business',
  4: 'Drinks',
  5: 'The Environment',
  6: 'States of Mind',
  7: 'Food',
  8: 'Graphic Resources',
  9: 'Hobbies and Leisure',
  10: 'Industry',
  11: 'Landscape',
  12: 'Lifestyle',
  13: 'People',
  14: 'Plants and Flowers',
  15: 'Culture and Religion',
  16: 'Science',
  17: 'Social Issues',
  18: 'Sports',
  19: 'Technology',
  20: 'Transport',
  21: 'Travel'
}

export const SHUTTERSTOCK_CATEGORIES = [
  'Abstract',
  'Animals/Wildlife',
  'Arts',
  'Backgrounds/Textures',
  'Beauty/Fashion',
  'Buildings/Landmarks',
  'Business/Finance',
  'Education',
  'Food and drink',
  'Healthcare/Medical',
  'Holidays',
  'Industrial',
  'Interiors',
  'Miscellaneous',
  'Nature',
  'Objects',
  'Parks/Outdoor',
  'People',
  'Religion',
  'Science',
  'Signs/Symbols',
  'Sports/Recreation',
  'Technology',
  'Transportation',
  'Vintage'
]

export type AiMode = 'hemat' | 'gratis' | 'detail'

export const AI_MODES: Record<AiMode, { label: string; model: string; fallback: string[]; hint: string }> = {
  hemat: {
    label: 'Hemat',
    model: 'go/gemini-3.1-flash-lite',
    fallback: ['qw/qwen3.8-omni-flash'],
    hint: 'Video: 9 frame jadi 1 lembar kontak. Sekitar Rp 3 per file.'
  },
  gratis: {
    label: 'Gratis',
    model: 'nvidia/nemotron-3.5-super-vl-free',
    fallback: ['go/gemini-3.1-flash-lite'],
    hint: 'Model gratis (dibatasi per menit). Kalau penuh, otomatis pindah ke Hemat.'
  },
  detail: {
    label: 'Detail',
    model: 'google/gemini-3.1-flash-lite',
    fallback: ['go/gemini-3.1-flash-lite'],
    hint: 'Video: 12 frame terpisah beserta waktunya, lebih teliti membaca gerakan. Sekitar Rp 20 per video.'
  }
}

export const AGENCY_CSV: { key: string; name: string; note?: string }[] = [
  { key: 'adobe', name: 'Adobe Stock' },
  { key: 'shutterstock', name: 'Shutterstock' },
  { key: 'vecteezy', name: 'Vecteezy' },
  { key: 'freepik', name: 'Magnific (Freepik)' },
  { key: 'pond5', name: 'Pond5' },
  { key: 'dreamstime', name: 'Dreamstime' },
  { key: '123rf', name: '123RF' }
]

export type FileMeta = {
  title: string
  description: string
  keywords: string[]
  adobeCategory: number
  ssCategories: string[]
  aiGenerated: boolean
  /** Catatan pengguna untuk AI, mis. "dibuat dengan AI, seamless loop". */
  notes: string
}

export type MetaStatus = 'none' | 'generating' | 'ready' | 'saved' | 'error'

export type MetaRecord = FileMeta & {
  path: string
  name: string
  size: number
  status: MetaStatus
  model?: string
  generatedAt?: number
  injectedAt?: number
  /** Pesan kalau gagal generate / inject. */
  error?: string
  /** Gambar kecil (data URL JPEG) untuk tampilan. */
  thumb?: string
  /** Data teknis singkat, mis. "1920×1080 · 10 dtk · loop". */
  tech?: string
}

export const EMPTY_META: FileMeta = {
  title: '',
  description: '',
  keywords: [],
  adobeCategory: 8,
  ssCategories: [],
  aiGenerated: false,
  notes: ''
}

/** Bisa ditanam ke file? SVG dan ZIP hanya lewat CSV. */
export function canInject(ext: string): boolean {
  return ['jpg', 'jpeg', 'png', 'eps', 'ai', 'psd', 'psb', 'mp4', 'mov'].includes(ext.toLowerCase())
}

// Nama merek dan nama dagang yang dilarang di keyword stok. Kata umum yang juga
// punya arti biasa (apple, amazon, galaxy, windows) sengaja tidak masuk daftar.
const BANNED = new Set([
  'iphone', 'ipad', 'macbook', 'samsung', 'google', 'microsoft', 'facebook', 'instagram', 'tiktok', 'youtube', 'twitter',
  'whatsapp', 'netflix', 'nike', 'adidas', 'coca-cola', 'cocacola', 'pepsi', 'mcdonalds', 'starbucks', 'disney', 'marvel',
  'pixar', 'lego', 'barbie', 'tesla', 'bmw', 'ferrari', 'porsche', 'playstation', 'xbox', 'nintendo', 'pokemon', 'chatgpt',
  'openai', 'midjourney', 'shutterstock', 'getty', 'istock', 'unsplash'
])

/**
 * Satu keyword → hanya huruf a-z, angka, spasi, dan tanda hubung di dalam kata (mis. "t-shirt").
 * Karakter khusus (. , ! ? @ & / + * % $ : ; | ~ ^ _ = < > \\ ' " # tanda kurung, emoji, dll) dibuang;
 * huruf beraksen jadi huruf biasa ("café" → "cafe"); apostrof dibuang ("women's" → "womens").
 * Hasil kosong berarti keyword tidak layak dipakai.
 */
export function cleanKeyword(k: unknown): string {
  return String(k ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2018\u2019\u02bc`]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join(' ')
}

/** Daftar keyword → bersih, tanpa kosong/dobel, maksimal 49. Urutan dipertahankan. */
export function cleanKeywords(list: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of list) {
    const w = cleanKeyword(k)
    if (w && !seen.has(w)) {
      seen.add(w)
      out.push(w)
    }
  }
  return out.slice(0, 49)
}

/** Rapikan hasil AI supaya selalu sesuai aturan SEO microstock. */
export function cleanMeta(raw: Partial<Record<string, unknown>>, prev?: Partial<FileMeta>): FileMeta {
  const str = (v: unknown) => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim()

  let title = str(raw.title).replace(/^["'“]+|["'”.]+$/g, '')
  if (title.length > 70) {
    const cut = title.slice(0, 71)
    title = cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[\s,;:–-]+$/, '')
  }

  let description = str(raw.description)
  if (description.length > 200) {
    const cut = description.slice(0, 201)
    description = cut.slice(0, Math.max(cut.lastIndexOf(' '), 120)).replace(/[\s,;:–-]+$/, '') + '.'
  }
  if (!description) description = title

  const rawKw = Array.isArray(raw.keywords) ? raw.keywords : String(raw.keywords ?? '').split(/[,;\n]/)
  const seen = new Set<string>()
  let keywords: string[] = []
  for (const k of rawKw) {
    const w = cleanKeyword(k)
    if (!w || w.length > 40 || w.split(' ').length > 3) continue
    if (w.split(/[\s-]/).some((part) => BANNED.has(part))) continue
    if (seen.has(w)) continue
    seen.add(w)
    keywords.push(w)
  }

  // Kata penting di judul harus ada di 10 keyword pertama.
  const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'in', 'on', 'for', 'to', 'at', 'by', 'from', 'over', 'into', 'its', 'is'])
  const titleWords = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !BANNED.has(w))
  const front: string[] = []
  for (const w of titleWords) {
    if (front.length >= 6) break
    if (!front.includes(w)) front.push(w)
  }
  const top = keywords.slice(0, 10)
  const missing = front.filter((w) => !top.includes(w))
  if (missing.length) {
    keywords = keywords.filter((k) => !missing.includes(k))
    keywords.splice(Math.min(keywords.length, 10 - missing.length), 0, ...missing)
  }
  keywords = keywords.slice(0, 49)

  let adobeCategory = Number(raw.adobeCategory ?? raw.category)
  if (!ADOBE_CATEGORIES[adobeCategory]) adobeCategory = prev?.adobeCategory ?? 8

  const ssRaw = Array.isArray(raw.shutterstockCategories) ? raw.shutterstockCategories : []
  const ssCategories = ssRaw
    .map((c) => SHUTTERSTOCK_CATEGORIES.find((x) => x.toLowerCase() === String(c).toLowerCase().trim()))
    .filter((c): c is string => Boolean(c))
    .filter((c, i, a) => a.indexOf(c) === i)
    .slice(0, 2)

  return {
    title,
    description,
    keywords,
    adobeCategory,
    ssCategories: ssCategories.length ? ssCategories : (prev?.ssCategories ?? []),
    aiGenerated: prev?.aiGenerated || raw.isAiGenerated === true,
    notes: prev?.notes ?? ''
  }
}
