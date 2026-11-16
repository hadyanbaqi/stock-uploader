/**
 * Tes pembaca PSD: gambar gabungan dari berbagai mode warna, kedalaman, kompresi, PSB, dan file bermasalah.
 * Jalankan: node scripts/test-psd.mts
 */
import { encodePsd, packBits } from '../src/main/alpha.ts'
import { flattenOnWhite, readPsdComposite } from '../src/main/psd.ts'

let failed = 0
function check(name: string, ok: boolean, info = '') {
  if (!ok) failed++
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${info ? `  → ${info}` : ''}`)
}
function throws(name: string, fn: () => unknown, match: RegExp) {
  try {
    fn()
    check(name, false, 'tidak ada error')
  } catch (e) {
    const m = (e as Error).message
    check(name, match.test(m), m)
  }
}

type Opt = {
  w: number
  h: number
  mode: number // 1 gray, 2 indexed, 3 rgb, 4 cmyk, 9 lab
  depth?: 8 | 16 | 32
  /** Kanal planar, nilai 0..255 per piksel (untuk 16 bit ditulis v*257). */
  planes: number[][]
  compression?: 0 | 1 | 2
  version?: 1 | 2
  layerCount?: number
  palette?: Buffer
}

/** Penulis PSD kecil khusus tes (bagian layer hanya berisi jumlah lapisan). */
function makePsd(o: Opt): Buffer {
  const v = o.version ?? 1
  const depth = o.depth ?? 8
  const bps = depth / 8
  const u16 = (n: number) => Buffer.from([(n >> 8) & 255, n & 255])
  const u32 = (n: number) => {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(n)
    return b
  }
  const u64 = (n: number) => {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(n))
    return b
  }
  const len = (n: number) => (v === 2 ? u64(n) : u32(n))
  const head = Buffer.concat([Buffer.from('8BPS'), u16(v), Buffer.alloc(6), u16(o.planes.length), u32(o.h), u32(o.w), u16(depth), u16(o.mode)])
  const cm = o.palette ? Buffer.concat([u32(o.palette.length), o.palette]) : u32(0)
  const res = u32(0)
  let layer: Buffer
  if (o.layerCount === undefined) layer = len(0)
  else {
    const c = Buffer.alloc(2)
    c.writeInt16BE(o.layerCount)
    const li = Buffer.concat([len(2), c])
    layer = Buffer.concat([len(li.length), li])
  }
  const rowOf = (plane: number[], y: number) => {
    const row = Buffer.alloc(o.w * bps)
    for (let x = 0; x < o.w; x++) {
      const val = plane[y * o.w + x]
      if (bps === 1) row[x] = val
      else if (bps === 2) row.writeUInt16BE(val * 257, x * 2)
      else row.writeFloatBE(val / 255, x * 4)
    }
    return row
  }
  const comp = o.compression ?? 0
  let data: Buffer
  if (comp === 1) {
    const counts: Buffer[] = []
    const rows: Buffer[] = []
    for (const p of o.planes)
      for (let y = 0; y < o.h; y++) {
        const r = packBits(rowOf(p, y))
        counts.push(v === 2 ? u32(r.length) : u16(r.length))
        rows.push(r)
      }
    data = Buffer.concat([u16(1), ...counts, ...rows])
  } else if (comp === 0) {
    data = Buffer.concat([u16(0), ...o.planes.flatMap((p) => Array.from({ length: o.h }, (_, y) => rowOf(p, y)))])
  } else {
    data = Buffer.concat([u16(comp), Buffer.alloc(16)])
  }
  return Buffer.concat([head, cm, res, layer, data])
}

const W = 6
const H = 4
const ramp = (k: number) => Array.from({ length: W * H }, (_, i) => (i * 10 + k) % 256)
const R = ramp(0)
const G = ramp(50)
const B = ramp(100)
const px = (img: { rgba: Uint8Array }, i: number) => Array.from(img.rgba.subarray(i * 4, i * 4 + 4)).join(',')

console.log('[1] PSD dari penulis aplikasi (Transparan): 2 lapisan, RLE')
{
  const w = 5
  const h = 3
  const fg = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) fg.set([255, 0, 0, i === 0 ? 0 : i === 1 ? 128 : 255], i * 4)
  const img = readPsdComposite(encodePsd(fg, w, h, [0, 0, 255]))
  check('ukuran benar', img.w === w && img.h === h && img.width === w && img.height === h)
  check('piksel transparan = warna latar', px(img, 0) === '0,0,255,255', px(img, 0))
  check('piksel setengah = campuran', px(img, 1) === '128,0,127,255', px(img, 1))
  check('piksel penuh = efek', px(img, 2) === '255,0,0,255', px(img, 2))
  check('mode RGB, tanpa alpha gabungan', img.mode === 'rgb' && !img.hasAlpha)
}

console.log('[2] Mode warna, kedalaman, kompresi')
for (const comp of [0, 1] as const) {
  const img = readPsdComposite(makePsd({ w: W, h: H, mode: 3, planes: [R, G, B], compression: comp }))
  const ok = Array.from({ length: W * H }).every((_, i) => px(img, i) === `${R[i]},${G[i]},${B[i]},255`)
  check(`RGB 8 bit ${comp ? 'RLE' : 'tanpa kompresi'}: semua piksel cocok`, ok)
}
{
  const img = readPsdComposite(makePsd({ w: W, h: H, mode: 3, depth: 16, planes: [R, G, B], compression: 1 }))
  check('RGB 16 bit: diambil byte atas', px(img, 5) === `${R[5]},${G[5]},${B[5]},255`, px(img, 5))
}
{
  const img = readPsdComposite(makePsd({ w: W, h: H, mode: 1, planes: [R] }))
  check('Grayscale', img.mode === 'grayscale' && px(img, 7) === `${R[7]},${R[7]},${R[7]},255`, px(img, 7))
}
{
  // CMYK di PSD tersimpan terbalik: 255 = tanpa tinta. Putih = semua 255; merah = C 0 (tinta penuh cyan dibalik) dst.
  const n = W * H
  const C = Array(n).fill(255)
  const M = Array(n).fill(255)
  const Y = Array(n).fill(255)
  const K = Array(n).fill(255)
  C[1] = 0 // tinta cyan penuh → merah 0
  K[2] = 0 // hitam penuh
  const img = readPsdComposite(makePsd({ w: W, h: H, mode: 4, planes: [C, M, Y, K], compression: 1 }))
  check('CMYK: tanpa tinta = putih', px(img, 0) === '255,255,255,255', px(img, 0))
  check('CMYK: cyan penuh = biru kehijauan', px(img, 1) === '0,255,255,255', px(img, 1))
  check('CMYK: hitam penuh = hitam', px(img, 2) === '0,0,0,255', px(img, 2))
}
{
  const pal = Buffer.alloc(768)
  pal[3] = 10 // indeks 3: R
  pal[256 + 3] = 20
  pal[512 + 3] = 30
  const idx = Array(W * H).fill(0)
  idx[4] = 3
  const img = readPsdComposite(makePsd({ w: W, h: H, mode: 2, planes: [idx], palette: pal }))
  check('Indexed: warna dari palet', px(img, 4) === '10,20,30,255' && px(img, 0) === '0,0,0,255', px(img, 4))
}
{
  const A = Array.from({ length: W * H }, (_, i) => (i % 3) * 100)
  const withAlpha = readPsdComposite(makePsd({ w: W, h: H, mode: 3, planes: [R, G, B, A], layerCount: -2, compression: 1 }))
  check('Transparansi gabungan (jumlah lapisan negatif) dipakai', withAlpha.hasAlpha && withAlpha.rgba[3 + 4 * 2] === 200, String(withAlpha.rgba[11]))
  const extra = readPsdComposite(makePsd({ w: W, h: H, mode: 3, planes: [R, G, B, A], layerCount: 2, compression: 1 }))
  check('Kanal ekstra biasa (bukan transparansi) diabaikan', !extra.hasAlpha && extra.rgba[11] === 255)
  const flat = flattenOnWhite(withAlpha.rgba)
  check('Rata ke putih: alpha 0 → putih', flat[0] === 255 && flat[3] === 255 && withAlpha.rgba[3] === 0)
}
{
  const img = readPsdComposite(makePsd({ w: W, h: H, mode: 3, planes: [R, G, B], compression: 1, version: 2, layerCount: 1 }))
  check('PSB (versi 2, hitungan RLE 4 byte, panjang 8 byte)', px(img, 9) === `${R[9]},${G[9]},${B[9]},255`, px(img, 9))
}

console.log('[3] Diperkecil untuk pratinjau AI')
{
  const w = 3000
  const h = 1000
  const plane = Array.from({ length: w * h }, (_, i) => (i % w < 1500 ? 0 : 255))
  const img = readPsdComposite(makePsd({ w, h, mode: 1, planes: [plane], compression: 1 }), 1024)
  check('sisi terpanjang ≤ 1024', Math.max(img.w, img.h) <= 1024 && img.width === 3000 && img.height === 1000, `${img.w}x${img.h}`)
  check('isi tetap benar (kiri hitam, kanan putih)', img.rgba[0] === 0 && img.rgba[(img.w - 1) * 4] === 255)
}

console.log('[4] File bermasalah → pesan jelas')
throws('bukan PSD', () => readPsdComposite(Buffer.from('GIF89a................................')), /bukan file PSD/)
throws('file terpotong', () => readPsdComposite(makePsd({ w: W, h: H, mode: 3, planes: [R, G, B] }).subarray(0, 60)), /terpotong|rusak/)
throws('mode Lab', () => readPsdComposite(makePsd({ w: W, h: H, mode: 9, planes: [R, G, B] })), /Lab/)
throws('32 bit', () => readPsdComposite(makePsd({ w: W, h: H, mode: 3, depth: 32, planes: [R, G, B] })), /32 bit/)
throws('kompresi ZIP', () => readPsdComposite(makePsd({ w: W, h: H, mode: 3, planes: [R, G, B], compression: 2 })), /ZIP/)
const blank = Array(W * H).fill(255)
throws('gabungan kosong (tanpa Maximize Compatibility)', () => readPsdComposite(makePsd({ w: W, h: H, mode: 3, planes: [blank, blank, blank] })), /Maximize/)

console.log(failed ? `\n${failed} tes GAGAL` : '\nSemua tes lulus')
process.exit(failed ? 1 : 0)
