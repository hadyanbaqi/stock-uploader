/**
 * Upscale AI di komputer ini dengan Real-ESRGAN (ncnn + Vulkan/Metal), yang ikut di dalam installer:
 *   Windows: resources/upscaler/realesrgan-ncnn-vulkan.exe (+ vcomp140.dll)
 *   Mac:     Stock Uploader.app/Contents/Resources/upscaler/realesrgan-ncnn-vulkan
 * Satu gambar diproses sekali waktu supaya kartu grafis tidak kehabisan memori.
 */
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { UpscaleOptions } from '../shared/upscale'
import { encodeScaled, imageSize } from './frames'
import { binaryName, buildUpscaleArgs, planUpscale, runUpscaler } from './upscalecore'

export function upscalerDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'upscaler') : path.join(app.getAppPath(), 'resources', 'upscaler')
}

export function upscalerAvailable(): { ok: boolean; reason?: string } {
  const dir = upscalerDir()
  if (!existsSync(path.join(dir, binaryName(process.platform)))) return { ok: false, reason: 'Program upscale tidak ada di aplikasi ini.' }
  if (!existsSync(path.join(dir, 'models'))) return { ok: false, reason: 'Model upscale tidak ada di aplikasi ini.' }
  return { ok: true }
}

let chain: Promise<unknown> = Promise.resolve()

export type UpscaleResult = { width: number; height: number; capped: boolean }

/**
 * Perbesar `src` lalu simpan ke `dest` dengan format pilihan.
 * Model x4plus selalu 4×; kalau yang diminta 2×/3×, hasil 4× diperkecil (tetap lebih tajam daripada diperbesar biasa).
 */
export function upscaleImage(
  src: string,
  dest: string,
  opts: Pick<UpscaleOptions, 'model' | 'scale' | 'format'>,
  onProgress?: (p: number) => void,
  signal?: AbortSignal
): Promise<UpscaleResult> {
  const job = chain.then(async () => {
    const avail = upscalerAvailable()
    if (!avail.ok) throw new Error(avail.reason)
    const dir = upscalerDir()
    const size = await imageSize(src)
    const plan = planUpscale(size.width, size.height, opts.scale, opts.model)
    const tmp = path.join(app.getPath('temp'), `su-upscale-${randomUUID()}.png`)
    try {
      await runUpscaler(
        path.join(dir, binaryName(process.platform)),
        buildUpscaleArgs({ input: src, output: tmp, model: opts.model, modelScale: plan.modelScale, modelsDir: path.join(dir, 'models') }),
        (p) => onProgress?.(p * 0.92),
        signal
      )
      if (!existsSync(tmp) || (await fs.stat(tmp)).size === 0) throw new Error('Upscale tidak menghasilkan gambar.')
      const exact = plan.width === size.width * plan.modelScale && plan.height === size.height * plan.modelScale
      if (exact && opts.format === 'png') {
        await fs.copyFile(tmp, dest)
      } else {
        await encodeScaled(tmp, dest, plan.width, plan.height, opts.format)
      }
      onProgress?.(1)
      return { width: plan.width, height: plan.height, capped: plan.capped }
    } finally {
      await fs.rm(tmp, { force: true })
    }
  })
  chain = job.catch(() => undefined)
  return job
}
