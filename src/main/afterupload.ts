import { promises as fs } from 'node:fs'
import path from 'node:path'
import { agencyFromPath } from '../shared/agencyFolder.ts'
import type { QueueTask } from '../shared/types.ts'
import { formatCsv, parseCsv } from './csvtable.ts'

/**
 * Setelah upload berhasil:
 * 1. tandai "sudah" di metadata-master.csv (kolom agensi itu, hanya kalau isinya "belum");
 * 2. kalau semua upload file itu selesai, pindahkan file ke folder _sudah-upload (atau ke Tempat Sampah).
 */

/** Kolom di metadata-master.csv untuk tiap agensi. */
const MASTER_COL: Record<string, string> = {
  adobe: 'adobe',
  shutterstock: 'shutterstock',
  vecteezy: 'vecteezy',
  freepik: 'freepik',
  dreamstime: 'dreamstime',
  pond5: 'pond5',
  '123rf': '123rf',
  depositphotos: 'depositphotos',
  alamy: 'alamy',
  istock: 'istock'
}

/** metadata-master.csv terdekat: di folder _FILE-KERJA pada folder file atau folder di atasnya (sampai 5 tingkat). */
export async function findMaster(filePath: string): Promise<string | null> {
  let dir = path.dirname(filePath)
  for (let up = 0; up <= 5; up++) {
    for (const f of [path.join(dir, '_FILE-KERJA', 'metadata-master.csv'), path.join(dir, 'metadata-master.csv')]) {
      try {
        if ((await fs.stat(f)).isFile()) return f
      } catch {
        // tidak ada
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** Ubah "belum" → "sudah" untuk pasangan (nama file, agensi). Mengembalikan jumlah sel yang diubah. */
export async function markMaster(master: string, items: { name: string; agency: string }[]): Promise<number> {
  const t = parseCsv(await fs.readFile(master, 'utf8'))
  const [head, ...rows] = t.rows
  if (!head) return 0
  const h = head.map((x) => x.toLowerCase().trim())
  const iFile = h.indexOf('filename')
  if (iFile < 0) return 0
  const byName = new Map<string, string[][]>()
  for (const r of rows) {
    const k = (r[iFile] ?? '').toLowerCase()
    byName.set(k, [...(byName.get(k) ?? []), r])
  }
  let changed = 0
  for (const it of items) {
    const col = h.indexOf(MASTER_COL[it.agency] ?? it.agency)
    if (col < 0) continue
    for (const r of byName.get(it.name.toLowerCase()) ?? []) {
      if ((r[col] ?? '').trim().toLowerCase() === 'belum') {
        r[col] = 'sudah'
        changed++
      }
    }
  }
  if (changed) {
    const tmp = `${master}.tmp-su`
    await fs.writeFile(tmp, formatCsv(t), 'utf8')
    await fs.rename(tmp, master)
  }
  return changed
}

/**
 * Tujuan pindah: folder _sudah-upload di sebelah folder agensi, dengan susunan folder yang sama
 * (".../ADOBE-STOCK/14/x.jpg" → ".../_sudah-upload/ADOBE-STOCK/14/x.jpg"), supaya skrip yang
 * menyusun folder agensi tidak menariknya kembali. Tanpa folder agensi: "_sudah-upload" di folder file itu.
 */
export function doneTarget(filePath: string): string {
  const fa = agencyFromPath(filePath)
  if (fa) {
    const rel = path.relative(fa.dir, filePath)
    if (rel && !rel.startsWith('..')) return path.join(path.dirname(fa.dir), '_sudah-upload', fa.folderName, rel)
  }
  return path.join(path.dirname(filePath), '_sudah-upload', path.basename(filePath))
}

export async function moveDone(filePath: string): Promise<string> {
  let dest = doneTarget(filePath)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  const ext = path.extname(dest)
  for (let i = 2; ; i++) {
    try {
      await fs.access(dest)
      dest = dest.slice(0, dest.length - ext.length).replace(/ \(\d+\)$/, '') + ` (${i})${ext}`
    } catch {
      break
    }
  }
  try {
    await fs.rename(filePath, dest)
  } catch (err) {
    // Beda disk: salin lalu hapus.
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await fs.copyFile(filePath, dest)
    await fs.unlink(filePath)
  }
  return dest
}

export type AfterDeps = {
  settings: () => Promise<{ markMaster: boolean; afterDone: 'keep' | 'move' | 'trash' }>
  tasks: () => QueueTask[]
  trash: (p: string) => Promise<void>
  notify: (text: string) => void
  delayMs?: number
}

const ACTIVE: QueueTask['status'][] = ['queued', 'uploading', 'retrying', 'paused']

export class AfterUpload {
  private marks: { path: string; name: string; agency: string }[] = []
  private pendingMove = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private chain: Promise<void> = Promise.resolve()
  private readonly deps: AfterDeps

  constructor(deps: AfterDeps) {
    this.deps = deps
  }

  /** Dipanggil tiap kali satu upload selesai (berhasil atau gagal). */
  finished(t: QueueTask, agency: string): void {
    if (t.status === 'done') {
      this.marks.push({ path: t.filePath, name: t.fileName, agency })
      this.pendingMove.add(t.filePath)
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.chain = this.chain.then(() => this.run()).catch((err) => console.error('Setelah upload:', err))
    }, this.deps.delayMs ?? 1500)
  }

  /** Tunggu pekerjaan yang sedang berjalan (dipakai saat aplikasi ditutup dan di tes). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
      this.chain = this.chain.then(() => this.run())
    }
    await this.chain
  }

  private async run(): Promise<void> {
    const s = await this.deps.settings()
    const msgs: string[] = []

    const marks = this.marks.splice(0)
    if (s.markMaster && marks.length) {
      const byMaster = new Map<string, { name: string; agency: string }[]>()
      for (const m of marks) {
        const master = await findMaster(m.path)
        if (master) byMaster.set(master, [...(byMaster.get(master) ?? []), m])
      }
      for (const [master, items] of byMaster) {
        try {
          const n = await markMaster(master, items)
          if (n) msgs.push(`${n} status di ${path.basename(master)} diubah jadi "sudah"`)
        } catch (err) {
          msgs.push(`Gagal mengubah ${path.basename(master)}: ${(err as Error).message}`)
        }
      }
    }

    if (s.afterDone === 'keep') {
      this.pendingMove.clear()
    } else {
      const tasks = this.deps.tasks()
      let moved = 0
      let failed = 0
      for (const p of [...this.pendingMove]) {
        const mine = tasks.filter((t) => t.filePath === p)
        if (mine.some((t) => ACTIVE.includes(t.status))) continue // masih ada upload lain untuk file ini
        this.pendingMove.delete(p)
        if (mine.some((t) => t.status === 'failed' || t.status === 'canceled')) continue // ada yang gagal: biarkan
        try {
          await fs.access(p)
        } catch {
          continue // sudah dipindah/dihapus
        }
        try {
          if (s.afterDone === 'trash') await this.deps.trash(p)
          else await moveDone(p)
          moved++
        } catch {
          failed++
        }
      }
      if (moved) msgs.push(`${moved} file dipindah ke ${s.afterDone === 'trash' ? 'Tempat Sampah' : 'folder _sudah-upload'}`)
      if (failed) msgs.push(`${failed} file gagal dipindah`)
    }
    if (msgs.length) this.deps.notify(msgs.join(' · '))
  }
}
