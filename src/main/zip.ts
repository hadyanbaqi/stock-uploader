import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * ZIP sederhana tanpa modul tambahan. File disimpan tanpa kompresi (metode "store"):
 * JPG/PNG/MP4 memang sudah terkompresi, jadi hasilnya hampir sama besar dan jauh lebih cepat.
 * Batas: total di bawah 4 GB (tanpa ZIP64).
 */

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }
}

/** Tulis ZIP berisi `files` (path di disk). Nama di dalam ZIP = nama file (dobel diberi akhiran). */
/** `root`: kalau diisi, nama di dalam ZIP memakai folder relatif terhadap root (mis. "FREEPIK/efek.psd"). */
export async function writeZip(zipPath: string, files: string[], root?: string): Promise<{ count: number; bytes: number }> {
  const tmp = `${zipPath}.tmp`
  const fh = await fs.open(tmp, 'w')
  const central: Buffer[] = []
  const used = new Set<string>()
  let offset = 0
  try {
    for (const f of files) {
      const data = await fs.readFile(f)
      const st = await fs.stat(f)
      const rel = root ? path.relative(root, f).split(path.sep).join('/') : ''
      const base = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : path.basename(f)
      let name = base
      const ext = path.extname(base)
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, base.length - ext.length)}-${i}${ext}`
      used.add(name.toLowerCase())
      const nameBuf = Buffer.from(name, 'utf8')
      const crc = crc32(data)
      const { time, date } = dosTime(st.mtime)
      if (offset + data.length > 0xfffffff0) throw new Error('ZIP lebih dari 4 GB, bagi jadi beberapa ZIP.')

      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(0x0800, 6) // nama file UTF-8
      local.writeUInt16LE(0, 8) // store
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(data.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(nameBuf.length, 26)
      local.writeUInt16LE(0, 28)
      await fh.write(Buffer.concat([local, nameBuf]))
      await fh.write(data)

      const cen = Buffer.alloc(46)
      cen.writeUInt32LE(0x02014b50, 0)
      cen.writeUInt16LE(20, 4)
      cen.writeUInt16LE(20, 6)
      cen.writeUInt16LE(0x0800, 8)
      cen.writeUInt16LE(0, 10)
      cen.writeUInt16LE(time, 12)
      cen.writeUInt16LE(date, 14)
      cen.writeUInt32LE(crc, 16)
      cen.writeUInt32LE(data.length, 20)
      cen.writeUInt32LE(data.length, 24)
      cen.writeUInt16LE(nameBuf.length, 28)
      cen.writeUInt32LE(offset, 42)
      central.push(Buffer.concat([cen, nameBuf]))
      offset += 30 + nameBuf.length + data.length
    }
    const dir = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(central.length, 8)
    end.writeUInt16LE(central.length, 10)
    end.writeUInt32LE(dir.length, 12)
    end.writeUInt32LE(offset, 16)
    await fh.write(Buffer.concat([dir, end]))
  } catch (err) {
    await fh.close()
    await fs.unlink(tmp).catch(() => undefined)
    throw err
  }
  await fh.close()
  await fs.rename(tmp, zipPath)
  return { count: central.length, bytes: offset }
}
