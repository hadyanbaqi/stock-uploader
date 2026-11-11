/**
 * Tes fungsi "Tes koneksi" terhadap server FTP, FTPS, dan SFTP lokal (localhost).
 * Login di sini hanya nilai uji acak yang dibuat setiap kali skrip jalan.
 * Jalankan: node scripts/test-connection.mts
 */
import { randomBytes, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { testConnection, type ConnectionTarget } from '../src/main/connection.ts'

const require = createRequire(import.meta.url)
const FtpSrv = require('ftp-srv')
const ssh2 = require('ssh2')

const USER = 'uji'
const PASS = randomBytes(9).toString('hex')
const root = mkdtempSync(path.join(tmpdir(), 'su-test-'))
writeFileSync(path.join(root, 'contoh.txt'), 'halo')

// Sertifikat self-signed untuk FTPS.
const certDir = mkdtempSync(path.join(tmpdir(), 'su-cert-'))
const keyPath = path.join(certDir, 'key.pem')
const certPath = path.join(certDir, 'cert.pem')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' })

function ftpServer(port: number, tls: boolean) {
  const srv = new FtpSrv({
    url: `ftp://127.0.0.1:${port}`,
    pasv_url: '127.0.0.1',
    pasv_min: port + 100,
    pasv_max: port + 150,
    anonymous: false,
    greeting: 'tes',
    tls: tls ? { key: require('node:fs').readFileSync(keyPath), cert: require('node:fs').readFileSync(certPath) } : false,
    log: { info() {}, debug() {}, trace() {}, warn() {}, error() {}, child() { return this } }
  })
  srv.on('login', ({ username, password }: { username: string; password: string }, resolve: (o: object) => void, reject: (e: Error) => void) => {
    if (username === USER && password === PASS) resolve({ root })
    else reject(new Error('530 Login incorrect'))
  })
  return srv
}

function sftpServer(port: number) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } })
  const { STATUS_CODE } = ssh2.utils.sftp
  const server = new ssh2.Server({ hostKeys: [privateKey] }, (client: any) => {
    client.on('authentication', (ctx: any) => {
      if (ctx.method === 'password' && ctx.username === USER && ctx.password === PASS) ctx.accept()
      else ctx.reject(['password'])
    })
    client.on('ready', () => {
      client.on('session', (accept: any) => {
        const session = accept()
        session.on('sftp', (acceptSftp: any) => {
          const sftp = acceptSftp()
          let listed = false
          sftp.on('REALPATH', (id: number) => sftp.name(id, [{ filename: '/', longname: '/', attrs: {} }]))
          sftp.on('STAT', (id: number) => sftp.attrs(id, { mode: 0o040755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 }))
          sftp.on('LSTAT', (id: number) => sftp.attrs(id, { mode: 0o040755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 }))
          sftp.on('OPENDIR', (id: number) => { listed = false; sftp.handle(id, Buffer.from('d')) })
          sftp.on('READDIR', (id: number) => {
            if (listed) return sftp.status(id, STATUS_CODE.EOF)
            listed = true
            sftp.name(id, [{ filename: 'contoh.txt', longname: '-rw-r--r-- 1 u u 4 Jan 1 00:00 contoh.txt', attrs: { mode: 0o100644, uid: 0, gid: 0, size: 4, atime: 0, mtime: 0 } }])
          })
          sftp.on('CLOSE', (id: number) => sftp.status(id, STATUS_CODE.OK))
        })
      })
    })
    client.on('error', () => undefined)
  })
  return new Promise<any>((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

const base = { host: '127.0.0.1', username: USER, remoteDir: '', allowInvalidCert: false }
const cases: { name: string; target: ConnectionTarget; expectOk: boolean }[] = [
  { name: 'FTP login benar', target: { ...base, protocol: 'ftp', port: 2121, password: PASS }, expectOk: true },
  { name: 'FTP password salah', target: { ...base, protocol: 'ftp', port: 2121, password: 'salah' }, expectOk: false },
  { name: 'FTP folder tidak ada', target: { ...base, protocol: 'ftp', port: 2121, password: PASS, remoteDir: '/tidak-ada' }, expectOk: false },
  { name: 'FTPS sertifikat self-signed ditolak', target: { ...base, protocol: 'ftps', port: 2321, password: PASS }, expectOk: false },
  { name: 'FTPS sertifikat diizinkan', target: { ...base, protocol: 'ftps', port: 2321, password: PASS, allowInvalidCert: true }, expectOk: true },
  { name: 'SFTP login benar', target: { ...base, protocol: 'sftp', port: 2222, password: PASS }, expectOk: true },
  { name: 'SFTP password salah', target: { ...base, protocol: 'sftp', port: 2222, password: 'salah' }, expectOk: false },
  { name: 'Port tertutup', target: { ...base, protocol: 'ftp', port: 2999, password: PASS }, expectOk: false },
  { name: 'Host tidak ada', target: { ...base, host: 'host-tidak-ada.invalid', protocol: 'ftp', port: 21, password: PASS }, expectOk: false }
]

const ftp = ftpServer(2121, false)
const ftps = ftpServer(2321, true)
await ftp.listen()
await ftps.listen()
const sftp = await sftpServer(2222)

let failed = 0
for (const c of cases) {
  const r = await testConnection(c.target)
  const pass = r.ok === c.expectOk
  if (!pass) failed++
  console.log(`${pass ? 'LULUS' : 'GAGAL'}  ${c.name.padEnd(36)} → ${r.message}${r.ok ? '' : `  [${r.detail}]`}`)
}

await ftp.close()
await ftps.close()
sftp.close()
console.log(failed ? `\n${failed} tes gagal` : '\nSemua tes lulus')
process.exit(failed ? 1 : 0)
