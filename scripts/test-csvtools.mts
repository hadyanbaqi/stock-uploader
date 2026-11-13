/**
 * Tes fitur alur kerja: baca/tulis CSV, impor metadata dari CSV, kenali folder agensi,
 * tandai "sudah" di metadata-master.csv, dan pindahkan file setelah upload.
 * Jalankan: node scripts/test-csvtools.mts
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agencyFromPath } from '../src/shared/agencyFolder.ts'
import { formatCsv, parseCsv } from '../src/main/csvtable.ts'
import { lookupCsv, metaFromTable } from '../src/main/csvimport.ts'
import { AfterUpload, doneTarget, findMaster, markMaster } from '../src/main/afterupload.ts'
import type { QueueTask } from '../src/shared/types.ts'

let failed = 0
function check(name: string, ok: boolean, info = '') {
  if (!ok) failed++
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${info ? `  → ${info}` : ''}`)
}

// ---------- 1. CSV ----------
console.log('[1] Baca dan tulis CSV')
const src = 'Filename,Title,Keywords\r\na.jpg,Gold stars,"gold, stars, ""shiny"""\r\nb.jpg,"Line\nbreak",x\r\n'
const t = parseCsv(src)
check('kolom berkutip dan koma di dalam kutip', t.rows[1][2] === 'gold, stars, "shiny"', JSON.stringify(t.rows[1]))
check('baris baru di dalam kutip tidak memotong baris', t.rows.length === 3 && t.rows[2][1] === 'Line\nbreak', JSON.stringify(t.rows[2]))
const src2 = 'Filename,Title,Keywords\r\na.jpg,Gold stars,"gold, stars"\r\n'
check('tulis ulang sama persis dengan aslinya', formatCsv(parseCsv(src2)) === src2)
const semi = parseCsv('Filename;Title;Keywords\na.jpg;T;"x, y"\n')
check('CSV titik koma (Freepik) dikenali', semi.sep === ';' && semi.rows[1][2] === 'x, y')
const bom = parseCsv('\ufeffFilename,Title\na.jpg,T\n')
check('BOM dibaca dan dipertahankan', bom.rows[0][0] === 'Filename' && formatCsv(bom).startsWith('\ufeff'))

// ---------- 2. Metadata dari CSV ----------
console.log('[2] Metadata dari CSV')
const adobe = metaFromTable(parseCsv('Filename,Title,Keywords,Category,Releases\nA.JPG,Gold stars on black,"Gold, stars, gold, black",8,\n'))
const a = adobe.get('a.jpg')
check('Adobe: judul, keyword (huruf kecil, tanpa dobel), kategori', a?.title === 'Gold stars on black' && a?.keywords?.join('|') === 'gold|stars|black' && a?.adobeCategory === 8, JSON.stringify(a))
const ss = metaFromTable(parseCsv('Filename,Description,Keywords,Categories,Illustration\na.jpg,Long description here,"x,y","Holidays,backgrounds/textures,Nope",No\n'))
check('Shutterstock: deskripsi + kategori divalidasi', ss.get('a.jpg')?.description === 'Long description here' && ss.get('a.jpg')?.ssCategories?.join('|') === 'Holidays|Backgrounds/Textures', JSON.stringify(ss.get('a.jpg')))

const root = mkdtempSync(path.join(tmpdir(), 'su-csv-'))
const kerja = path.join(root, 'Microstok', '_FILE-KERJA')
const adobeDir = path.join(root, 'Microstok', 'ADOBE-STOCK', '14')
const ssDir = path.join(root, 'Microstok', 'SHUTTERSTOCK', '1')
mkdirSync(kerja, { recursive: true })
mkdirSync(adobeDir, { recursive: true })
mkdirSync(ssDir, { recursive: true })
const masterText =
  'Filename,Title,Keywords,AdobeCategory,Adobe,Shutterstock,Vecteezy,iStock,Alamy\r\n' +
  'a.jpg,Master title,"m1, m2",8,belum,belum,-,belum,belum\r\n' +
  'b.jpg,Other,"o1, o2",3,belum,sudah,belum,-,-\r\n'
writeFileSync(path.join(kerja, 'metadata-master.csv'), masterText)
writeFileSync(path.join(root, 'Microstok', 'SHUTTERSTOCK', 'shutterstock.csv'), 'Filename,Description,Keywords,Categories\r\na.jpg,Shutter description,"s1,s2",Holidays\r\n')
writeFileSync(path.join(root, 'Microstok', 'SHUTTERSTOCK', 'old.csv.bak-13nov'), 'Filename,Title\r\na.jpg,JANGAN\r\n')
const fa = path.join(adobeDir, 'a.jpg')
const fs1 = path.join(ssDir, 'a.jpg')
const fz = path.join(adobeDir, 'zzz.jpg')
for (const f of [fa, fs1, fz]) writeFileSync(f, 'x')
const found = await lookupCsv([fa, fs1, fz])
check('file di ADOBE-STOCK/14 menemukan master di _FILE-KERJA', found.get(fa)?.meta.title === 'Master title', JSON.stringify(found.get(fa)))
const s1 = found.get(fs1)
check(
  'master + shutterstock.csv digabung (judul master, deskripsi + kategori Shutterstock)',
  s1?.meta.title === 'Master title' && s1?.meta.description === 'Shutter description' && s1?.meta.ssCategories?.[0] === 'Holidays' && s1.meta.keywords?.join() === 'm1,m2',
  JSON.stringify(s1)
)
check('file yang tidak ada di CSV tidak diisi', !found.has(fz))
const picked = await lookupCsv([fa], [path.join(root, 'Microstok', 'SHUTTERSTOCK', 'shutterstock.csv')])
check('CSV pilihan sendiri dipakai apa adanya', picked.get(fa)?.meta.description === 'Shutter description' && !picked.get(fa)?.meta.title)

// ---------- 3. Folder agensi ----------
console.log('[3] Folder agensi')
check('Mac: ADOBE-STOCK', agencyFromPath('/Users/x/Microstok/ADOBE-STOCK/14/a.jpg')?.agency === 'adobe')
check('Windows: "file video\\SHUTTERSTOCK"', agencyFromPath('C:\\Microstok\\file video\\SHUTTERSTOCK\\v.mp4')?.agency === 'shutterstock')
check('folder terdalam yang dipakai', agencyFromPath('/a/VECTEEZY/backup/ADOBE STOCK/x.jpg')?.agency === 'adobe')
check('nama file tidak dihitung sebagai folder', agencyFromPath('/a/b/vecteezy.jpg') === null)
check('"adobe-research" bukan folder agensi', agencyFromPath('/home/adobe-research/x.jpg') === null)
check(
  'tujuan _sudah-upload di sebelah folder agensi',
  doneTarget('/U/Microstok/ADOBE-STOCK/14/a.jpg') === '/U/Microstok/_sudah-upload/ADOBE-STOCK/14/a.jpg',
  doneTarget('/U/Microstok/ADOBE-STOCK/14/a.jpg')
)
check('tanpa folder agensi: _sudah-upload di folder file', doneTarget('/U/x/a.jpg') === '/U/x/_sudah-upload/a.jpg')

// ---------- 4. Tandai master ----------
console.log('[4] metadata-master.csv')
const master = await findMaster(fa)
check('metadata-master.csv ditemukan dari folder agensi', master === path.join(kerja, 'metadata-master.csv'), String(master))
const n = await markMaster(master!, [
  { name: 'a.jpg', agency: 'adobe' },
  { name: 'A.JPG', agency: 'shutterstock' },
  { name: 'a.jpg', agency: 'vecteezy' },
  { name: 'b.jpg', agency: 'shutterstock' },
  { name: 'nope.jpg', agency: 'adobe' }
])
const after = readFileSync(master!, 'utf8')
check('hanya "belum" yang diubah; "-" dan "sudah" tetap', n === 2, String(n))
check(
  'isi lain tidak berubah (kutip, CRLF, urutan kolom)',
  after === masterText.replace('8,belum,belum,-', '8,sudah,sudah,-'),
  JSON.stringify(after)
)

// ---------- 5. Setelah upload ----------
console.log('[5] Setelah upload')
const fb = path.join(adobeDir, 'b.jpg')
writeFileSync(fb, 'x')
const task = (p: string, status: QueueTask['status'], acc = 'acc1'): QueueTask => ({
  id: `${p}|${acc}`, filePath: p, fileName: path.basename(p), size: 1, accountId: acc, accountName: acc, accountColor: '#000',
  status, sent: 1, speed: 0, attempt: 1, maxAttempts: 4, addedAt: 0
})
let tasks: QueueTask[] = [task(fa, 'done'), task(fb, 'done'), task(fb, 'uploading', 'acc2')]
const notes: string[] = []
const au = new AfterUpload({
  settings: async () => ({ markMaster: true, afterDone: 'move' }),
  tasks: () => tasks,
  trash: async () => {},
  notify: (x) => notes.push(x),
  delayMs: 10
})
au.finished(tasks[0], 'adobe')
au.finished(tasks[1], 'adobe')
await au.flush()
const movedA = path.join(root, 'Microstok', '_sudah-upload', 'ADOBE-STOCK', '14', 'a.jpg')
check('file yang semua uploadnya selesai dipindah', existsSync(movedA) && !existsSync(fa))
check('file yang masih diupload ke akun lain tidak dipindah', existsSync(fb))
check('master: b.jpg Adobe jadi "sudah"', readFileSync(master!, 'utf8').includes('b.jpg,Other,"o1, o2",3,sudah'))
tasks = [task(fb, 'done'), task(fb, 'failed', 'acc2')]
au.finished(tasks[1], 'vecteezy')
await au.flush()
check('ada upload yang gagal: file dibiarkan', existsSync(fb))
check('pesan hasil dikirim ke tampilan', notes.some((x) => x.includes('dipindah')), notes.join(' | '))

console.log(failed ? `\n${failed} tes GAGAL` : '\nSemua tes lulus')
process.exit(failed ? 1 : 0)
