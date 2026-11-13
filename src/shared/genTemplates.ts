/** Template gaya untuk Buat Gambar: ditempel di belakang prompt pengguna. */
export const GEN_TEMPLATES: { key: string; label: string; hint: string; suffix: string }[] = [
  { key: 'none', label: 'Tanpa template', hint: 'Prompt dikirim apa adanya (tetap tanpa teks/watermark).', suffix: '' },
  {
    key: 'vfx-black',
    label: 'VFX latar hitam',
    hint: 'Efek bercahaya (api, petir, partikel, cahaya) di hitam pekat — siap dijadikan PNG transparan di halaman Transparan.',
    suffix:
      'Isolated visual effect only, on a pure solid black background (#000000). Bright glowing light energy with high contrast, fine soft glow falloff, sharp detail. Nothing else in the frame: no floor, no ground, no reflection, no shadow, no vignette, no smoke haze over the background, no frame. Effect centered with empty black margin around it, nothing touching the edges.'
  },
  {
    key: 'vfx-white',
    label: 'Asap/tinta latar putih',
    hint: 'Efek gelap (asap hitam, tinta, debu, retakan) di putih bersih — untuk PNG transparan efek gelap.',
    suffix:
      'Isolated dark effect only, on a pure solid white background (#FFFFFF). Rich dark tones with soft wispy edges and fine detail. Nothing else in the frame: no floor, no shadow, no paper texture, no vignette, no frame. Effect centered with empty white margin around it, nothing touching the edges.'
  },
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

/** Contoh prompt VFX siap pakai (dipakai dengan template "VFX latar hitam"). */
export const VFX_PROMPTS: { group: string; prompts: string[] }[] = [
  {
    group: 'Api & ledakan',
    prompts: [
      'Realistic orange fire burst exploding outward with flying embers and sparks',
      'Tall burning flame column with swirling tongues of fire and glowing embers',
      'Blue gas flame ring burning in a perfect circle',
      'Fireball explosion with expanding shockwave and hot sparks',
      'Trail of fire sweeping in a curved arc with burning particles'
    ]
  },
  {
    group: 'Listrik & energi',
    prompts: [
      'Branching blue lightning bolt strike with bright electric glow',
      'Red lightning cracks spreading in all directions from the center',
      'Electric plasma ball with cyan energy tendrils',
      'Purple energy shockwave ring with glowing particles',
      'Glowing magic portal ring of swirling golden energy'
    ]
  },
  {
    group: 'Partikel & kilau',
    prompts: [
      'Golden glitter dust explosion with sparkling particles',
      'Magic fairy dust trail with twinkling stars swirling in a spiral',
      'Burst of colorful confetti-like light particles',
      'Floating glowing bokeh orbs in warm gold tones',
      'Shimmering silver star sparkles scattered in a diagonal stream'
    ]
  },
  {
    group: 'Cahaya',
    prompts: [
      'Anamorphic blue lens flare with horizontal light streak',
      'Warm golden sun flare with soft rainbow ghosting rings',
      'Neon light streaks in pink and cyan curving in motion',
      'Aurora borealis ribbon of green and violet light waves',
      'Bright light rays bursting from the center in every direction'
    ]
  },
  {
    group: 'Kosmik & alam',
    prompts: [
      'Swirling galaxy nebula cloud with bright stars in purple and blue',
      'Meteor shower with glowing fiery trails',
      'Glowing fireflies scattered in a soft cluster',
      'Exploding firework burst in red and gold with falling sparks',
      'Snowflakes and ice crystals sparkling with cold blue light'
    ]
  }
]

/** Contoh untuk template "Asap/tinta latar putih". */
export const DARK_FX_PROMPTS = [
  'Thick black smoke plume rising and curling upward',
  'Black ink splash with drops and splatters',
  'Dark dust explosion with scattered particles',
  'Shattered glass cracks spreading from an impact point',
  'Wispy grey fog cloud drifting softly'
]
