/**
 * Tes metadata: aturan SEO, CSV per agensi, panggilan AI (server Ciora tiruan di localhost),
 * dan penanaman metadata ke JPEG/PNG dengan ExifTool.
 * Jalankan: node scripts/test-metadata.mts
 */
import { createServer } from 'node:http'
import { crc32, deflateSync } from 'node:zlib'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cleanMeta } from '../src/shared/metadata.ts'
import { buildCsv } from '../src/main/csv.ts'

let failed = 0
function check(name: string, ok: boolean, info = '') {
  if (!ok) failed++
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${info ? `  → ${info}` : ''}`)
}

// ---------- 1. aturan SEO ----------
console.log('[1] Aturan SEO')
const longTitle = 'Abstract blue gradient waves flowing smoothly across a dark background with glowing particles and soft light'
const m = cleanMeta({
  title: `"${longTitle}"`,
  description: 'x'.repeat(260),
  keywords: ['Waves', 'waves', 'nike', 'iphone screen', 'Blue', 'abstract background design pattern', 'glow', 'apple', ...Array.from({ length: 60 }, (_, i) => `kata${i}`)],
  adobeCategory: 8,
  shutterstockCategories: ['abstract', 'Backgrounds/Textures', 'Celebrities'],
  isAiGenerated: false
})
check('judul maksimal 70 karakter, tanpa tanda kutip', m.title.length <= 70 && !m.title.startsWith('"'), `${m.title.length}: ${m.title}`)
check('deskripsi maksimal 200 karakter', m.description.length <= 201, String(m.description.length))
check('keyword huruf kecil, tanpa dobel', m.keywords.filter((k) => k === 'waves').length === 1 && !m.keywords.includes('Blue'))
check('nama merek dibuang, kata umum tetap', !m.keywords.includes('nike') && !m.keywords.some((k) => k.includes('iphone')) && m.keywords.includes('apple'))
check('frasa panjang (lebih dari 3 kata) dibuang', !m.keywords.includes('abstract background design pattern'))
check('maksimal 49 keyword', m.keywords.length === 49, String(m.keywords.length))
const top10 = m.keywords.slice(0, 10)
check('kata penting judul ada di 10 keyword pertama', ['abstract', 'blue', 'gradient', 'waves'].every((w) => top10.includes(w)), top10.join(', '))
check('kategori Shutterstock divalidasi (maks 2)', m.ssCategories.join('|') === 'Abstract|Backgrounds/Textures', m.ssCategories.join('|'))
const m2 = cleanMeta({ title: 'Cat', keywords: 'cat, pet; animal\ncute', category: 99 }, { adobeCategory: 1, aiGenerated: true, notes: 'n' })
check('keyword dari teks dipisah koma/titik koma/baris', m2.keywords.includes('pet') && m2.keywords.includes('cute'))
check('kategori salah memakai nilai lama, tanda AI dipertahankan', m2.adobeCategory === 1 && m2.aiGenerated && m2.notes === 'n')

// ---------- 2. CSV ----------
console.log('\n[2] CSV per agensi')
const item = { name: 'gelombang, biru.mp4', ext: 'mp4', meta: { ...m, title: 'Blue "neon" waves loop', description: 'Seamless loop of blue waves.' } }
const adobe = buildCsv('adobe', [item]).split('\r\n')
check('Adobe: header resmi', adobe[0] === 'Filename,Title,Keywords,Category,Releases', adobe[0])
check('Adobe: koma dan tanda kutip di-escape', adobe[1].startsWith('"gelombang, biru.mp4","Blue ""neon"" waves loop","'), adobe[1].slice(0, 60))
const ss = buildCsv('shutterstock', [item]).split('\r\n')
check('Shutterstock: header resmi', ss[0] === 'Filename,Description,Keywords,Categories,Illustration,Mature Content,Editorial', ss[0])
check('Shutterstock: video bukan ilustrasi', ss[1].endsWith(',no,no,no'), ss[1].slice(-20))
const fp = buildCsv('freepik', [item]).split('\r\n')
check('Freepik: pemisah titik koma', fp[0] === 'Filename;Title;Keywords;Prompt;Model', fp[0])
for (const a of ['vecteezy', 'pond5', 'dreamstime', '123rf']) check(`${a}: CSV dibuat`, buildCsv(a, [item]).split('\r\n').length === 3)

// ---------- 3. AI (server tiruan) ----------
console.log('\n[3] Panggilan AI ke server tiruan')
const calls: { model: string; hasFormat: boolean; auth: string; images: number }[] = []
let scenario = 'ok'
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const j = JSON.parse(body || '{}')
    const images = (j.messages?.[1]?.content ?? []).filter((c: { type: string }) => c.type === 'image_url').length
    calls.push({ model: j.model, hasFormat: Boolean(j.response_format), auth: String(req.headers.authorization), images })
    const reply = (status: number, obj: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    const answer = { title: 'Blue waves loop', description: 'Smooth blue waves.', keywords: ['blue', 'waves', 'loop', 'abstract', 'background', 'motion', 'gradient', 'smooth'], adobeCategory: 8, shutterstockCategories: ['Abstract'], isAiGenerated: false }
    const ok = (text: string) => reply(200, { choices: [{ message: { content: text } }], usage: { total_tokens: 900 } })
    if (scenario === 'ok') return ok(JSON.stringify(answer))
    if (scenario === 'fenced') return ok('Here you go:\n```json\n' + JSON.stringify(answer) + '\n```')
    if (scenario === 'busy') return calls.length === 1 ? reply(429, { error: 'rate limit' }) : ok(JSON.stringify(answer))
    if (scenario === 'nojson') return j.response_format ? reply(400, { error: { message: 'response_format json_object not supported' } }) : ok(JSON.stringify(answer))
    if (scenario === 'badkey') return reply(401, { error: 'invalid api key' })
    if (scenario === 'broke') return reply(402, { error: 'insufficient balance' })
  })
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
process.env.SU_AI_BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
const { generateMeta } = await import('../src/main/ai.ts')
const KEY = 'kunci-uji-palsu'
const img = 'data:image/jpeg;base64,AAAA'
const base = { apiKey: KEY, images: [img], fileName: 'a.mp4', tech: 'video 1920x1080', notes: '' }

calls.length = 0
scenario = 'ok'
let r = await generateMeta({ ...base, mode: 'hemat' })
check('Hemat: model go/gemini-3.1-flash-lite, 1 gambar, API key terkirim', calls[0].model === 'go/gemini-3.1-flash-lite' && calls[0].images === 1 && calls[0].auth === `Bearer ${KEY}`)
check('hasil dirapikan', r.meta.title === 'Blue waves loop' && r.meta.keywords.length === 8 && r.tokens === 900)

calls.length = 0
scenario = 'fenced'
r = await generateMeta({ ...base, mode: 'hemat' })
check('jawaban dalam ```json``` tetap terbaca', r.meta.title === 'Blue waves loop')

calls.length = 0
scenario = 'busy'
r = await generateMeta({ ...base, mode: 'gratis' })
check('Gratis penuh → otomatis pindah ke model Hemat', calls[0].model === 'nvidia/nemotron-3.5-super-vl-free' && r.model === 'go/gemini-3.1-flash-lite', calls.map((c) => c.model).join(' → '))

calls.length = 0
scenario = 'nojson'
r = await generateMeta({ ...base, mode: 'hemat' })
check('model tanpa JSON mode: kirim ulang tanpa response_format', calls.length === 2 && calls[0].hasFormat && !calls[1].hasFormat && r.meta.title !== '')

calls.length = 0
scenario = 'ok'
r = await generateMeta({ ...base, mode: 'detail', images: [img, img, img], labels: ['Frame at 0.5s:', 'Frame at 1.5s:', 'Frame at 2.5s:'] })
check('Detail: beberapa frame terkirim ke model Detail', calls[0].model === 'google/gemini-3.1-flash-lite' && calls[0].images === 3)

for (const [sc, want] of [['badkey', 'API key'], ['broke', 'Saldo']] as const) {
  calls.length = 0
  scenario = sc
  const e = await generateMeta({ ...base, mode: 'hemat' }).then(() => null, (err: Error) => err)
  check(`${sc}: pesan jelas, tidak mencoba model lain`, Boolean(e?.message.includes(want)) && calls.length === 1, e?.message)
}
server.close()

// ---------- 4. Tanam metadata ----------
console.log('\n[4] Tanam metadata dengan ExifTool')
const { injectMeta, readMeta, closeExifTool } = await import('../src/main/inject.ts')
const dir = mkdtempSync(path.join(tmpdir(), 'su-meta-'))
const JPG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
// PNG 2x2 yang valid, dibuat langsung (tanpa pustaka gambar).
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td) >>> 0)
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(2, 0)
ihdr.writeUInt32BE(2, 4)
ihdr[8] = 8
ihdr[9] = 2
const raw = Buffer.from([0, 255, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 255])
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
const meta = { ...m, title: 'Ombak biru — blue waves', description: 'Café sunset with ümlauts', keywords: ['blue', 'waves', 'sunset', 'café'] }
for (const [name, b64] of [['foto.jpg', JPG], ['gambar.png', PNG]] as const) {
  const f = path.join(dir, name)
  writeFileSync(f, Buffer.from(b64, 'base64'))
  try {
    await injectMeta(f, meta, path.join(dir, 'cadangan'))
    const back = await readMeta(f)
    check(`${name}: judul, deskripsi, keyword tertanam (termasuk huruf non-ASCII)`, back.title === meta.title && back.description === meta.description && back.keywords.join('|') === meta.keywords.join('|'), JSON.stringify(back))
    check(`${name}: file asli dicadangkan`, existsSync(path.join(dir, 'cadangan', name)))
  } catch (err) {
    check(`${name}: tanam metadata`, false, String(err))
  }
}
const svg = path.join(dir, 'ikon.svg')
writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"/>')
const e = await injectMeta(svg, meta, path.join(dir, 'cadangan')).then(() => null, (err: Error) => err)
check('SVG ditolak dengan pesan "pakai CSV"', Boolean(e?.message.includes('CSV')))
await closeExifTool()

console.log(failed ? `\n${failed} tes gagal` : '\nSemua tes lulus')
process.exit(failed ? 1 : 0)
