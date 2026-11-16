/** Upscale AI di komputer sendiri (Real-ESRGAN, lewat kartu grafis). */

export type UpscaleModel = 'general' | 'anime' | 'fast'
export type UpscaleFormat = 'jpg' | 'png' | 'webp'
export type UpscaleScale = 2 | 3 | 4

export type UpscaleOptions = {
  enabled: boolean
  model: UpscaleModel
  scale: UpscaleScale
  format: UpscaleFormat
}

export const UPSCALE_DEFAULTS: UpscaleOptions = { enabled: false, model: 'general', scale: 4, format: 'jpg' }

export const UPSCALE_MODELS: Record<UpscaleModel, { label: string; hint: string; file: string; scales: UpscaleScale[] }> = {
  general: {
    label: 'Foto & umum (x4plus)',
    hint: 'Paling tajam untuk foto, produk, pemandangan. Paling berat.',
    file: 'realesrgan-x4plus',
    scales: [4]
  },
  anime: {
    label: 'Ilustrasi & anime (x4plus-anime)',
    hint: 'Untuk ilustrasi, kartun, garis tegas, warna rata.',
    file: 'realesrgan-x4plus-anime',
    scales: [4]
  },
  fast: {
    label: 'Cepat (animevideov3)',
    hint: 'Jauh lebih ringan; cocok untuk komputer tanpa kartu grafis kuat.',
    file: 'realesr-animevideov3',
    scales: [2, 3, 4]
  }
}

export const UPSCALE_FORMATS: Record<UpscaleFormat, string> = {
  jpg: 'JPG (microstock, transparan → putih)',
  png: 'PNG (transparan tetap)',
  webp: 'WebP (kecil, transparan tetap)'
}

/** Batas hasil: lebih dari ini skala diturunkan (Adobe Stock maks 100 MP; memori juga terbatas). */
export const UPSCALE_MAX_PIXELS = 64_000_000
