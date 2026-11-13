import { deflate } from 'node:zlib'
import { promisify } from 'node:util'
import { crc32 } from './zip.ts'

/**
 * Efek/VFX di latar polos → PNG transparan yang glow dan asapnya tetap halus.
 * Bukan "hapus latar" dengan AI: transparansi dihitung dari jarak warna tiap piksel ke warna latar,
 * lalu warnanya dikembalikan (un-premultiply) supaya tidak ada halo hitam/putih.
 * Semua data piksel di sini RGBA 8-bit, alpha lurus (tidak premultiplied).
 */

export type BgKind = 'black' | 'white' | 'color'
export type AlphaParams = {
  /** Warna latar 0..255. */
  bg: [number, number, number]
  /** Bagian dari jarak ke latar yang dianggap noise dan dibuat tembus penuh (0..0.3). */
  floor: number
  /** Kekuatan glow: >1 lebih pekat, <1 lebih tipis (0.5..2). */
  glow: number
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** Tebak warna latar dari tepi gambar (median). */
export function detectBackground(rgba: Uint8Array, w: number, h: number): { kind: BgKind; color: [number, number, number] } {
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const bw = Math.max(1, Math.round(Math.min(w, h) * 0.03))
  const step = Math.max(1, Math.floor((w + h) / 400))
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4
    rs.push(rgba[i])
    gs.push(rgba[i + 1])
    bs.push(rgba[i + 2])
  }
  for (let x = 0; x < w; x += step) for (let d = 0; d < bw; d += Math.max(1, Math.floor(bw / 3))) {
    take(x, d)
    take(x, h - 1 - d)
  }
  for (let y = 0; y < h; y += step) for (let d = 0; d < bw; d += Math.max(1, Math.floor(bw / 3))) {
    take(d, y)
    take(w - 1 - d, y)
  }
  const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0
  const color: [number, number, number] = [med(rs), med(gs), med(bs)]
  const lum = (color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722) / 255
  const spread = Math.max(...color) - Math.min(...color)
  const kind: BgKind = lum < 0.12 && spread < 30 ? 'black' : lum > 0.88 && spread < 30 ? 'white' : 'color'
  return { kind, color: kind === 'black' ? [0, 0, 0] : kind === 'white' ? [255, 255, 255] : color }
}

/** Hitung transparansi. Masukan RGBA (alpha diabaikan, dianggap pekat di atas latar). */
export function extractAlpha(src: Uint8Array, w: number, h: number, p: AlphaParams): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  const B = p.bg.map((v) => clamp(v, 0, 255) / 255)
  const floor = clamp(p.floor, 0, 0.5)
  const gamma = 1 / clamp(p.glow, 0.3, 3)
  // Untuk tiap kanal: jarak maksimum yang mungkin dari warna latar ke ujung (0 atau 1).
  const span = B.map((b) => [Math.max(b, 1e-6), Math.max(1 - b, 1e-6)])
  // Tabel kurva alpha untuk 4096 tingkat supaya cepat.
  const LUT = new Float32Array(4097)
  for (let i = 0; i <= 4096; i++) {
    const a = i / 4096
    LUT[i] = a <= floor ? 0 : Math.pow((a - floor) / (1 - floor), gamma)
  }
  for (let i = 0, n = w * h * 4; i < n; i += 4) {
    const c0 = src[i] / 255
    const c1 = src[i + 1] / 255
    const c2 = src[i + 2] / 255
    const d0 = c0 >= B[0] ? (c0 - B[0]) / span[0][1] : (B[0] - c0) / span[0][0]
    const d1 = c1 >= B[1] ? (c1 - B[1]) / span[1][1] : (B[1] - c1) / span[1][0]
    const d2 = c2 >= B[2] ? (c2 - B[2]) / span[2][1] : (B[2] - c2) / span[2][0]
    const raw = d0 > d1 ? (d0 > d2 ? d0 : d2) : d1 > d2 ? d1 : d2
    if (raw <= 0) continue
    const a = LUT[Math.min(4096, Math.round(raw * 4096))]
    if (a <= 0) continue
    // Warna asli = latar + (warna - latar) / raw  (kebalikan dari menumpuk dengan alpha "raw").
    out[i] = Math.round(clamp(B[0] + (c0 - B[0]) / raw, 0, 1) * 255)
    out[i + 1] = Math.round(clamp(B[1] + (c1 - B[1]) / raw, 0, 1) * 255)
    out[i + 2] = Math.round(clamp(B[2] + (c2 - B[2]) / raw, 0, 1) * 255)
    out[i + 3] = Math.round(a * 255)
  }
  return out
}

