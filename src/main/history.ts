import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { HistoryEntry } from '../shared/types.ts'

/**
 * Riwayat upload, disimpan sebagai satu baris JSON per upload (history.jsonl).
 * Menambah baris tidak menulis ulang seluruh file, jadi tetap cepat walau ada puluhan ribu upload.
 */
export class History {
  private entries: HistoryEntry[] = []
  private sent = new Set<string>()
  private writing: Promise<void> = Promise.resolve()
  private readonly file: string

  constructor(file: string) {
    this.file = file
  }

  static key(accountId: string, fileName: string, size: number): string {
    return `${accountId}|${fileName.toLowerCase()}|${size}`
  }

  async init(): Promise<void> {
    let raw = ''
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    this.entries = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        this.entries.push(JSON.parse(line) as HistoryEntry)
      } catch {
        // baris rusak (mis. listrik mati saat menulis) dilewati
      }
    }
    this.reindex()
  }

  list(): HistoryEntry[] {
    return [...this.entries]
  }

  /** Sudah pernah berhasil dikirim ke akun ini? Dikenali dari nama file + ukuran. */
  wasSent(accountId: string, fileName: string, size: number): boolean {
    return this.sent.has(History.key(accountId, fileName, size))
  }

  async add(e: Omit<HistoryEntry, 'id'>): Promise<HistoryEntry> {
    const entry: HistoryEntry = { id: randomUUID(), ...e }
    this.entries.push(entry)
    if (entry.status === 'done') this.sent.add(History.key(entry.accountId, entry.fileName, entry.size))
    const line = JSON.stringify(entry) + '\n'
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      await fs.appendFile(this.file, line, 'utf8')
    })
    await this.writing
    return entry
  }

  async remove(ids: string[]): Promise<void> {
    const drop = new Set(ids)
    this.entries = this.entries.filter((e) => !drop.has(e.id))
    this.reindex()
    const data = this.entries.map((e) => JSON.stringify(e) + '\n').join('')
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await fs.writeFile(tmp, data, 'utf8')
      await fs.rename(tmp, this.file)
    })
    await this.writing
  }

  private reindex(): void {
    this.sent = new Set(
      this.entries.filter((e) => e.status === 'done').map((e) => History.key(e.accountId, e.fileName, e.size))
    )
  }
}

/** Ubah daftar riwayat menjadi teks CSV (dibuka rapi di Excel / Google Sheets). */
export function historyCsv(entries: HistoryEntry[]): string {
  const head = ['Waktu', 'File', 'Ukuran (byte)', 'Akun', 'Agensi', 'Hasil', 'Durasi (detik)', 'Keterangan', 'Lokasi file']
  const rows = entries.map((e) => [
    new Date(e.at).toISOString().replace('T', ' ').slice(0, 19),
    e.fileName,
    String(e.size),
    e.accountName,
    e.agency,
    e.status === 'done' ? 'Berhasil' : 'Gagal',
    e.ms ? (e.ms / 1000).toFixed(1) : '',
    e.error ?? '',
    e.filePath
  ])
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function csvCell(v: string): string {
  return /[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
