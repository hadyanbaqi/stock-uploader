/**
 * Tes aplikasi sungguhan (Electron): 10 video ke 3 akun (FTP, FTPS, SFTP lokal) tanpa campur tangan.
 * Jalankan setelah `npm run build`: node scripts/test-app.mts
 * APP=<path aplikasi terpasang> untuk menguji hasil installer, bukan hasil build.
 */
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ftpServer, sftpServer, USER, PASS } from './test-servers.mts'
import type { QueueTask } from '../src/shared/types.ts'

const require = createRequire(import.meta.url)
const work = mkdtempSync(path.join(tmpdir(), 'su-app-'))
const folder = path.join(work, 'render')
const shots = process.env.SHOTS ?? path.join(work, 'layar')
mkdirSync(folder, { recursive: true })
mkdirSync(shots, { recursive: true })

const videos: string[] = []
for (let i = 1; i <= 10; i++) {
  const p = path.join(folder, `motion-bg-${String(i).padStart(2, '0')}.mp4`)
  writeFileSync(p, randomBytes((8 + i) * 1024 * 1024))
  videos.push(p)
}
writeFileSync(path.join(folder, 'catatan.txt'), 'bukan file stok')

const ftp = ftpServer(2141, false, path.join(work, 'srv-ftp'))
const ftps = ftpServer(2341, true, path.join(work, 'srv-ftps'))
await ftp.srv.listen()
await ftps.srv.listen()
const sftp = await sftpServer(2242, path.join(work, 'srv-sftp'))

const acc = (name: string, protocol: 'ftp' | 'ftps' | 'sftp', port: number, color: string) => ({
  name, agency: 'other', protocol, host: '127.0.0.1', port, username: USER, password: PASS,
  remoteDir: '', color, enabled: true, allowInvalidCert: protocol === 'ftps'
})
const out = path.join(work, 'hasil.json')
const config = path.join(work, 'e2e.json')
writeFileSync(config, JSON.stringify({
  accounts: [acc('Server Uji - FTP', 'ftp', 2141, '#2563eb'), acc('Server Uji - FTPS', 'ftps', 2341, '#16a34a'), acc('Server Uji - SFTP', 'sftp', 2242, '#9333ea')],
  files: videos,
  folder,
  out,
  shots
}))

const bin = process.env.APP ?? (require('electron') as string)
const args = process.env.APP ? [] : ['.']
const t0 = Date.now()
const code = await new Promise<number>((resolve) => {
  const child = spawn(bin, args, {
    stdio: 'inherit',
    env: { ...process.env, SU_E2E: config, SU_USERDATA: path.join(work, 'data'), ELECTRON_RENDERER_URL: '' }
  })
  child.on('exit', (c) => resolve(c ?? 1))
})

let failed = 0
const check = (name: string, ok: boolean, info = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${info ? `  → ${info}` : ''}`)
}
const hash = (p: string) =>
  new Promise<string>((res, rej) => {
    const h = createHash('sha256')
    createReadStream(p).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej)
  })

check('aplikasi keluar normal', code === 0, `kode ${code}`)
const r = JSON.parse(readFileSync(out, 'utf8')) as { expanded?: { files: number; skipped: number }; added?: { added: number }; tasks?: QueueTask[]; error?: string }
if (r.error) console.log(r.error)
check('isi folder terbaca, file non-stok dilewati', r.expanded?.files === 10 && r.expanded?.skipped === 1, JSON.stringify(r.expanded))
check('30 upload masuk antrean', r.added?.added === 30, JSON.stringify(r.added))
const done = (r.tasks ?? []).filter((t) => t.status === 'done').length
check('30 upload selesai tanpa campur tangan', done === 30, `${done}/30 dalam ${((Date.now() - t0) / 1000).toFixed(0)} dtk`)
let intact = 0
for (const v of videos) {
  const want = await hash(v)
  for (const root of [ftp.root, ftps.root, sftp.root]) {
    const dst = path.join(root, path.basename(v))
    try {
      if (statSync(dst).size === statSync(v).size && (await hash(dst)) === want) intact++
    } catch {
      // tidak ada
    }
  }
}
check('30 file di server identik', intact === 30, `${intact}/30`)
console.log(`\nTangkapan layar: ${shots}`)

await ftp.srv.close()
await ftps.srv.close()
sftp.server.close()
console.log(failed ? `\n${failed} tes gagal` : '\nSemua tes lulus')
process.exit(failed ? 1 : 0)
