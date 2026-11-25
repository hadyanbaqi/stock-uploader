import { Client as FtpClient } from 'basic-ftp'
import SftpClient from 'ssh2-sftp-client'
import { isIP } from 'node:net'
import type { Protocol, TestResult } from '../shared/types'

export type ConnectionTarget = {
  protocol: Protocol
  host: string
  port: number
  username: string
  password: string
  remoteDir: string
  allowInvalidCert: boolean
  /** Buat folder tujuan kalau belum ada (Magnific: photo/<subfolder>). */
  makeDirs?: boolean
}

const TIMEOUT_MS = 20_000

/** Ubah pesan error teknis menjadi kalimat yang mudah dipahami. */
export function explainError(err: unknown): { message: string; detail: string } {
  const e = err as { code?: string | number; message?: string; level?: string }
  const raw = e?.message ?? String(err)
  const code = String(e?.code ?? '')
  const text = `${code} ${raw}`.toLowerCase()

  let message = 'Koneksi gagal.'
  if (code === 'ENOTFOUND' || text.includes('getaddrinfo')) message = 'Alamat host tidak ditemukan. Cek ejaan host atau koneksi internet.'
  else if (code === 'ECONNREFUSED') message = 'Server menolak koneksi. Cek port dan protokol (FTP/FTPS/SFTP).'
  else if (code === 'ETIMEDOUT' || text.includes('timeout') || text.includes('timed out')) message = 'Server tidak menjawab (timeout). Cek host, port, atau firewall.'
  else if (code === 'ECONNRESET') message = 'Koneksi diputus server. Coba ganti protokol atau cek apakah akun punya akses FTP.'
  else if (code === '530' || text.includes('530') || text.includes('login incorrect') || text.includes('authentication') || e?.level === 'client-authentication') message = 'Username atau password salah, atau akun belum punya akses FTP.'
  else if (text.includes('certificate') || text.includes('self signed') || text.includes('cert_')) message = 'Sertifikat keamanan server tidak valid. Aktifkan "Izinkan sertifikat tidak valid" hanya kalau kamu yakin servernya benar.'
  else if (code === '550' || text.includes('550') || text.includes('no such file')) message = 'Server menolak: folder tujuan tidak ditemukan, atau file/akses tidak diizinkan.'
  else if (text.includes('permission denied') || code === '3') message = 'Server menolak file ini (izin ditolak). Biasanya jenis file tidak diterima agensi (mis. PNG ke Magnific), atau folder itu belum dibuka untuk akunmu (Magnific: photo/psd/vector/video hanya yang aktif di akun).'
  else if (text.includes('tls') || text.includes('ssl') || text.includes('auth tls')) message = 'Server tidak mendukung FTPS. Coba protokol FTP biasa atau SFTP.'
  else if (code === '552' || text.includes('quota') || text.includes('disk full')) message = 'Ruang penyimpanan akun di server penuh.'
  else if (text.includes('ukuran file di server')) message = 'File di server tidak lengkap setelah dikirim.'
  else if (text.includes('handshake')) message = 'Gagal jabat tangan keamanan. Mungkin protokolnya salah (coba SFTP atau FTPS).'
  return { message, detail: raw }
}

export async function testConnection(t: ConnectionTarget): Promise<TestResult> {
  const started = Date.now()
  try {
    const where = t.protocol === 'sftp' ? await testSftp(t) : await testFtp(t)
    return { ok: true, message: `Berhasil terhubung. Folder: ${where}`, ms: Date.now() - started }
  } catch (err) {
    const { message, detail } = explainError(err)
    return { ok: false, message, detail, ms: Date.now() - started }
  }
}

async function testFtp(t: ConnectionTarget): Promise<string> {
  const client = new FtpClient(TIMEOUT_MS)
  try {
    await client.access({
      host: t.host,
      port: t.port,
      user: t.username,
      password: t.password,
      secure: t.protocol === 'ftps',
      secureOptions:
        t.protocol === 'ftps'
          ? { rejectUnauthorized: !t.allowInvalidCert, servername: isIP(t.host) ? undefined : t.host }
          : undefined
    })
    if (t.remoteDir) await client.cd(t.remoteDir)
    const dir = await client.pwd()
    await client.list()
    return dir
  } finally {
    client.close()
  }
}

async function testSftp(t: ConnectionTarget): Promise<string> {
  const client = new SftpClient()
  try {
    await client.connect({
      host: t.host,
      port: t.port,
      username: t.username,
      password: t.password,
      readyTimeout: TIMEOUT_MS,
      retries: 0
    })
    const dir = t.remoteDir ? t.remoteDir : await client.cwd()
    await client.list(dir)
    return dir
  } finally {
    await client.end().catch(() => undefined)
  }
}
