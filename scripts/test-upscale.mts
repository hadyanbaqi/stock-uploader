/**
 * Tes upscale AI: rencana ukuran, flag program, progres, pesan error, menjalankan program
 * (tiruan untuk semua jalur, dan Real-ESRGAN asli kalau resources/upscaler ada).
 * Jalankan: node scripts/test-upscale.mts
 * Tanpa kartu grafis, upscale asli bisa dicoba dengan Vulkan CPU: VK_ICD_FILENAMES=…/vk_swiftshader_icd.json
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encodePng } from '../src/main/alpha.ts'
import { binaryName, buildUpscaleArgs, friendlyUpscaleError, parseProgress, planUpscale, runUpscaler } from '../src/main/upscalecore.ts'
import { UPSCALE_MODELS, type UpscaleModel } from '../src/shared/upscale.ts'

let failed = 0
function check(name: string, ok: boolean, info = '') {
  if (!ok) failed++
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${info ? `  → ${info}` : ''}`)
}
async function rejects(name: string, p: Promise<unknown>, match: RegExp) {
  try {
    await p
    check(name, false, 'tidak ada error')
  } catch (e) {
    const m = (e as Error).message
    check(name, match.test(m), m)
  }
}

console.log('[1] Rencana ukuran')
let p = planUpscale(1024, 1024, 4, 'general')
check('1024² × 4 (x4plus) → 4096², model 4×', p.width === 4096 && p.height === 4096 && p.modelScale === 4 && !p.capped)
p = planUpscale(1024, 576, 2, 'general')
check('x4plus diminta 2× → model tetap 4×, hasil 2048×1152', p.modelScale === 4 && p.width === 2048 && p.height === 1152)
p = planUpscale(1024, 576, 3, 'fast')
check('model cepat 3× → model 3× langsung', p.modelScale === 3 && p.width === 3072 && p.height === 1728)
p = planUpscale(4000, 3000, 4, 'general')
check('hasil > 64 MP → skala diturunkan', p.capped && p.width * p.height <= 64_000_000 && p.width > 4000, `${p.width}x${p.height}`)
p = planUpscale(20000, 10000, 2, 'fast')
check('gambar sudah raksasa → tidak diperkecil (skala 1)', p.capped && p.width === 20000)
let threw = ''
try {
  planUpscale(0, 10, 2, 'fast')
} catch (e) {
  threw = (e as Error).message
}
check('ukuran 0 → error jelas', /tidak terbaca/.test(threw))
check('semua model punya file dan skala', Object.values(UPSCALE_MODELS).every((m) => m.file && m.scales.length))

console.log('[2] Flag program')
const args = buildUpscaleArgs({ input: 'a b.png', output: 'o.png', model: 'anime', modelScale: 4, modelsDir: 'C:\\Program Files\\Stock Uploader\\resources\\upscaler\\models' })
check('flag lengkap, model anime', args.join(' ') === '-i a b.png -o o.png -n realesrgan-x4plus-anime -s 4 -m C:\\Program Files\\Stock Uploader\\resources\\upscaler\\models -f png')
check('model cepat 2× pakai realesr-animevideov3', buildUpscaleArgs({ input: 'i', output: 'o', model: 'fast', modelScale: 2, modelsDir: 'm' }).includes('realesr-animevideov3'))
check('nama program Windows .exe', binaryName('win32') === 'realesrgan-ncnn-vulkan.exe' && binaryName('darwin') === 'realesrgan-ncnn-vulkan')

console.log('[3] Progres dan pesan error')
check('progres "12.50%" → 0.125', parseProgress('12.50%\n') === 0.125)
check('ambil angka terakhir', parseProgress('10.00%\n20.00%\n33.33%') === 0.3333)
check('bukan progres → null', parseProgress('[0 Apple M1] queueC=0[1]') === null)
check('GPU tidak ada (Windows) → saran update driver', /driver/.test(friendlyUpscaleError('vkCreateInstance failed -9\ninvalid gpu device', 255, 'win32')))
check('GPU tidak ada (Mac) → pesan Mac', /Kartu grafis tidak bisa/.test(friendlyUpscaleError('invalid gpu device', 255, 'darwin')) && !/NVIDIA/.test(friendlyUpscaleError('invalid gpu device', 255, 'darwin')))
check('memori GPU habis → saran model cepat', /Cepat/.test(friendlyUpscaleError('vkAllocateMemory failed VK_ERROR_OUT_OF_DEVICE_MEMORY', 1)))
check('gambar tidak terbaca', /tidak bisa dibaca/.test(friendlyUpscaleError('decode image /x.png failed', 0)))
check('error lain → baris terakhir ikut (bukan baris progres)', /kode 3.*hal aneh/.test(friendlyUpscaleError('a\nhal aneh\n42.00%', 3)))

console.log('[4] Menjalankan program (tiruan)')
const dir = mkdtempSync(path.join(os.tmpdir(), 'su-ups-'))
const fake = path.join(dir, 'tiruan.mjs')
writeFileSync(
  fake,
  `import { copyFileSync } from 'node:fs'
const a = process.argv.slice(2); const get = (f) => a[a.indexOf(f) + 1]
const mode = process.env.MODE
if (mode === 'nogpu') { process.stderr.write('vkCreateInstance failed -9\\ninvalid gpu device\\n'); process.exit(255) }
if (mode === 'silentfail') { process.stderr.write('decode image ' + get('-i') + ' failed\\n'); process.exit(0) }
for (let i = 0; i <= 4; i++) { process.stderr.write((i * 25).toFixed(2) + '%\\n'); await new Promise((r) => setTimeout(r, mode === 'slow' ? 400 : 10)) }
copyFileSync(get('-i'), get('-o'))
`
)
const input = path.join(dir, 'in.png')
writeFileSync(input, await encodePng(new Uint8Array(4 * 4 * 4).fill(200), 4, 4))
const run = (mode: string, out: string, signal?: AbortSignal, onP?: (p: number) => void, timeout?: number) => {
  process.env.MODE = mode
  return runUpscaler(process.execPath, [fake, ...buildUpscaleArgs({ input, output: out, model: 'fast', modelScale: 2, modelsDir: dir })], onP, signal, timeout)
}
const seen: number[] = []
await run('ok', path.join(dir, 'ok.png'), undefined, (v) => seen.push(v))
check('berhasil, keluaran ada', existsSync(path.join(dir, 'ok.png')))
check('progres diteruskan sampai 100%', seen.length >= 3 && seen[seen.length - 1] === 1, seen.join(','))
await rejects('tanpa GPU → pesan ramah', run('nogpu', path.join(dir, 'x.png')), /Kartu grafis/)
await rejects('kode 0 tapi ada "failed" → tetap dianggap gagal', run('silentfail', path.join(dir, 'y.png')), /tidak bisa dibaca/)
const ac = new AbortController()
setTimeout(() => ac.abort(), 300)
await rejects('bisa dibatalkan', run('slow', path.join(dir, 'z.png'), ac.signal), /Dibatalkan/)
await rejects('batas waktu → pesan terlalu lama', run('slow', path.join(dir, 't.png'), undefined, undefined, 300), /terlalu lama/)
await rejects('program tidak ada → pesan pasang ulang', runUpscaler(path.join(dir, 'tidak-ada.exe'), []), /tidak ditemukan/)

console.log('[5] Real-ESRGAN asli (kalau sudah diunduh)')
const real = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'resources', 'upscaler')
const bin = path.join(real, binaryName(process.platform))
if (!existsSync(bin)) {
  console.log('(lewati: jalankan "npm run upscaler" dulu)')
} else {
  const w = 24
  const h = 16
  const px = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) px.set([(i * 13) % 256, (i * 7) % 256, (i * 3) % 256, 255], i * 4)
  const src = path.join(dir, 'asli.png')
  writeFileSync(src, await encodePng(px, w, h))
  for (const [model, scale] of [['fast', 2], ['anime', 4], ['general', 4]] as [UpscaleModel, 2 | 4][]) {
    const out = path.join(dir, `asli-${model}.png`)
    try {
      await runUpscaler(bin, buildUpscaleArgs({ input: src, output: out, model, modelScale: scale, modelsDir: path.join(real, 'models') }), undefined, undefined, 300_000)
      const png = readFileSync(out)
      check(`asli: ${UPSCALE_MODELS[model].file} ${scale}× → ${w * scale}×${h * scale}`, png.readUInt32BE(16) === w * scale && png.readUInt32BE(20) === h * scale)
    } catch (e) {
      const m = (e as Error).message
      if (/Kartu grafis/.test(m)) {
        console.log(`INFO   asli ${model}: tidak ada kartu grafis di mesin ini (${m.slice(0, 60)}…), pesan ramah benar`)
        break
      }
      check(`asli: ${model}`, false, m)
    }
  }
}

console.log(failed ? `\n${failed} tes GAGAL` : '\nSemua tes lulus')
process.exit(failed ? 1 : 0)