export type PreviewStyle = 'black' | 'white' | 'checker' | 'split' | 'color'

/** Tumpuk RGBA transparan di atas latar → RGB pekat (untuk JPG preview/PSD). */
export function composite(fg: Uint8Array, w: number, h: number, style: PreviewStyle, color: [number, number, number] = [0, 0, 0]): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  const cell = Math.max(8, Math.round(Math.max(w, h) / 64))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let br: number, bgc: number, bb: number
      if (style === 'black') br = bgc = bb = 0
      else if (style === 'white') br = bgc = bb = 255
      else if (style === 'split') br = bgc = bb = x < w / 2 ? 0 : 255
      else if (style === 'checker') br = bgc = bb = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 204 : 255
      else [br, bgc, bb] = color
      const a = fg[i + 3] / 255
      out[i] = Math.round(fg[i] * a + br * (1 - a))
      out[i + 1] = Math.round(fg[i + 1] * a + bgc * (1 - a))
      out[i + 2] = Math.round(fg[i + 2] * a + bb * (1 - a))
      out[i + 3] = 255
    }
  }
  return out
}

/** Perkecil (rata-rata kotak) untuk pratinjau cepat. */
export function downscale(src: Uint8Array, w: number, h: number, max: number): { data: Uint8Array; w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h))
  if (s >= 1) return { data: src, w, h }
  const nw = Math.max(1, Math.round(w * s))
  const nh = Math.max(1, Math.round(h * s))
  const out = new Uint8Array(nw * nh * 4)
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y / s)
    const y1 = Math.min(h, Math.max(y0 + 1, Math.floor((y + 1) / s)))
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x / s)
      const x1 = Math.min(w, Math.max(x0 + 1, Math.floor((x + 1) / s)))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4
          r += src[i]
          g += src[i + 1]
          b += src[i + 2]
          a += src[i + 3]
          n++
        }
      }
      const o = (y * nw + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = a / n
    }
  }
  return { data: out, w: nw, h: nh }
}

const deflateAsync = promisify(deflate)

/** PNG RGBA 8-bit (filter Paeth per baris; kompresi berjalan di luar thread utama). */
export async function encodePng(rgba: Uint8Array, w: number, h: number, opaque = false): Promise<Buffer> {
  const ch = opaque ? 3 : 4
  const stride = w * ch
  const raw = Buffer.alloc((stride + 1) * h)
  let prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const o = x * ch
      cur[o] = rgba[i]
      cur[o + 1] = rgba[i + 1]
      cur[o + 2] = rgba[i + 2]
      if (ch === 4) cur[o + 3] = rgba[i + 3]
    }
    const row = y * (stride + 1)
    raw[row] = 4 // Paeth
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0
      const b = prev[i]
      const c = i >= ch ? prev[i - ch] : 0
      const pa = Math.abs(b - c)
      const pb = Math.abs(a - c)
      const pc = Math.abs(a + b - 2 * c)
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      raw[row + 1 + i] = (cur[i] - pred) & 0xff
    }
    prev = Uint8Array.from(cur)
  }
  const idat = await deflateAsync(raw, { level: 6 })
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = opaque ? 2 : 6
  // sRGB (perceptual) supaya warna sama di semua aplikasi.
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('sRGB', Buffer.from([0])),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** PackBits (RLE) satu baris, seperti yang dipakai PSD. */
export function packBits(row: Uint8Array): Buffer {
  const out: number[] = []
  let i = 0
  const n = row.length
  while (i < n) {
    let run = 1
    while (i + run < n && run < 128 && row[i + run] === row[i]) run++
    if (run >= 2) {
      out.push(257 - run, row[i])
      i += run
      continue
    }
    const start = i
    let lit = 0
    while (i < n && lit < 128) {
      if (i + 1 < n && row[i] === row[i + 1]) break
      i++
      lit++
    }
    out.push(lit - 1)
    for (let k = start; k < start + lit; k++) out.push(row[k])
  }
  return Buffer.from(out)
}

