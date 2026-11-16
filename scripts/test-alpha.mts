/**
 * Tes Transparan: tebak latar, hitung alpha (hitam/putih/warna), PNG, PSD.
 * Jalankan: node scripts/test-alpha.mts [folder-keluaran]
 */
import { inflateSync } from 'node:zlib'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readPsdComposite } from '../src/main/psd.ts'
import { writeZip } from '../src/main/zip.ts'
import { ALPHA_AGENCIES, ALPHA_AGENCY_ORDER, agencyScale, planAgencyFiles, skippedForAi } from '../src/shared/alphaAgency.ts'
import { agencyFromPath } from '../src/shared/agencyFolder.ts'
import { readFileSync } from 'node:fs'
import { composite, detectBackground, downscale, encodePng, encodePsd, extractAlpha, packBits } from '../src/main/alpha.ts'

let failed = 0
function check(name: string, ok: boolean, info = '') {
  if (!ok) failed++
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${info ? `  → ${info}` : ''}`)
}

const W = 64
const H = 48
/** Gambar uji: latar `bg`, di tengah lingkaran merah yang memudar (glow). */
function glow(bg: [number, number, number]): Uint8Array {
  const img = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - W / 2, y - H / 2) / 16
      const a = Math.max(0, 1 - d)
      const fg = [255, 60, 20]
      const i = (y * W + x) * 4
      for (let k = 0; k < 3; k++) img[i + k] = Math.round(fg[k] * a + bg[k] * (1 - a))
      img[i + 3] = 255
    }
  return img
}
const at = (img: Uint8Array, x: number, y: number) => Array.from(img.subarray((y * W + x) * 4, (y * W + x) * 4 + 4))

console.log('[1] Tebak latar')
check('hitam', detectBackground(glow([0, 0, 0]), W, H).kind === 'black')
check('putih', detectBackground(glow([255, 255, 255]), W, H).kind === 'white')
const g = detectBackground(glow([0, 177, 64]), W, H)
check('hijau (warna)', g.kind === 'color' && Math.abs(g.color[1] - 177) < 3, JSON.stringify(g))

console.log('[2] Alpha dari latar hitam')
const params = { floor: 0, glow: 1 }
const blk = extractAlpha(glow([0, 0, 0]), W, H, { ...params, bg: [0, 0, 0] })
check('latar jadi tembus penuh', at(blk, 0, 0)[3] === 0)
check('tengah pekat, warna asli', at(blk, 32, 24)[3] === 255 && at(blk, 32, 24)[0] === 255, String(at(blk, 32, 24)))
const mid = at(blk, 32 + 8, 24) // separuh jalan → alpha ±0.5
check('glow setengah: alpha ±50% dan warna tetap merah terang (tanpa halo hitam)', Math.abs(mid[3] - 128) < 12 && mid[0] > 245 && Math.abs(mid[1] - 60) < 6, String(mid))

console.log('[3] Latar putih dan warna')
const wht = extractAlpha(glow([255, 255, 255]), W, H, { ...params, bg: [255, 255, 255] })
const wb = composite(wht, W, H, 'white')
const wo = glow([255, 255, 255])
let wd = 0
for (let i = 0; i < wb.length; i += 4) for (let k = 0; k < 3; k++) wd = Math.max(wd, Math.abs(wb[i + k] - wo[i + k]))
check('putih: latar tembus, ditumpuk di atas putih = asli', at(wht, 0, 0)[3] === 0 && at(wht, 40, 24)[3] > 60 && wd <= 3, `selisih maks ${wd}`)
const grn = extractAlpha(glow([0, 177, 64]), W, H, { ...params, bg: [0, 177, 64] })
const gm = at(grn, 32, 24)
check('hijau: latar tembus, tengah warna asli', at(grn, 0, 0)[3] === 0 && gm[0] > 245 && gm[3] > 245, String(gm))

console.log('[4] Pengaturan')
const noisy = glow([0, 0, 0])
noisy[0] = 12 // noise gelap di pojok
const clean = extractAlpha(noisy, W, H, { bg: [0, 0, 0], floor: 0.08, glow: 1 })
check('pembersih noise membuang bintik gelap', at(clean, 0, 0)[3] === 0)
const strong = extractAlpha(glow([0, 0, 0]), W, H, { bg: [0, 0, 0], floor: 0, glow: 1.6 })
check('glow lebih kuat → alpha lebih pekat', at(strong, 40, 24)[3] > mid[3], `${at(strong, 40, 24)[3]} > ${mid[3]}`)

console.log('[5] Komposit dan perkecil')
const back = composite(blk, W, H, 'black')
const orig = glow([0, 0, 0])
let maxDiff = 0
for (let i = 0; i < back.length; i += 4) for (let k = 0; k < 3; k++) maxDiff = Math.max(maxDiff, Math.abs(back[i + k] - orig[i + k]))
check('ditumpuk lagi di atas hitam = gambar asli', maxDiff <= 3, `selisih maks ${maxDiff}`)
const split = composite(blk, W, H, 'split')
check('preview belah dua: kiri hitam, kanan putih', at(split, 1, 1)[0] === 0 && at(split, W - 2, 1)[0] === 255)
const small = downscale(blk, W, H, 16)
check('perkecil 64→16', small.w === 16 && small.h === 12)

console.log('[6] PNG dan PSD')
const png = await encodePng(blk, W, H)
check('tanda PNG + IHDR RGBA', png.subarray(1, 4).toString() === 'PNG' && png[25] === 6)
// Baca balik IDAT dan buang filter Paeth.
let off = 8
const idat: Buffer[] = []
while (off < png.length) {
  const len = png.readUInt32BE(off)
  const type = png.subarray(off + 4, off + 8).toString()
  if (type === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len))
  off += 12 + len
}
const raw = inflateSync(Buffer.concat(idat))
const stride = W * 4
const dec = new Uint8Array(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let i = 0; i < stride; i++) {
    const a = i >= 4 ? dec[y * stride + i - 4] : 0
    const b = y ? dec[(y - 1) * stride + i] : 0
    const c = i >= 4 && y ? dec[(y - 1) * stride + i - 4] : 0
    const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
    const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    dec[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + pred) & 0xff
  }
}
check('PNG dibaca balik sama persis', Buffer.from(dec).equals(Buffer.from(blk)))
const pb = packBits(Uint8Array.from([1, 1, 1, 1, 2, 3, 4, 4]))
check('PackBits', pb.toString('hex') === 'fd01010203ff04', pb.toString('hex'))
const psd = encodePsd(blk, W, H, [0, 0, 0])
check('tanda PSD, 3 kanal, RGB', psd.subarray(0, 4).toString() === '8BPS' && psd.readUInt16BE(12) === 3 && psd.readUInt16BE(24) === 3)

console.log('[Paket per agensi]')
const plan = planAgencyFiles('api-biru', ['shutterstock', 'freepik', 'adobe'])
check(
  'Freepik: PSD + JPG nama sama, PSD file utama',
  plan.some((f) => f.rel === 'FREEPIK/api-biru.psd' && f.main) && plan.some((f) => f.rel === 'FREEPIK/api-biru.jpg' && !f.main)
)
check('Shutterstock: hanya JPG (bukan PNG/PSD/EPS)', plan.filter((f) => f.agency === 'shutterstock').map((f) => f.kind).join() === 'jpg')
check('Adobe: PNG transparan', plan.filter((f) => f.agency === 'adobe').map((f) => f.kind).join() === 'png')
check('urutan tetap (Adobe dulu), apa pun urutan pilihan', plan[0].agency === 'adobe')
check(
  'semua folder dikenali agencyFromPath (upload otomatis ke agensi yang benar)',
  ALPHA_AGENCY_ORDER.every((a) => agencyFromPath(`/x/out/${ALPHA_AGENCIES[a].folder}/f.jpg`)?.agency === a)
)
check('1024×1024 + Adobe → diperbesar ≥ 4 MP', 1024 * 1024 * agencyScale(1024, 1024, ['adobe']) ** 2 >= 4_000_000)
check('1024×1024 + 123RF → ≥ 6 MP', 1024 * 1024 * agencyScale(1024, 1024, ['123rf', 'adobe']) ** 2 >= 6_000_000)
check('1500×1000 + Freepik → sisi terpanjang ≥ 2.000 px', Math.round(1500 * agencyScale(1500, 1000, ['freepik'])) >= 2000)
check('sudah besar → tidak diubah', agencyScale(6000, 4000, ['adobe', '123rf', 'freepik']) === 1)
check('tanpa agensi → 1', agencyScale(500, 500, []) === 1)
check('gambar AI: Shutterstock, Pond5, Alamy dilewati', skippedForAi(['adobe', 'shutterstock', 'pond5', 'alamy', 'freepik'], true).join() === 'shutterstock,pond5,alamy')
check('gambar bukan AI: tidak ada yang dilewati', skippedForAi(['shutterstock'], false).length === 0)
const comp = readPsdComposite(encodePsd(blk, W, H, [0, 0, 0]), 10000)
check('pratinjau Freepik dari PSD: ukuran sama, latar ikut (tidak transparan)', comp.width === W && comp.height === H && comp.rgba[3] === 255)
const zdir = mkdtempSync(path.join(tmpdir(), 'su-alpha-zip-'))
const { mkdirSync } = await import('node:fs')
for (const f of ['FREEPIK/a.jpg', 'SHUTTERSTOCK/a.jpg', 'FREEPIK/a.psd']) {
  mkdirSync(path.join(zdir, path.dirname(f)), { recursive: true })
  writeFileSync(path.join(zdir, f), f)
}
await writeZip(`${zdir}.zip`, ['FREEPIK/a.jpg', 'SHUTTERSTOCK/a.jpg', 'FREEPIK/a.psd'].map((f) => path.join(zdir, f)), zdir)
const zbuf = readFileSync(`${zdir}.zip`).toString('latin1')
check('ZIP menyimpan folder agensi (a.jpg Freepik dan Shutterstock tidak bertabrakan)', zbuf.includes('FREEPIK/a.jpg') && zbuf.includes('SHUTTERSTOCK/a.jpg') && !zbuf.includes('a-2.jpg'))

const out = process.argv[2] || mkdtempSync(path.join(tmpdir(), 'su-alpha-'))
writeFileSync(path.join(out, 'uji.png'), png)
writeFileSync(path.join(out, 'uji.psd'), psd)
console.log(`File uji: ${out}`)

console.log(failed ? `\n${failed} tes GAGAL` : '\nSemua tes lulus')
process.exit(failed ? 1 : 0)
