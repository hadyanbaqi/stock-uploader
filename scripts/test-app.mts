/**
 * Tes aplikasi sungguhan (Electron): 10 video ke 3 akun (FTP, FTPS, SFTP lokal) tanpa campur tangan.
 * Jalankan setelah `npm run build`: node scripts/test-app.mts
 * APP=<path aplikasi terpasang> untuk menguji hasil installer, bukan hasil build.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
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
// AI tiruan (pengganti Ciora) supaya tes tidak memakai kredit.
const aiCalls: { model: string; images: number; bytes: number; text: string }[] = []
const ai = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const j = JSON.parse(body || '{}')
    const parts = j.messages?.[1]?.content ?? []
    const imgs = parts.filter((c: { type: string }) => c.type === 'image_url')
    const text = parts.filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join(' ')
    aiCalls.push({ model: j.model, images: imgs.length, bytes: imgs.reduce((s: number, c: { image_url: { url: string } }) => s + c.image_url.url.length, 0), text })
    const isVideo = text.includes('video')
    const answer = {
      title: isVideo ? 'Colorful animated background with moving white circle' : 'Blue gradient abstract background',
      description: 'Smooth color transition for design projects.',
      keywords: ['background', 'abstract', 'blue', 'gradient', 'color', 'smooth', 'design', 'wallpaper', 'texture', 'bright', 'modern', 'pattern'],
      adobeCategory: 8,
      shutterstockCategories: ['Backgrounds/Textures'],
      isAiGenerated: false
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }))
  })
})
await new Promise<void>((r) => ai.listen(0, '127.0.0.1', () => r()))
const metaDir = path.join(work, 'meta')
mkdirSync(metaDir)

const out = path.join(work, 'hasil.json')
const config = path.join(work, 'e2e.json')
writeFileSync(config, JSON.stringify({
  accounts: [acc('Server Uji - FTP', 'ftp', 2141, '#2563eb'), acc('Server Uji - FTPS', 'ftps', 2341, '#16a34a'), acc('Server Uji - SFTP', 'sftp', 2242, '#9333ea')],
  files: videos,
  folder,
  out,
  shots,
  metaDir
}))

const bin = process.env.APP ?? (require('electron') as string)
const args = process.env.APP ? [] : ['.']
const t0 = Date.now()
const code = await new Promise<number>((resolve) => {
  const child = spawn(bin, args, {
    stdio: 'inherit',
    env: { ...process.env, SU_E2E: config, SU_AI_BASE: `http://127.0.0.1:${(ai.address() as { port: number }).port}/v1`, SU_USERDATA: path.join(work, 'data'), ELECTRON_RENDERER_URL: '' }
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
const r = JSON.parse(readFileSync(out, 'utf8')) as { expanded?: { files: number; skipped: number }; added?: { added: number }; readd?: { added: number; alreadySent: number }; history?: number; tasks?: QueueTask[]; error?: string }
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
check('riwayat mencatat 30 upload', r.history === 30, String(r.history))
check('upload ulang file yang sama dilewati', r.readd?.added === 0 && r.readd?.alreadySent === 30, JSON.stringify(r.readd))
console.log(`\nTangkapan layar: ${shots}`)

// Metadata
type MetaOut = {
  videoMade: string | false
  generate: { queued: number }
  records: { name: string; status: string; title: string; keywords: number; tech?: string; error?: string; thumb: boolean }[]
  inject: { saved: number; csvOnly: number; failed: number }
  readBack: { title?: string; keywords: string[] }
  csv: { files: string[]; rows: number }
}
const mo = (r as unknown as { meta?: MetaOut }).meta
if (!mo) check('alur metadata berjalan', false)
else {
  const rec = (n: string) => mo.records.find((x) => x.name === n)
  const jpg = rec('gradasi-biru.jpg')
  const svg = rec('ikon-daun.svg')
  const vid = rec('klip-warna.mp4')
  check('JPG: metadata dibuat AI', jpg?.status === 'ready' && jpg.keywords >= 7 && jpg.thumb, JSON.stringify(jpg))
  check('SVG: dibaca dan dibuatkan metadata', svg?.status === 'ready' && svg.thumb, JSON.stringify(svg))
  check('video uji berhasil dibuat', mo.videoMade)
  if (mo.videoMade) {
    check('video: frame terbaca jadi lembar kontak', vid?.status === 'ready' && Boolean(vid.tech?.includes('contact sheet')), JSON.stringify(vid))
    const vc = aiCalls.find((c) => c.text.includes('klip-warna'))
    check('video: AI menerima 1 lembar kontak + data teknis', vc?.images === 1 && (vc?.bytes ?? 0) > 5000 && /\d+\.\d seconds/.test(vc?.text ?? ''), vc ? `${vc.images} gambar, ${vc.bytes} byte, "${vc.text.slice(0, 120)}"` : 'tidak ada')
  }
  check('API key terkirim ke model Hemat', aiCalls.every((c) => c.model === 'go/gemini-3.1-flash-lite'), aiCalls.map((c) => c.model).join(','))
  const errs = (mo as unknown as { injectErrors: string[] }).injectErrors
  // Perekam Chromium membuat MP4 terfragmen; ExifTool tidak bisa menulisinya, jadi yang dicek adalah pesannya.
  const fragmented = errs.some((e) => e.includes('terfragmen'))
  const realMp4 = String(mo.videoMade).startsWith('video/mp4') && !fragmented
  console.log(`      (video uji dibuat sebagai ${mo.videoMade})`)
  check(realMp4 ? 'tanam ke file: JPG + MP4 tertanam, SVG hanya CSV' : 'tanam ke file: JPG tertanam, SVG hanya CSV (video uji bukan MP4 asli)', mo.inject.saved === (realMp4 ? 2 : 1) && mo.inject.csvOnly === 1 && mo.inject.failed === (realMp4 ? 0 : 1) && (realMp4 || errs.length === 1), JSON.stringify(mo.inject) + ' ' + JSON.stringify((mo as unknown as { injectErrors: string[] }).injectErrors))
  check('JPG: metadata terbaca kembali dari file', mo.readBack.title === 'Blue gradient abstract background' && mo.readBack.keywords.length >= 7, JSON.stringify(mo.readBack))
  const adobeCsv = mo.csv.files.find((f) => f.includes('adobe'))
  check('CSV Adobe + Shutterstock tersimpan', mo.csv.files.length === 2 && Boolean(adobeCsv) && readFileSync(adobeCsv!, 'utf8').split(String.fromCharCode(13, 10))[0] === 'Filename,Title,Keywords,Category,Releases', mo.csv.files.map((f) => path.basename(f)).join(', '))
}
ai.close()
const rb = r as unknown as { backup?: { accounts: number; hasSecret: boolean }; reimport?: { added: number; skipped: number } }
check('ekspor akun tanpa password', rb.backup?.accounts === 3 && rb.backup.hasSecret === false, JSON.stringify(rb.backup))
check('impor ulang: nama yang sudah ada dilewati', rb.reimport?.added === 0 && rb.reimport?.skipped === 3, JSON.stringify(rb.reimport))

await ftp.srv.close()
await ftps.srv.close()
sftp.server.close()
console.log(failed ? `\n${failed} tes gagal` : '\nSemua tes lulus')
process.exit(failed ? 1 : 0)
