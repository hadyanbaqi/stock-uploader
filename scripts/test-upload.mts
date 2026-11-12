/**
 * Tes antrean upload terhadap server FTP, FTPS, dan SFTP lokal (localhost) yang benar-benar menyimpan file.
 * Login di sini hanya nilai uji acak yang dibuat setiap kali skrip jalan.
 * Jalankan: node scripts/test-upload.mts        (BIG=1 untuk tambah tes file 500 MB)
 */
import { createHash, randomBytes } from 'node:crypto'
import { closeSync, createReadStream, mkdirSync, mkdtempSync, openSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { UploadQueue, type ResolvedAccount } from '../src/main/queue.ts'
import { uploadFile } from '../src/main/transfer.ts'
import { History, historyCsv } from '../src/main/history.ts'
import type { ConnectionTarget } from '../src/main/connection.ts'
import type { QueueTask } from '../src/shared/types.ts'

import { ftpServer, sftpServer, USER, PASS } from './test-servers.mts'

const BIG = process.env.BIG === '1'
const work = mkdtempSync(path.join(tmpdir(), 'su-up-'))
const src = path.join(work, 'sumber')
mkdirSync(src)

// ---------- bantuan ----------
let failed = 0
function check(name: string, ok: boolean, info = '') {
  if (!ok) failed++
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${info ? `  → ${info}` : ''}`)
}

function makeFile(name: string, mb: number): string {
  const p = path.join(src, name)
  const fd = openSync(p, 'w')
  const chunk = randomBytes(1024 * 1024)
  for (let i = 0; i < mb; i++) {
    chunk[0] = i & 255
    writeSync(fd, chunk)
  }
  closeSync(fd)
  return p
}

function hash(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    return statSync(a).size === statSync(b).size && (await hash(a)) === (await hash(b))
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(q: UploadQueue, pred: (tasks: QueueTask[]) => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (pred(q.list())) return true
    await sleep(100)
  }
  return false
}
const finished = (t: QueueTask) => ['done', 'failed', 'canceled'].includes(t.status)

// ---------- jalankan ----------
const ftp = ftpServer(2131, false, path.join(work, 'srv-ftp'))
const ftps = ftpServer(2331, true, path.join(work, 'srv-ftps'))
await ftp.srv.listen()
await ftps.srv.listen()
const sftp = await sftpServer(2232, path.join(work, 'srv-sftp'))

const base = { host: '127.0.0.1', username: USER, password: PASS, remoteDir: '', allowInvalidCert: false }
const accounts: Record<string, ResolvedAccount & { root: string }> = {
  ftp: { name: 'Uji FTP', color: '#2563eb', root: ftp.root, target: { ...base, protocol: 'ftp', port: 2131 } },
  ftps: { name: 'Uji FTPS', color: '#16a34a', root: ftps.root, target: { ...base, protocol: 'ftps', port: 2331, allowInvalidCert: true } },
  sftp: { name: 'Uji SFTP', color: '#9333ea', root: sftp.root, target: { ...base, protocol: 'sftp', port: 2232 } },
  salah: { name: 'Uji password salah', color: '#dc2626', root: ftp.root, target: { ...base, protocol: 'ftp', port: 2131, password: 'salah' } }
}

// Kait untuk tes: dipanggil setiap ada kemajuan upload.
type Hook = (t: ConnectionTarget, file: string, sent: number, size: number) => void
const hooks: Hook[] = []
const queueFile = path.join(work, 'queue.json')
const history = new History(path.join(work, 'history.jsonl'))
await history.init()
const deps = {
  wasSent: (id: string, name: string, size: number) => history.wasSent(id, name, size),
  onFinished: (t: QueueTask, agency: string) => {
    void history.add({ fileName: t.fileName, filePath: t.filePath, size: t.size, accountId: t.accountId, accountName: t.accountName, agency, status: t.status === 'done' ? 'done' : 'failed', at: Date.now(), ms: t.lastAttemptMs, error: t.error })
  },
  file: queueFile,
  perAccount: 2,
  retryDelays: [300, 300, 300],
  onChange: () => undefined,
  resolve: async (id: string) => accounts[id] ?? null,
  upload: (t: ConnectionTarget, file: string, opts: Parameters<typeof uploadFile>[2]) => {
    const size = statSync(file).size
    return uploadFile(t, file, {
      ...opts,
      onProgress: (s) => {
        opts.onProgress(s)
        for (const h of hooks) h(t, file, s, size)
      }
    })
  }
}
const q = new UploadQueue(deps)
await q.init()

// 1. 10 video ke 3 akun sekaligus
console.log('\n[1] 10 file video ke 3 akun (FTP, FTPS, SFTP)')
const videos = Array.from({ length: 10 }, (_, i) => makeFile(`video-${String(i + 1).padStart(2, '0')}.mp4`, 8))
let t0 = Date.now()
const r1 = await q.add(videos, ['ftp', 'ftps', 'sftp'])
check('30 tugas masuk antrean', r1.added === 30, JSON.stringify(r1))
const r1b = await q.add(videos.slice(0, 2), ['ftp'])
check('file yang sama tidak masuk dua kali', r1b.added === 0 && r1b.duplicates === 2, JSON.stringify(r1b))
let peak = 0
const peakWatch = setInterval(() => {
  const n = q.list().filter((t) => t.status === 'uploading' && t.accountId === 'sftp').length
  peak = Math.max(peak, n)
}, 20)
await waitFor(q, (ts) => ts.every(finished), 120_000)
clearInterval(peakWatch)
let all = q.list()
check('semua 30 selesai', all.filter((t) => t.status === 'done').length === 30, `${((Date.now() - t0) / 1000).toFixed(1)} dtk`)
check('maks 2 upload bersamaan per akun', peak <= 2, `puncak ${peak}`)
let intact = 0
for (const v of videos) for (const k of ['ftp', 'ftps', 'sftp']) if (await sameFile(v, path.join(accounts[k].root, path.basename(v)))) intact++
check('30 file di server identik dengan aslinya', intact === 30, `${intact}/30`)

// 2. koneksi putus di tengah
console.log('\n[2] Koneksi diputus di tengah upload')
q.clearDone()
const bigA = makeFile('putus-ftp.mp4', 40)
const bigB = makeFile('putus-sftp.mp4', 40)
const killed = new Set<string>()
hooks.push((t, file, sent, size) => {
  const key = `${t.protocol}:${file}`
  if (killed.has(key) || sent < size * 0.3) return
  if ((t.protocol === 'ftp' && file === bigA) || (t.protocol === 'sftp' && file === bigB)) {
    killed.add(key)
    ;(t.protocol === 'ftp' ? ftp : sftp).kill()
  }
})
await q.add([bigA], ['ftp'])
await q.add([bigB], ['sftp'])
await waitFor(q, (ts) => ts.every(finished), 120_000)
all = q.list()
const ta = all.find((t) => t.filePath === bigA)!
const tb = all.find((t) => t.filePath === bigB)!
check('FTP: koneksi benar-benar diputus', killed.has(`ftp:${bigA}`))
check('FTP: selesai setelah coba ulang', ta.status === 'done' && ta.attempt >= 2, `status ${ta.status}, percobaan ${ta.attempt}${ta.error ? `, ${ta.error}` : ''}`)
check('FTP: dilanjutkan dari bagian yang sudah terkirim', (ta.resumedFrom ?? 0) > 0, `lanjut dari ${((ta.resumedFrom ?? 0) / 1048576).toFixed(1)} MB`)
check('FTP: file utuh', await sameFile(bigA, path.join(ftp.root, path.basename(bigA))))
check('SFTP: selesai setelah coba ulang', tb.status === 'done' && tb.attempt >= 2, `status ${tb.status}, percobaan ${tb.attempt}${tb.error ? `, ${tb.error}` : ''}`)
check('SFTP: file utuh', await sameFile(bigB, path.join(sftp.root, path.basename(bigB))))

// 3. jeda lalu lanjut
console.log('\n[3] Jeda lalu lanjutkan')
q.clearDone()
const bigC = makeFile('jeda-ftps.mp4', 40)
let pausedOnce = false
hooks.push((t, file, sent, size) => {
  if (pausedOnce || file !== bigC || sent < size * 0.25) return
  pausedOnce = true
  const task = q.list().find((x) => x.filePath === bigC)
  if (task) q.action('pause', [task.id])
})
await q.add([bigC], ['ftps'])
const gotPaused = await waitFor(q, (ts) => ts.some((t) => t.filePath === bigC && t.status === 'paused'), 60_000)
const pausedAt = q.list().find((t) => t.filePath === bigC)!.sent
check('status berubah jadi dijeda', gotPaused, `berhenti di ${(pausedAt / 1048576).toFixed(1)} MB`)
const r3 = await q.add([bigC], ['ftps'])
check('file yang sedang dijeda tidak masuk dua kali', r3.added === 0)
// Beri waktu server menutup file lama (seperti pengguna yang menekan Lanjut beberapa detik kemudian).
await sleep(1500)
q.pauseAll(false)
await waitFor(q, (ts) => ts.every(finished), 60_000)
const tc = q.list().find((t) => t.filePath === bigC)!
check('selesai setelah dilanjutkan', tc.status === 'done', tc.error)
check('FTPS: dilanjutkan, bukan dari awal', (tc.resumedFrom ?? 0) > 0, `lanjut dari ${((tc.resumedFrom ?? 0) / 1048576).toFixed(1)} MB`)
check('FTPS: file utuh', await sameFile(bigC, path.join(ftps.root, path.basename(bigC))))

// 4. batal, password salah, file hilang, nama sama
console.log('\n[4] Batal, password salah, nama file sama')
q.clearDone()
const bigD = makeFile('batal.mp4', 40)
let canceledOnce = false
hooks.push((_t, file, sent, size) => {
  if (canceledOnce || file !== bigD || sent < size * 0.1) return
  canceledOnce = true
  const task = q.list().find((x) => x.filePath === bigD)
  if (task) q.action('cancel', [task.id])
})
await q.add([bigD], ['sftp'])
await q.add([videos[0]], ['salah'])
mkdirSync(path.join(src, 'lain'))
const twin = path.join(src, 'lain', path.basename(videos[1]))
writeFileSync(twin, 'beda isi')
await q.add([videos[1]], ['ftps'], true)
const r4 = await q.add([twin], ['ftps'])
check('file beda dengan nama sama ke akun yang sama ditolak', r4.sameName === 1, JSON.stringify(r4))
await waitFor(q, (ts) => ts.every(finished), 60_000)
all = q.list()
const td = all.find((t) => t.filePath === bigD)!
const te = all.find((t) => t.accountId === 'salah')!
check('upload dibatalkan', td.status === 'canceled', td.status)
check('password salah: gagal tanpa coba ulang', te.status === 'failed' && te.attempt === 1, `${te.status}, percobaan ${te.attempt}: ${te.error}`)
q.action('retry', [td.id])
await waitFor(q, (ts) => ts.every(finished), 60_000)
check('yang dibatalkan bisa dicoba lagi sampai selesai', q.list().find((t) => t.id === td.id)?.status === 'done')

// 5. antrean tersimpan
console.log('\n[5] Antrean tersimpan saat aplikasi dibuka lagi')
await q.flush()
const q2 = new UploadQueue({ ...deps })
await q2.init()
check('daftar tugas sama setelah dimuat ulang', q2.list().length === q.list().length, `${q2.list().length} tugas`)
await q2.shutdown()

// 6. riwayat dan cegah dobel
console.log('\n[6] Riwayat dan cegah dobel')
await sleep(200)
const h = history.list()
check('riwayat mencatat semua upload yang selesai', h.filter((e) => e.status === 'done').length >= 34, `${h.length} catatan`)
check('riwayat mencatat yang gagal', h.some((e) => e.status === 'failed' && e.accountId === 'salah'))
const r6 = await q.add(videos, ['ftp', 'sftp'])
check('file yang sudah pernah dikirim dilewati', r6.added === 0 && r6.alreadySent === 20, JSON.stringify(r6))
const r6b = await q.add(videos.slice(0, 2), ['ftp'], true)
check('bisa dipaksa kirim ulang', r6b.added === 2, JSON.stringify(r6b))
await waitFor(q, (ts) => ts.every(finished), 60_000)
await sleep(300)
const h2 = new History(path.join(work, 'history.jsonl'))
await h2.init()
check('riwayat tersimpan di disk', h2.list().length === history.list().length && h2.wasSent('ftps', path.basename(videos[3]), statSync(videos[3]).size))
const one = h2.list().find((e) => e.accountId === 'ftps' && e.fileName === path.basename(videos[3]))!
await h2.remove([one.id])
const h3 = new History(path.join(work, 'history.jsonl'))
await h3.init()
check('hapus dari riwayat = boleh dikirim lagi', !h3.wasSent('ftps', one.fileName, one.size) && h3.list().length === h2.list().length)
const csv = historyCsv(h3.list())
check('ekspor CSV riwayat', csv.split('\r\n').length === h3.list().length + 2 && csv.includes('Berhasil'))

// 7. file besar
if (BIG) {
  console.log('\n[6] File 500 MB lewat FTPS dan SFTP')
  q.clearDone()
  const huge = makeFile('besar-500mb.mov', 500)
  t0 = Date.now()
  await q.add([huge], ['ftps', 'sftp'])
  await waitFor(q, (ts) => ts.every(finished), 900_000)
  const res = q.list().filter((t) => t.filePath === huge)
  check('500 MB terkirim ke 2 akun', res.every((t) => t.status === 'done'), `${((Date.now() - t0) / 1000).toFixed(0)} dtk`)
  check('FTPS: utuh', await sameFile(huge, path.join(ftps.root, 'besar-500mb.mov')))
  check('SFTP: utuh', await sameFile(huge, path.join(sftp.root, 'besar-500mb.mov')))
}

await q.shutdown()
await ftp.srv.close()
await ftps.srv.close()
sftp.server.close()
console.log(failed ? `\n${failed} tes gagal` : '\nSemua tes lulus')
process.exit(failed ? 1 : 0)
