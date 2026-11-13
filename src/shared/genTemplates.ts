/** Template gaya untuk Buat Gambar: ditempel di belakang prompt pengguna. */
export const GEN_TEMPLATES: { key: string; label: string; hint: string; suffix: string }[] = [
  { key: 'none', label: 'Tanpa template', hint: 'Prompt dikirim apa adanya (tetap tanpa teks/watermark).', suffix: '' },
  {
    key: 'wallpaper',
    label: 'Wallpaper 4K',
    hint: 'Detail tinggi, komposisi penuh, cocok untuk latar.',
    suffix: 'Ultra detailed high resolution wallpaper, rich colors, balanced full-frame composition, crisp focus.'
  },
  {
    key: 'photo',
    label: 'Foto realistis',
    hint: 'Gaya foto stok komersial (Vecteezy Pro, Adobe).',
    suffix: 'Photorealistic commercial stock photo, natural lighting, sharp focus, realistic textures and materials, professional color grading.'
  },
  {
    key: 'silhouette',
    label: 'Siluet untuk vektor',
    hint: 'Hitam pekat di atas putih, tepi tajam, mudah di-trace.',
    suffix: 'Solid pure black silhouette on a pure white background, clean sharp edges, flat, high contrast, no gradients, no shading, no texture, suitable for vector tracing.'
  },
  {
    key: 'texture',
    label: 'Tekstur / overlay',
    hint: 'Tekstur penuh bidang, tanpa objek utama.',
    suffix: 'Full-frame seamless texture, evenly lit, no main subject, no objects, consistent detail across the whole image.'
  },
  {
    key: 'copyspace',
    label: 'Ruang kosong untuk teks',
    hint: 'Objek di satu sisi, sisi lain kosong.',
    suffix: 'Minimal composition with the subject on one side and large clean empty copy space on the other side, simple uncluttered background.'
  }
]

const ALWAYS = 'No text, no letters, no watermark, no logo, no brand names, no signature.'

export function buildPrompt(prompt: string, template: string): string {
  const t = GEN_TEMPLATES.find((x) => x.key === template)
  return [prompt.trim().replace(/\s+/g, ' '), t?.suffix, ALWAYS].filter(Boolean).join(' ')
}

/** Nama file dari prompt: huruf kecil, tanda hubung, maksimal 30 karakter termasuk "-n.jpg". */
export function fileBase(prompt: string, n: number): string {
  const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'in', 'on', 'for', 'to', 'at', 'by', 'from', 'over', 'into'])
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
  const max = 30 - 4 - 1 - String(n).length
  let base = ''
  for (const w of words) {
    const next = base ? `${base}-${w}` : w
    if (next.length > max) break
    base = next
  }
  return `${base || 'gambar'}-${n}`
}
