/**
 * Baca gambar gabungan (composite) dari file PSD/PSB tanpa library tambahan.
 *
 * Photoshop menyimpan versi rata dari semua lapisan di akhir file (selama "Maximize PSD and PSB File
 * Compatibility" aktif, bawaannya aktif). Bagian itu yang dibaca di sini, jadi lapisan tidak perlu digabung ulang.
 * Didukung: RGB, CMYK, Grayscale, Indexed; 8 dan 16 bit; tanpa kompresi atau RLE (PackBits).
 */

export type PsdImage = {
  /** Ukuran hasil (bisa lebih kecil dari asli kalau `maxSide` dipakai). */
  w: number
  h: number
  /** Ukuran asli dokumen. */
  width: number
  height: number
  rgba: Uint8Array
  /** Gambar gabungan punya transparansi. */
  hasAlpha: boolean
  mode: 'rgb' | 'cmyk' | 'grayscale' | 'indexed'
}

const MODES: Record<number, PsdImage['mode']> = { 1: 'grayscale', 2: 'indexed', 3: 'rgb', 4: 'cmyk' }
const BASE_CHANNELS: Record<PsdImage['mode'], number> = { grayscale: 1, indexed: 1, rgb: 3, cmyk: 4 }

class Reader {
  pos = 0
  readonly b: Buffer
  constructor(b: Buffer) {
    this.b = b
  }
  need(n: number) {
    if (this.pos + n > this.b.length) throw new Error('File PSD terpotong atau rusak.')
  }
  u8() {
    this.need(1)
    return this.b[this.pos++]
  }
  u16() {
    this.need(2)
    const v = this.b.readUInt16BE(this.pos)
    this.pos += 2
    return v
  }
  i16() {
    this.need(2)
    const v = this.b.readInt16BE(this.pos)
    this.pos += 2
    return v
  }
  u32() {
    this.need(4)
    const v = this.b.readUInt32BE(this.pos)
    this.pos += 4
    return v
  }
  u64() {
    this.need(8)
    const v = Number(this.b.readBigUInt64BE(this.pos))
    this.pos += 8
    return v
  }
  skip(n: number) {
    this.need(n)
    this.pos += n
  }
}

/** Buka PackBits satu baris ke `out` (panjang sudah pasti). */
function unpackBits(src: Buffer, start: number, end: number, out: Uint8Array): void {
  let i = start
  let o = 0
  while (i < end && o < out.length) {
    const n = src[i++]
    if (n < 128) {
      const len = n + 1
      for (let k = 0; k < len && o < out.length; k++) out[o++] = src[i++]
    } else if (n > 128) {
      const len = 257 - n
      const v = src[i++]
      for (let k = 0; k < len && o < out.length; k++) out[o++] = v
    }
    // n === 128: tidak dipakai
  }
  if (o < out.length) throw new Error('Data gambar PSD rusak (baris RLE terlalu pendek).')
}

/**
 * Baca gambar gabungan. `maxSide` = sisi terpanjang hasil (diambil per lompatan piksel, cukup untuk pratinjau);
 * 0 = ukuran asli.
 */
