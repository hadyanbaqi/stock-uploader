/**
 * Server FTP, FTPS, dan SFTP lokal untuk tes (localhost saja). Server benar-benar menyimpan file,
 * dan sengaja dibuat lambat supaya putus/jeda bisa diuji di tengah file.
 * Login hanya nilai uji acak yang dibuat setiap kali skrip jalan.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { Writable } from 'node:stream'
import { closeSync, createWriteStream, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, statSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const FtpSrv = require('ftp-srv')
const ssh2 = require('ssh2')

export const USER = 'uji'
export const PASS = randomBytes(9).toString('hex')

// ---------- server uji ----------
const certDir = mkdtempSync(path.join(tmpdir(), 'su-cert-'))
const keyPath = path.join(certDir, 'key.pem')
const certPath = path.join(certDir, 'cert.pem')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' })
// Server dibuat lambat (sekitar 15 MB/detik) supaya putus/jeda benar-benar terjadi di tengah file.
export const RATE = 15 * 1024 * 1024
function slowWriter(fsPath: string, append: boolean) {
  const file = createWriteStream(fsPath, { flags: append ? 'a' : 'w' })
  let pending = 0
  const w = new Writable({
    write(chunk: Buffer, _enc, cb) {
      file.write(chunk, () => {
        pending += chunk.length
        if (pending < 512 * 1024) return cb()
        const wait = (pending / RATE) * 1000
        pending = 0
        setTimeout(cb, wait)
      })
    },
    final(cb) {
      file.end(cb)
    },
    destroy(err, cb) {
      // Seperti server sungguhan: bagian yang sudah diterima tetap disimpan.
      file.end(() => cb(err))
    }
  })
  return Object.assign(w, { path: fsPath })
}
const FileSystem = require('ftp-srv').FileSystem
class SlowFs extends FileSystem {
  write(fileName: string, { append = false } = {}) {
    const { fsPath, clientPath } = (this as any)._resolvePath(fileName)
    return { stream: slowWriter(fsPath, append), clientPath }
  }
}

const silent = { info() {}, debug() {}, trace() {}, warn() {}, error() {}, child() { return this } }

export function ftpServer(port: number, tls: boolean, root: string) {
  mkdirSync(root, { recursive: true })
  const srv = new FtpSrv({
    url: `ftp://127.0.0.1:${port}`,
    pasv_url: '127.0.0.1',
    pasv_min: port + 100,
    pasv_max: port + 180,
    anonymous: false,
    greeting: 'tes',
    tls: tls ? { key: readFileSync(keyPath), cert: readFileSync(certPath) } : false,
    log: silent
  })
  srv.on('login', ({ connection, username, password }: { connection: unknown; username: string; password: string }, resolve: (o: object) => void, reject: (e: Error) => void) => {
    if (username === USER && password === PASS) resolve({ root, fs: new SlowFs(connection, { root, cwd: '/' }) })
    else reject(new Error('530 Login incorrect'))
  })
  return {
    srv,
    root,
    kill() {
      for (const c of Object.values(srv.connections) as any[]) {
        c.connector?.end?.()
        c.commandSocket?.destroy()
      }
    }
  }
}

/** Server SFTP minimal yang menulis file sungguhan ke folder `root`. */
export async function sftpServer(port: number, root: string) {
  mkdirSync(root, { recursive: true })
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } })
  const { STATUS_CODE, flagsToString } = ssh2.utils.sftp
  const clients = new Set<any>()
  const local = (p: string) => path.join(root, path.posix.normalize('/' + p.replace(/^\.\/?/, '')))
  const attrsOf = (st: { size: number; mode: number }) => ({ mode: st.mode, uid: 0, gid: 0, size: st.size, atime: 0, mtime: 0 })
  const server = new ssh2.Server({ hostKeys: [privateKey] }, (client: any) => {
    clients.add(client)
    client.on('close', () => clients.delete(client))
    client.on('error', () => undefined)
    client.on('authentication', (ctx: any) => {
      if (ctx.method === 'password' && ctx.username === USER && ctx.password === PASS) ctx.accept()
      else ctx.reject(['password'])
    })
    client.on('ready', () => {
      client.on('session', (accept: any) => {
        accept().on('sftp', (acceptSftp: any) => {
          const sftp = acceptSftp()
          const handles = new Map<number, { fd?: number; dir?: string; listed?: boolean }>()
          let next = 1
          const handle = (h: Buffer) => handles.get(h.readUInt32BE(0))
          const mk = (v: { fd?: number; dir?: string }) => {
            const id = next++
            handles.set(id, v)
            const b = Buffer.alloc(4)
            b.writeUInt32BE(id)
            return b
          }
          const statPath = (id: number, p: string) => {
            try {
              sftp.attrs(id, attrsOf(statSync(local(p))))
            } catch {
              sftp.status(id, STATUS_CODE.NO_SUCH_FILE)
            }
          }
          sftp.on('REALPATH', (id: number, p: string) => {
            const v = path.posix.normalize('/' + p.replace(/^\.\/?/, ''))
            sftp.name(id, [{ filename: v, longname: v, attrs: {} }])
          })
          sftp.on('STAT', statPath)
          sftp.on('LSTAT', statPath)
          sftp.on('OPEN', (id: number, p: string, flags: number) => {
            try {
              const fd = openSync(local(p), flagsToString(flags) ?? 'r')
              sftp.handle(id, mk({ fd }))
            } catch {
              sftp.status(id, STATUS_CODE.FAILURE)
            }
          })
          let nextFree = 0
          sftp.on('WRITE', (id: number, h: Buffer, offset: number, data: Buffer) => {
            const v = handle(h)
            if (v?.fd === undefined) return sftp.status(id, STATUS_CODE.FAILURE)
            writeSync(v.fd, data, 0, data.length, offset)
            const now = Date.now()
            nextFree = Math.max(now, nextFree) + (data.length / RATE) * 1000
            setTimeout(() => sftp.status(id, STATUS_CODE.OK), nextFree - now)
          })
          sftp.on('FSTAT', (id: number, h: Buffer) => {
            const v = handle(h)
            if (v?.fd === undefined) return sftp.status(id, STATUS_CODE.FAILURE)
            sftp.attrs(id, attrsOf(fstatSync(v.fd)))
          })
          sftp.on('MKDIR', (id: number, p: string) => {
            try {
              mkdirSync(local(p))
              sftp.status(id, STATUS_CODE.OK)
            } catch {
              sftp.status(id, STATUS_CODE.FAILURE)
            }
          })
          sftp.on('FSETSTAT', (id: number) => sftp.status(id, STATUS_CODE.OK))
          sftp.on('SETSTAT', (id: number) => sftp.status(id, STATUS_CODE.OK))
          sftp.on('OPENDIR', (id: number, p: string) => sftp.handle(id, mk({ dir: local(p) })))
          sftp.on('READDIR', (id: number, h: Buffer) => {
            const v = handle(h)
            if (!v?.dir || v.listed) return sftp.status(id, STATUS_CODE.EOF)
            v.listed = true
            sftp.name(id, readdirSync(v.dir).map((n) => ({ filename: n, longname: n, attrs: attrsOf(statSync(path.join(v.dir!, n))) })))
          })
          sftp.on('CLOSE', (id: number, h: Buffer) => {
            const v = handle(h)
            if (v?.fd !== undefined) closeSync(v.fd)
            handles.delete(h.readUInt32BE(0))
            sftp.status(id, STATUS_CODE.OK)
          })
        })
      })
    })
  })
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()))
  return {
    server,
    root,
    kill() {
      for (const c of clients) c.end()
    }
  }
}

