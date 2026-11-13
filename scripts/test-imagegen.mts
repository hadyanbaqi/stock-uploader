/**
 * Tes Buat Gambar: klien Ciora (server tiruan di localhost dengan beberapa bentuk jawaban),
 * nama file dari prompt, template, dan penulis ZIP.
 * Jalankan: node scripts/test-imagegen.mts
 */
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let failed = 0
function check(name: string, ok: boolean, info = '') {
  if (!ok) failed++
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${info ? `  → ${info}` : ''}`)
}

// PNG 1×1 merah.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
const B64 = PNG.toString('base64')
const seen: { path: string; model: string; hasModalities: boolean; hasRef: boolean }[] = []

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const send = (code: number, obj: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    // Gambar hasil (URL publik) tidak butuh key.
    if (req.method === 'GET' && req.url === '/img.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(PNG)
    }
    if (req.headers.authorization !== 'Bearer kunci-benar') return send(401, { error: 'invalid key' })
    if (req.method === 'GET' && req.url === '/v1/models') {
      return send(200, {
        data: [
          { id: 'gpt-4o-mini' },
          { id: 'go/gemini-3.1-pro-image' },
          { id: 'go/gemini-3.1-flash-image' },
          { id: 'flux-schnell' },
          { id: 'text-embedding-3' },
          { id: 'some-model', output_modalities: ['image'] }
        ]
      })
    }
    const j = JSON.parse(body || '{}')
    const hasRef = JSON.stringify(j).includes('data:image/png;base64,REF')
    seen.push({ path: req.url ?? '', model: j.model, hasModalities: Array.isArray(j.modalities), hasRef })
    const port = (server.address() as { port: number }).port
    if (req.url === '/v1/chat/completions') {
      if (j.model === 'chat-images') return send(200, { choices: [{ message: { content: 'ok', images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${B64}` } }] } }] })
      if (j.model === 'chat-inline') return send(200, { choices: [{ message: { content: [{ type: 'text', text: 'here' }, { inline_data: { mime_type: 'image/png', data: B64 } }] } }] })
      if (j.model === 'chat-markdown') return send(200, { choices: [{ message: { content: `![img](http://127.0.0.1:${port}/img.png)` } }] })
      if (j.model === 'chat-refused') return send(400, { error: { message: 'Request blocked by safety system: IMAGE_SAFETY' } })
      if (j.model === 'chat-busy') return send(429, { error: 'rate limited' })
      if (j.model === 'only-images') return send(404, { error: 'not a chat model' })
      return send(200, { choices: [{ message: { content: 'I cannot draw.' } }] })
    }
    if (req.url === '/v1/images/generations') {
      if (j.model === 'only-images') return send(200, { data: [{ b64_json: B64 }] })
      if (j.model === 'images-url') return send(200, { data: [{ url: `http://127.0.0.1:${port}/img.png` }] })
      return send(404, { error: 'unknown model' })
    }
    send(404, {})
  })
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
process.env.SU_AI_BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`

const { listImageModels, generateImage, RefusedError } = await import('../src/main/imagegen.ts')
const { AiError } = await import('../src/main/ai.ts')
const { buildPrompt, fileBase } = await import('../src/shared/genTemplates.ts')
const { writeZip, crc32 } = await import('../src/main/zip.ts')

console.log('[1] Daftar model')
const models = await listImageModels('kunci-benar')
check('hanya model gambar', !models.includes('gpt-4o-mini') && !models.includes('text-embedding-3') && models.includes('some-model'), models.join(', '))
check('Gemini flash image paling atas, versi pro di belakangnya', models[0] === 'go/gemini-3.1-flash-image' && models.indexOf('go/gemini-3.1-pro-image') > 0, models.join(', '))
try {
  await listImageModels('kunci-salah')
  check('key salah ditolak', false)
} catch (err) {
  check('key salah ditolak dengan pesan jelas', String((err as Error).message).includes('API key'), (err as Error).message)
}

console.log('[2] Bentuk jawaban')
const base = { apiKey: 'kunci-benar', prompt: 'red dot', aspect: '3:2' }
const same = (b: Buffer) => b.equals(PNG)
for (const model of ['chat-images', 'chat-inline', 'chat-markdown', 'only-images', 'images-url']) {
  try {
    const r = await generateImage({ ...base, model })
    check(`${model}: gambar terbaca`, same(r.data) && r.mime === 'image/png', `${r.data.length} byte ${r.mime}`)
  } catch (err) {
    check(`${model}: gambar terbaca`, false, (err as Error).message)
  }
}
seen.length = 0
await generateImage({ ...base, model: 'only-images' })
check('cara yang berhasil diingat (langsung /images/generations)', seen.length === 1 && seen[0].path === '/v1/images/generations', JSON.stringify(seen))

seen.length = 0
await generateImage({ ...base, model: 'chat-images', ref: 'data:image/png;base64,REF' })
check('gambar referensi dikirim lewat chat', seen[0]?.hasRef === true && seen[0]?.hasModalities === true)

try {
  await generateImage({ ...base, model: 'chat-refused' })
  check('ditolak filter konten', false)
} catch (err) {
  check('ditolak filter konten → RefusedError, tidak dicoba ulang', err instanceof RefusedError && !(err as InstanceType<typeof AiError>).retryable, (err as Error).message)
}
try {
  await generateImage({ ...base, model: 'chat-busy' })
  check('penuh', false)
} catch (err) {
  check('model penuh (429) → boleh dicoba ulang', err instanceof AiError && (err as InstanceType<typeof AiError>).retryable, (err as Error).message)
}
try {
  await generateImage({ ...base, model: 'text-only' })
  check('model teks', false)
} catch (err) {
  check('model tanpa gambar → pesan jelas', /tidak mengirim gambar/i.test((err as Error).message), (err as Error).message)
}

console.log('[3] Prompt dan nama file')
const p = buildPrompt('  Golden   autumn forest ', 'photo')
check('template ditempel + larangan teks/watermark', p.startsWith('Golden autumn forest Photorealistic') && p.includes('no watermark'), p)
const names = ['Golden autumn forest with soft morning fog over a quiet lake', 'A', '!!!', 'Minimal flat lay of coffee beans on beige background'].map((x, i) => fileBase(x, i + 1))
check('nama file ≤30 karakter dengan .jpg', names.every((n) => `${n}.jpg`.length <= 30), names.join(' | '))
check('kata sambung dibuang, huruf kecil + tanda hubung', names[0].startsWith('golden-autumn-forest'), names[0])
check('prompt tanpa huruf tetap punya nama', names[2] === 'gambar-3', names[2])
check('nomor 3 digit tetap ≤30', `${fileBase('Golden autumn forest with soft morning fog', 120)}.jpg`.length <= 30)

console.log('[4] ZIP')
const dir = mkdtempSync(path.join(tmpdir(), 'su-zip-'))
const a = path.join(dir, 'a.jpg')
const b = path.join(dir, 'sub', 'a.jpg')
writeFileSync(a, 'isi pertama')
await import('node:fs').then((fs) => fs.mkdirSync(path.join(dir, 'sub')))
writeFileSync(b, Buffer.alloc(5000, 7))
const zipPath = path.join(dir, 'hasil.zip')
const r = await writeZip(zipPath, [a, b])
const z = readFileSync(zipPath)
const eocd = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
const entries = z.readUInt16LE(eocd + 10)
const cdOffset = z.readUInt32LE(eocd + 16)
const names2: string[] = []
let off = cdOffset
let crcOk = true
for (let i = 0; i < entries; i++) {
  const nameLen = z.readUInt16LE(off + 28)
  const crc = z.readUInt32LE(off + 16)
  const size = z.readUInt32LE(off + 20)
  const local = z.readUInt32LE(off + 42)
  names2.push(z.subarray(off + 46, off + 46 + nameLen).toString())
  const lnameLen = z.readUInt16LE(local + 26)
  const data = z.subarray(local + 30 + lnameLen, local + 30 + lnameLen + size)
  if (crc32(data) !== crc) crcOk = false
  off += 46 + nameLen
}
check('2 file di dalam ZIP', r.count === 2 && entries === 2)
check('nama dobel diberi akhiran', names2.join(',') === 'a.jpg,a-2.jpg', names2.join(','))
check('CRC isi cocok', crcOk)
check('crc32 benar ("123456789" = cbf43926)', crc32(Buffer.from('123456789')).toString(16) === 'cbf43926')

server.close()
console.log(failed ? `\n${failed} tes GAGAL` : '\nSemua tes lulus')
process.exit(failed ? 1 : 0)
