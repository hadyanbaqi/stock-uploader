import { Client as FtpClient, FTPError } from 'basic-ftp'
import SftpClient from 'ssh2-sftp-client'
import { createReadStream, promises as fs } from 'node:fs'
import { isIP } from 'node:net'
import path from 'node:path'
import type { ConnectionTarget } from './connection.ts'

export type UploadOptions = {
  signal: AbortSignal
  /** Dipanggil dengan total byte yang sudah ada di server (termasuk bagian yang dilanjutkan). */
  onProgress: (sent: number) => void
  /** Coba lanjutkan dari bagian yang sudah terkirim (hanya FTP/FTPS yang mendukung). */
  resume: boolean
}

export type UploadOutcome = { resumedFrom: number }

const TIMEOUT_MS = 30_000

/** Error yang tidak ada gunanya dicoba ulang (login salah, folder tidak ada, dll). */
export class PermanentError extends Error {
  permanent = true
}

export async function uploadFile(t: ConnectionTarget, localPath: string, opts: UploadOptions): Promise<UploadOutcome> {
  const { size } = await fs.stat(localPath)
  if (opts.signal.aborted) throw new Error('Dibatalkan')
  return t.protocol === 'sftp' ? uploadSftp(t, localPath, size, opts) : uploadFtp(t, localPath, size, opts)
}

async function uploadFtp(t: ConnectionTarget, localPath: string, size: number, opts: UploadOptions): Promise<UploadOutcome> {
  const name = path.basename(localPath)
  const client = new FtpClient(TIMEOUT_MS)
  const abort = () => client.close()
  opts.signal.addEventListener('abort', abort, { once: true })
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
    if (t.remoteDir) await (t.makeDirs ? client.ensureDir(t.remoteDir) : client.cd(t.remoteDir))

    let start = 0
    if (opts.resume) {
      start = await remoteSizeFtp(client, name)
      if (start > size) start = 0
      if (start === size && size > 0) {
        // File sudah lengkap di server (koneksi putus tepat setelah selesai).
        opts.onProgress(size)
        return { resumedFrom: size }
      }
    }

    client.trackProgress((info) => opts.onProgress(start + info.bytes))
    if (start > 0) {
      try {
        await client.appendFrom(createReadStream(localPath, { start }), name)
      } catch (err) {
        // Server tidak mendukung "lanjutkan": kirim ulang dari awal.
        if (!(err instanceof FTPError) || client.closed) throw err
        start = 0
        await client.uploadFrom(localPath, name)
      }
    } else {
      await client.uploadFrom(localPath, name)
    }
    client.trackProgress()

    const remote = await remoteSizeFtp(client, name, -1)
    if (remote >= 0 && remote !== size) {
      throw new Error(`Ukuran file di server (${remote} byte) tidak sama dengan file asli (${size} byte).`)
    }
    opts.onProgress(size)
    return { resumedFrom: start }
  } catch (err) {
    if (err instanceof FTPError && err.code >= 500) throw Object.assign(new PermanentError(err.message, { cause: err }), { code: err.code })
    throw err
  } finally {
    opts.signal.removeEventListener('abort', abort)
    client.close()
  }
}

/** Ukuran file di server, atau `fallback` kalau tidak ada / server tidak mendukung SIZE. */
async function remoteSizeFtp(client: FtpClient, name: string, fallback = 0): Promise<number> {
  try {
    return await client.size(name)
  } catch (err) {
    if (err instanceof FTPError) return fallback
    throw err
  }
}

async function uploadSftp(t: ConnectionTarget, localPath: string, size: number, opts: UploadOptions): Promise<UploadOutcome> {
  const name = path.basename(localPath)
  const remote = t.remoteDir ? path.posix.join(t.remoteDir, name) : name
  const client = new SftpClient()
  const abort = () => {
    const raw = (client as unknown as { client?: { destroy?: () => void; end?: () => void } }).client
    if (raw?.destroy) raw.destroy()
    else raw?.end?.()
  }
  opts.signal.addEventListener('abort', abort, { once: true })
  try {
    await client.connect({
      host: t.host,
      port: t.port,
      username: t.username,
      password: t.password,
      readyTimeout: TIMEOUT_MS,
      retries: 0
    })
    if (opts.signal.aborted) throw new Error('Dibatalkan')
    if (t.makeDirs && t.remoteDir && !(await client.exists(t.remoteDir))) {
      try {
        await client.mkdir(t.remoteDir, true)
      } catch (err) {
        // Upload lain bisa membuat folder yang sama di saat bersamaan.
        if (!(await client.exists(t.remoteDir))) throw err
      }
    }
    opts.onProgress(0)
    // fastPut mengirim beberapa potongan sekaligus, jauh lebih cepat untuk server yang jauh.
    await client.fastPut(localPath, remote, {
      concurrency: 32,
      chunkSize: 64 * 1024,
      step: (total) => opts.onProgress(total)
    })
    let remoteSize = -1
    try {
      remoteSize = (await client.stat(remote)).size
    } catch {
      // Beberapa server langsung memindahkan file setelah upload.
    }
    if (remoteSize >= 0 && remoteSize !== size) {
      throw new Error(`Ukuran file di server (${remoteSize} byte) tidak sama dengan file asli (${size} byte).`)
    }
    opts.onProgress(size)
    return { resumedFrom: 0 }
  } catch (err) {
    if (isPermanentSftp(err)) {
      const e = err as { message?: string; level?: string }
      throw Object.assign(new PermanentError(e.message ?? String(err), { cause: err }), { level: e.level })
    }
    throw err
  } finally {
    opts.signal.removeEventListener('abort', abort)
    // end() bisa menggantung kalau koneksi sudah diputus paksa.
    await Promise.race([client.end().catch(() => undefined), new Promise((r) => setTimeout(r, 3000))])
  }
}

function isPermanentSftp(err: unknown): boolean {
  const e = err as { level?: string; code?: unknown; message?: string }
  if (e?.level === 'client-authentication') return true
  const msg = (e?.message ?? '').toLowerCase()
  if (msg.includes('authentication') || msg.includes('permission denied') || msg.includes('no such file')) return true
  // Kode status SFTP: 2 = tidak ada, 3 = ditolak, 8 = tidak didukung.
  return e?.code === 2 || e?.code === 3 || e?.code === 8
}

export function isPermanent(err: unknown): boolean {
  return (err as { permanent?: boolean })?.permanent === true
}
