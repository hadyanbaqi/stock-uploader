/**
 * Cek upscaler di dalam aplikasi hasil build (dipakai CI setelah installer dibuat).
 *   APP=dist/win-unpacked/Stock Uploader.exe node scripts/check-upscaler.mts
 *   APP=".../Stock Uploader.app/Contents/MacOS/Stock Uploader" node scripts/check-upscaler.mts
 * Gagal kalau file hilang, tanda tangan Mac rusak, atau program tidak bisa dijalankan.
 * Upscale sungguhan dicoba juga; mesin CI biasanya tanpa kartu grafis, jadi itu hanya dilaporkan.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encodePng } from '../src/main/alpha.ts'
import { binaryName, buildUpscaleArgs, friendlyUpscaleError } from '../src/main/upscalecore.ts'

const app = process.env.APP
if (!app) {
  console.error('Isi APP dengan lokasi program aplikasi hasil build.')
  process.exit(2)
}
const dir = process.platform === 'darwin' ? path.resolve(path.dirname(app), '..', 'Resources', 'upscaler') : path.join(path.dirname(app), 'resources', 'upscaler')
let failed = 0
const check = (name: string, ok: boolean, info = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${info ? `  → ${info}` : ''}`)
}

const bin = path.join(dir, binaryName(process.platform))
check('program upscale ada', existsSync(bin), bin)
for (const m of ['realesrgan-x4plus', 'realesrgan-x4plus-anime', 'realesr-animevideov3-x2', 'realesr-animevideov3-x3', 'realesr-animevideov3-x4']) {
  check(`model ${m}`, existsSync(path.join(dir, 'models', `${m}.param`)) && existsSync(path.join(dir, 'models', `${m}.bin`)))
}
check('lisensi ikut', existsSync(path.join(dir, 'LISENSI-UPSCALER.txt')))
if (process.platform === 'win32') check('vcomp140.dll ikut (OpenMP)', existsSync(path.join(dir, 'vcomp140.dll')))

if (process.platform === 'darwin' && existsSync(bin)) {
  try {
    execFileSync('codesign', ['--verify', '--strict', bin], { stdio: 'pipe' })
    check('Mac: tanda tangan program valid', true)
  } catch (e) {
    check('Mac: tanda tangan program valid', false, String((e as { stderr?: Buffer }).stderr ?? e))
  }
  const archs = execFileSync('lipo', ['-archs', bin]).toString().trim()
  check('Mac: native Apple Silicon (arm64)', archs.split(/\s+/).includes('arm64'), archs)
}

if (existsSync(bin)) {
  const help = spawnSync(bin, ['-h'], { encoding: 'utf8', timeout: 30_000, cwd: dir })
  const text = `${help.stdout}${help.stderr}`
  check('program bisa dijalankan (-h)', /Usage: realesrgan-ncnn-vulkan/.test(text), help.error ? String(help.error) : text.split('\n')[0])

  // Upscale sungguhan kecil (8×8 → 16×16) dengan model paling ringan.
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'su-up-'))
  const px = new Uint8Array(8 * 8 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256))
  const input = path.join(tmp, 'kecil.png')
  writeFileSync(input, await encodePng(px, 8, 8))
  const output = path.join(tmp, 'besar.png')
  const r = spawnSync(bin, buildUpscaleArgs({ input, output, model: 'fast', modelScale: 2, modelsDir: path.join(dir, 'models') }), {
    encoding: 'utf8',
    timeout: 120_000,
    cwd: dir
  })
  if (existsSync(output)) {
    const png = readFileSync(output)
    const w = png.readUInt32BE(16)
    const h = png.readUInt32BE(20)
    check('upscale asli berjalan di kartu grafis CI', w === 16 && h === 16, `${w}x${h}`)
  } else {
    console.log(`INFO   upscale asli tidak bisa di mesin CI ini (biasanya tanpa kartu grafis): ${friendlyUpscaleError(`${r.stdout}${r.stderr}`, r.status)}`)
  }
}

console.log(failed ? `\n${failed} cek GAGAL` : '\nUpscaler di installer lengkap')
process.exit(failed ? 1 : 0)