export function readPsdComposite(buf: Buffer, maxSide = 0): PsdImage {
  const r = new Reader(buf)
  r.need(26)
  if (buf.toString('latin1', 0, 4) !== '8BPS') throw new Error('Ini bukan file PSD.')
  r.pos = 4
  const version = r.u16()
  if (version !== 1 && version !== 2) throw new Error(`Versi PSD ${version} tidak dikenal.`)
  r.skip(6)
  const channels = r.u16()
  const height = r.u32()
  const width = r.u32()
  const depth = r.u16()
  const modeNum = r.u16()
  const mode = MODES[modeNum]
  if (!mode) {
    const names: Record<number, string> = { 0: 'Bitmap', 7: 'Multichannel', 8: 'Duotone', 9: 'Lab' }
    throw new Error(`Mode warna ${names[modeNum] ?? modeNum} belum didukung. Ubah ke RGB di Photoshop (Image > Mode > RGB Color).`)
  }
  if (depth !== 8 && depth !== 16) {
    throw new Error(depth === 32 ? 'PSD 32 bit belum didukung. Ubah ke 8 atau 16 bit (Image > Mode > 8 Bits/Channel).' : `Kedalaman ${depth} bit belum didukung.`)
  }
  if (!width || !height) throw new Error('Ukuran PSD kosong.')

  // Data mode warna (palet untuk Indexed).
  const cmLen = r.u32()
  const cmStart = r.pos
  r.skip(cmLen)
  const palette = mode === 'indexed' && cmLen >= 768 ? buf.subarray(cmStart, cmStart + 768) : null
  if (mode === 'indexed' && !palette) throw new Error('Palet warna PSD Indexed tidak ada.')

  // Image resources.
  r.skip(r.u32())

  // Layer & mask: hanya perlu tahu apakah kanal ekstra pertama berisi transparansi gabungan.
  const lmLen = version === 2 ? r.u64() : r.u32()
  const lmEnd = r.pos + lmLen
  let mergedAlpha = false
  if (lmLen >= (version === 2 ? 10 : 6)) {
    const liLen = version === 2 ? r.u64() : r.u32()
    if (liLen >= 2) mergedAlpha = r.i16() < 0
  }
  r.pos = lmEnd
  r.need(2)

  const base = BASE_CHANNELS[mode]
  if (channels < base) throw new Error('Jumlah kanal PSD tidak cocok dengan mode warnanya.')
  const useAlpha = mergedAlpha && channels > base
  const want = base + (useAlpha ? 1 : 0)

  const step = maxSide > 0 ? Math.max(1, Math.ceil(Math.max(width, height) / maxSide)) : 1
  const w = Math.ceil(width / step)
  const h = Math.ceil(height / step)
  if (w * h > 120_000_000) throw new Error('PSD terlalu besar untuk dibaca. Pakai JPG pratinjau dengan nama yang sama.')

  const bps = depth / 8
  const rowBytes = width * bps
  const planes: Uint8Array[] = Array.from({ length: want }, () => new Uint8Array(w * h))
  const row = new Uint8Array(rowBytes)

  const takeRow = (plane: Uint8Array, oy: number) => {
    const o = oy * w
    for (let ox = 0, x = 0; ox < w; ox++, x += step) plane[o + ox] = row[x * bps] // 16 bit: ambil byte atas
  }

  const compression = r.u16()
  if (compression === 0) {
    const planeBytes = rowBytes * height
    r.need(planeBytes * want)
    for (let c = 0; c < want; c++) {
      const start = r.pos + c * planeBytes
      for (let y = 0, oy = 0; y < height && oy < h; y += step, oy++) {
        row.set(buf.subarray(start + y * rowBytes, start + (y + 1) * rowBytes))
        takeRow(planes[c], oy)
      }
    }
  } else if (compression === 1) {
    const countSize = version === 2 ? 4 : 2
    const counts = r.pos
    r.need(channels * height * countSize)
    let data = counts + channels * height * countSize
    for (let c = 0; c < channels; c++) {
      for (let y = 0; y < height; y++) {
        const idx = counts + (c * height + y) * countSize
        const len = countSize === 2 ? buf.readUInt16BE(idx) : buf.readUInt32BE(idx)
        if (c < want && y % step === 0) {
          if (data + len > buf.length) throw new Error('File PSD terpotong atau rusak.')
          unpackBits(buf, data, data + len, row)
          takeRow(planes[c], y / step)
        }
        data += len
      }
      if (c >= want - 1) break
    }
  } else {
    throw new Error('Gambar gabungan PSD memakai kompresi ZIP yang belum didukung. Pakai JPG pratinjau dengan nama yang sama.')
  }

  const n = w * h
  const rgba = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    let R: number, G: number, B: number
    if (mode === 'rgb') {
      R = planes[0][i]
      G = planes[1][i]
      B = planes[2][i]
    } else if (mode === 'grayscale') {
      R = G = B = planes[0][i]
    } else if (mode === 'indexed') {
      const k = planes[0][i]
      R = palette![k]
      G = palette![256 + k]
      B = palette![512 + k]
    } else {
      // CMYK di PSD disimpan terbalik (255 = tanpa tinta).
      const K = planes[3][i]
      R = Math.round((planes[0][i] * K) / 255)
      G = Math.round((planes[1][i] * K) / 255)
      B = Math.round((planes[2][i] * K) / 255)
    }
    rgba[i * 4] = R
    rgba[i * 4 + 1] = G
    rgba[i * 4 + 2] = B
    rgba[i * 4 + 3] = useAlpha ? planes[base][i] : 255
  }

  if (n > 16 && isUniform(rgba)) {
    throw new Error(
      'Gambar gabungan di PSD ini kosong, biasanya karena disimpan tanpa "Maximize PSD Compatibility". ' +
        'Simpan ulang PSD dengan opsi itu aktif, atau taruh JPG pratinjau dengan nama yang sama.'
    )
  }
  return { w, h, width, height, rgba, hasAlpha: useAlpha, mode }
}

function isUniform(rgba: Uint8Array): boolean {
  for (let i = 4; i < rgba.length; i += 4) {
    if (rgba[i] !== rgba[0] || rgba[i + 1] !== rgba[1] || rgba[i + 2] !== rgba[2] || rgba[i + 3] !== rgba[3]) return false
  }
  return true
}

/** Rata-kan transparansi ke latar putih (untuk JPG). */
export function flattenOnWhite(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255
    out[i] = Math.round(rgba[i] * a + 255 * (1 - a))
    out[i + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a))
    out[i + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a))
    out[i + 3] = 255
  }
  return out
}