/** Data satu kanal terkompresi RLE: [jumlah byte per baris (int16)] + data. */
function rleChannel(get: (x: number, y: number) => number, w: number, h: number): { counts: Buffer; data: Buffer } {
  const counts = Buffer.alloc(h * 2)
  const parts: Buffer[] = []
  const row = new Uint8Array(w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = get(x, y)
    const p = packBits(row)
    counts.writeUInt16BE(p.length, y * 2)
    parts.push(p)
  }
  return { counts, data: Buffer.concat(parts) }
}

/**
 * PSD berlapis: lapisan bawah "Latar" (warna polos, disembunyikan) + lapisan "Efek" (transparan).
 * Gambar gabungan = efek di atas latar.
 */
export function encodePsd(fg: Uint8Array, w: number, h: number, bg: [number, number, number], name = 'Efek'): Buffer {
  const u16 = (v: number) => {
    const b = Buffer.alloc(2)
    b.writeUInt16BE(v & 0xffff)
    return b
  }
  const i16 = (v: number) => {
    const b = Buffer.alloc(2)
    b.writeInt16BE(v)
    return b
  }
  const u32 = (v: number) => {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(v >>> 0)
    return b
  }
  const pascal = (s: string) => {
    const t = Buffer.from(s.slice(0, 200), 'latin1')
    const len = 1 + t.length
    const pad = (4 - (len % 4)) % 4
    return Buffer.concat([Buffer.from([t.length]), t, Buffer.alloc(pad)])
  }

  type Layer = { name: string; hidden: boolean; channels: { id: number; get: (x: number, y: number) => number }[] }
  const px = (x: number, y: number) => (y * w + x) * 4
  const layers: Layer[] = [
    {
      name: 'Latar',
      hidden: true,
      channels: [
        { id: 0, get: () => bg[0] },
        { id: 1, get: () => bg[1] },
        { id: 2, get: () => bg[2] },
        { id: -1, get: () => 255 }
      ]
    },
    {
      name,
      hidden: false,
      channels: [
        { id: 0, get: (x, y) => fg[px(x, y)] },
        { id: 1, get: (x, y) => fg[px(x, y) + 1] },
        { id: 2, get: (x, y) => fg[px(x, y) + 2] },
        { id: -1, get: (x, y) => fg[px(x, y) + 3] }
      ]
    }
  ]

  const records: Buffer[] = []
  const imageData: Buffer[] = []
  for (const L of layers) {
    const chans = L.channels.map((c) => ({ id: c.id, ...rleChannel(c.get, w, h) }))
    const extra = Buffer.concat([u32(0), u32(0), pascal(L.name)])
    records.push(
      Buffer.concat([
        u32(0), u32(0), u32(h), u32(w), // top, left, bottom, right
        u16(chans.length),
        ...chans.map((c) => Buffer.concat([i16(c.id), u32(2 + c.counts.length + c.data.length)])),
        Buffer.from('8BIMnorm', 'ascii'),
        Buffer.from([255, 0, L.hidden ? 2 : 0, 0]), // opacity, clipping, flags (bit 1 = tersembunyi), filler
        u32(extra.length),
        extra
      ])
    )
    for (const c of chans) imageData.push(u16(1), c.counts, c.data)
  }
  let layerInfo = Buffer.concat([u16(layers.length), ...records, ...imageData])
  if (layerInfo.length % 2) layerInfo = Buffer.concat([layerInfo, Buffer.alloc(1)])
  const layerSection = Buffer.concat([u32(layerInfo.length), layerInfo, u32(0)]) // + global layer mask kosong

  // Gambar gabungan (3 kanal): efek di atas latar.
  const comp = (k: number) => (x: number, y: number) => {
    const i = px(x, y)
    const a = fg[i + 3] / 255
    return Math.round(fg[i + k] * a + bg[k] * (1 - a))
  }
  const merged = [0, 1, 2].map((k) => rleChannel(comp(k), w, h))

  return Buffer.concat([
    Buffer.from('8BPS', 'ascii'),
    u16(1),
    Buffer.alloc(6),
    u16(3),
    u32(h),
    u32(w),
    u16(8),
    u16(3), // RGB
    u32(0), // color mode data
    u32(0), // image resources
    u32(layerSection.length),
    layerSection,
    u16(1),
    ...merged.map((m) => m.counts),
    ...merged.map((m) => m.data)
  ])
}
