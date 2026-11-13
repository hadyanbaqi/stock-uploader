import { AiError, CIORA_BASE, httpError } from './ai.ts'

/**
 * Membuat gambar lewat Ciora. Ciora meneruskan ke banyak penyedia, jadi bentuk jawabannya bisa beda:
 * - model Gemini image lewat /chat/completions (gambar ada di message.images, di bagian isi, atau sebagai data URL);
 * - model lain lewat /images/generations (gaya OpenAI: data[].b64_json atau data[].url).
 * Cara yang berhasil untuk tiap model diingat supaya permintaan berikutnya langsung tepat.
 */

export type GenImage = { data: Buffer; mime: string }
export type GenRequest = {
  apiKey: string
  model: string
  prompt: string
  aspect: string
  /** Gambar referensi (data URL), opsional. */
  ref?: string
  signal?: AbortSignal
}

const IMAGE_MODEL = /image|imagen|flux|nano-?banana|dall-?e|gpt-image|seedream|ideogram|recraft|stable-?diffusion|sdxl|kolors|hidream|qwen-image|hunyuan-image|playground/i

export async function listImageModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${CIORA_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''))
  const data = (await res.json()) as { data?: { id?: string; output_modalities?: string[]; architecture?: { output_modalities?: string[] } }[] }
  const ids = (data.data ?? [])
    .filter((m) => {
      const out = m.output_modalities ?? m.architecture?.output_modalities
      return (out && out.includes('image')) || IMAGE_MODEL.test(m.id ?? '')
    })
    .map((m) => String(m.id))
  return [...new Set(ids)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** Urutan tampilan: Gemini image yang murah dulu, model "pro"/mahal di belakang. */
function rank(id: string): number {
  const s = id.toLowerCase()
  let r = 50
  if (/gemini|nano-?banana/.test(s)) r -= 30
  if (/flash|lite|mini|fast|schnell|turbo/.test(s)) r -= 10
  if (/pro|ultra|max|hd|4k/.test(s)) r += 15
  if (/free/.test(s)) r -= 5
  return r
}

type Way = 'chat' | 'images'
const remembered = new Map<string, Way>()

export async function generateImage(req: GenRequest): Promise<GenImage> {
  const first: Way = remembered.get(req.model) ?? (/gemini|nano-?banana/i.test(req.model) || req.ref ? 'chat' : 'images')
  const order: Way[] = first === 'chat' ? ['chat', 'images'] : ['images', 'chat']
  let last: unknown
  for (const way of order) {
    if (way === 'images' && req.ref) continue // /images/generations tidak menerima gambar referensi
    try {
      const img = way === 'chat' ? await viaChat(req) : await viaImages(req)
      remembered.set(req.model, way)
      return img
    } catch (err) {
      last = err
      if (err instanceof AiError && !err.retryable) throw err
      if (req.signal?.aborted) throw err
      // 404/400 "endpoint tidak didukung" atau jawaban tanpa gambar: coba cara lain.
    }
  }
  throw last instanceof Error ? last : new AiError('Model tidak mengirim gambar.', 0, true)
}

const SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '3:2': '1536x1024',
  '4:3': '1536x1024',
  '9:16': '1024x1536',
  '2:3': '1024x1536'
}

