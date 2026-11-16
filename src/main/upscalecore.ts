/**
 * Inti upscale tanpa Electron (supaya bisa dites): rencana ukuran, flag program Real-ESRGAN,
 * baca progres, jalankan program, dan pesan error yang bisa dipahami.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { UPSCALE_MAX_PIXELS, UPSCALE_MODELS, type UpscaleModel, type UpscaleScale } from '../shared/upscale.ts'

export function binaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan'
}

export type UpscalePlan = {
  /** Skala yang dijalankan model (x4plus selalu 4). */
  modelScale: UpscaleScale
  /** Ukuran akhir setelah diperkecil ke skala yang diminta. */
  width: number
  height: number
  /** Skala akhir (bisa lebih kecil dari permintaan kalau melewati batas piksel). */
  scale: number
  capped: boolean
}

export function planUpscale(w: number, h: number, scale: UpscaleScale, model: UpscaleModel, maxPixels = UPSCALE_MAX_PIXELS): UpscalePlan {
  if (!(w > 0 && h > 0)) throw new Error('Ukuran gambar tidak terbaca.')
  const m = UPSCALE_MODELS[model]
  if (!m) throw new Error(`Model upscale "${model}" tidak dikenal.`)
  const modelScale = m.scales.includes(scale) ? scale : m.scales[m.scales.length - 1]
  let s: number = scale
  let capped = false
  if (w * h * s * s > maxPixels) {
    s = Math.sqrt(maxPixels / (w * h))
    capped = true
  }
  if (s < 1) s = 1
  // Dibulatkan ke bawah kalau dibatasi, supaya tidak melewati batas piksel.
  const r = capped ? Math.floor : Math.round
  return { modelScale, width: r(w * s), height: r(h * s), scale: s, capped }
}

export function buildUpscaleArgs(o: { input: string; output: string; model: UpscaleModel; modelScale: UpscaleScale; modelsDir: string }): string[] {
  return ['-i', o.input, '-o', o.output, '-n', UPSCALE_MODELS[o.model].file, '-s', String(o.modelScale), '-m', o.modelsDir, '-f', 'png']
}

/** Program mencetak baris seperti "12.50%"; ambil yang terakhir dalam potongan teks. */
export function parseProgress(text: string): number | null {
  const all = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)%/g)]
  if (!all.length) return null
  const v = Number(all[all.length - 1][1])
  return v >= 0 && v <= 100 ? v / 100 : null
}

/** Ubah keluaran program yang gagal jadi pesan yang bisa ditindaklanjuti. */
export function friendlyUpscaleError(stderr: string, code: number | null, platform: NodeJS.Platform = process.platform): string {
  const s = stderr.toLowerCase()
  if (/vkcreateinstance|vulkan|invalid gpu|gpu device|no gpu|failed to create gpu instance|vkenumeratephysicaldevices/.test(s)) {
    return platform === 'win32'
      ? 'Kartu grafis tidak bisa dipakai (Vulkan). Perbarui driver NVIDIA/AMD/Intel lalu coba lagi. Gambar disimpan tanpa upscale AI.'
      : 'Kartu grafis tidak bisa dipakai untuk upscale. Gambar disimpan tanpa upscale AI.'
  }
  if (/out of memory|vk_error_out_of_device_memory|bad_alloc/.test(s)) return 'Memori kartu grafis tidak cukup. Pakai model "Cepat" atau skala lebih kecil.'
  if (/decode image .* failed|image decode failed/.test(s)) return 'Gambar tidak bisa dibaca oleh upscaler.'
  if (/encode image .* failed/.test(s)) return 'Hasil upscale tidak bisa ditulis (disk penuh atau folder tidak bisa ditulisi?).'
  if (/model|param|\.bin/.test(s) && /fail|error|not found/.test(s)) return 'File model upscale tidak lengkap. Pasang ulang aplikasi.'
  const last = stderr.trim().split(/\r?\n/).filter((l) => l.trim() && !/^\s*\d{1,3}(\.\d+)?%\s*$/.test(l)).slice(-1)[0]
  return `Upscale gagal${code !== null ? ` (kode ${code})` : ''}${last ? `: ${last.slice(0, 200)}` : '.'}`
}

/** Jalankan program upscale. Gagal kalau keluar dengan kode bukan 0 atau berkas keluaran tidak ada. */
export function runUpscaler(
  binary: string,
  args: string[],
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
  timeoutMs = 15 * 60_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Dibatalkan.'))
    const child = spawn(binary, args, { cwd: path.dirname(binary), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    let timedOut = false
    const onData = (d: Buffer) => {
      const t = d.toString()
      err = (err + t).slice(-20_000)
      const p = parseProgress(t)
      if (p !== null) onProgress?.(p)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    const abort = () => child.kill()
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new Error(e.code === 'ENOENT' ? 'Program upscale tidak ditemukan. Pasang ulang aplikasi.' : e.code === 'EACCES' ? 'Program upscale tidak bisa dijalankan (izin). Pasang ulang aplikasi.' : e.message))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) return reject(new Error('Dibatalkan.'))
      if (timedOut) return reject(new Error(`Upscale terlalu lama (lebih dari ${Math.round(timeoutMs / 60000) || 1} menit). Coba model "Cepat" atau skala lebih kecil.`))
      // Program ini kadang keluar dengan 0 walau gagal; pemanggil tetap mengecek berkas keluaran.
      if (code === 0 && !/failed|error/i.test(err.split(/\r?\n/).filter((l) => !/%\s*$/.test(l)).join('\n'))) return resolve()
      reject(new Error(friendlyUpscaleError(err, code)))
    })
  })
}