async function call(path: string, body: unknown, req: GenRequest): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 180_000)
  const onAbort = () => ctl.abort()
  req.signal?.addEventListener('abort', onAbort, { once: true })
  let res: Response
  try {
    res = await fetch(`${CIORA_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify(body),
      signal: ctl.signal
    })
  } catch (err) {
    if (req.signal?.aborted) throw new AiError('Dibatalkan.', 0, false)
    throw new AiError((err as Error).name === 'AbortError' ? 'Model tidak menjawab dalam 3 menit.' : 'Tidak bisa terhubung ke Ciora. Cek koneksi internet.', 0, true)
  } finally {
    clearTimeout(timer)
    req.signal?.removeEventListener('abort', onAbort)
  }
  const text = await res.text()
  if (!res.ok) {
    if (isRefusal(text)) throw refused()
    throw httpError(res.status, text)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new AiError('Jawaban model tidak bisa dibaca.', 0, true)
  }
}

function isRefusal(text: string): boolean {
  return /safety|content[_ ]?policy|moderation|blocked|prohibited|not allowed|inappropriate|PROHIBITED_CONTENT|IMAGE_SAFETY/i.test(text)
}

export class RefusedError extends AiError {
  refused = true
}
function refused(): RefusedError {
  return new RefusedError('Ditolak filter konten model. Ubah kata-kata prompt.', 0, false)
}

async function viaChat(req: GenRequest): Promise<GenImage> {
  const content: unknown[] = [{ type: 'text', text: `${req.prompt}\n\nAspect ratio ${req.aspect}. Generate the image.` }]
  if (req.ref) content.push({ type: 'image_url', image_url: { url: req.ref } })
  const data = await call(
    '/chat/completions',
    {
      model: req.model,
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: req.aspect },
      messages: [{ role: 'user', content }]
    },
    req
  )
  const found = await findImage(data)
  if (found) return found
  const why = JSON.stringify(data).slice(0, 4000)
  if (isRefusal(why)) throw refused()
  throw new AiError('Model tidak mengirim gambar (mungkin bukan model gambar).', 0, true)
}

async function viaImages(req: GenRequest): Promise<GenImage> {
  const data = await call(
    '/images/generations',
    { model: req.model, prompt: req.prompt, n: 1, size: SIZE[req.aspect] ?? '1024x1024', aspect_ratio: req.aspect, response_format: 'b64_json' },
    req
  )
  const found = await findImage(data)
  if (found) return found
  throw new AiError('Model tidak mengirim gambar.', 0, true)
}

/** Cari gambar di mana pun ia berada dalam jawaban JSON. */
export async function findImage(data: unknown): Promise<GenImage | null> {
  const urls: string[] = []
  const b64: { data: string; mime: string }[] = []
  const visit = (v: unknown, depth: number): void => {
    if (depth > 12 || v == null) return
    if (typeof v === 'string') {
      const m = v.match(/data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=\s]+)/)
      if (m) b64.push({ mime: m[1], data: m[2] })
      else {
        const md = v.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/)
        if (md) urls.push(md[1])
      }
      return
    }
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1))
    if (typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (typeof o.b64_json === 'string') b64.push({ data: o.b64_json, mime: 'image/png' })
    const inline = (o.inline_data ?? o.inlineData) as { data?: string; mime_type?: string; mimeType?: string } | undefined
    if (inline?.data) b64.push({ data: inline.data, mime: inline.mime_type ?? inline.mimeType ?? 'image/png' })
    if (o.type === 'image' && typeof (o.source as { data?: string })?.data === 'string') {
      const s = o.source as { data: string; media_type?: string }
      b64.push({ data: s.data, mime: s.media_type ?? 'image/png' })
    }
    if (typeof o.url === 'string' && /^https?:\/\//.test(o.url) && !/data:/.test(o.url)) urls.push(o.url)
    for (const [k, x] of Object.entries(o)) if (k !== 'b64_json') visit(x, depth + 1)
  }
  visit(data, 0)
  if (b64.length) {
    const best = b64.sort((a, b) => b.data.length - a.data.length)[0]
    return { data: Buffer.from(best.data.replace(/\s+/g, ''), 'base64'), mime: best.mime }
  }
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(60_000) })
      if (!r.ok) continue
      const mime = r.headers.get('content-type') ?? 'image/png'
      if (!mime.startsWith('image/')) continue
      return { data: Buffer.from(await r.arrayBuffer()), mime }
    } catch {
      // coba url berikutnya
    }
  }
  return null
}

export function extFor(mime: string): string {
  if (/jpe?g/.test(mime)) return 'jpg'
  if (/webp/.test(mime)) return 'webp'
  return 'png'
}
