import { AI_MODES, ADOBE_CATEGORIES, SHUTTERSTOCK_CATEGORIES, cleanMeta, type AiMode, type FileMeta } from '../shared/metadata.ts'

export const CIORA_BASE = process.env.SU_AI_BASE || 'https://ciora.id/v1'

export const SYSTEM_PROMPT = `You are a senior microstock metadata specialist for Adobe Stock, Shutterstock, Pond5, Vecteezy, Freepik, Dreamstime and 123RF. You think like a buyer (designer, video editor, marketer) searching for this file: "what words would they type to find it?"

Look at the image, or the video frames in order (a contact sheet reads left to right, top to bottom = start to end of the clip). Describe only what is visible. Use the technical data and the creator's notes when they are given; never invent technical facts.

Return ONLY a JSON object:
{"title": string, "description": string, "keywords": string[], "adobeCategory": number, "shutterstockCategories": string[], "isAiGenerated": boolean}

TITLE: max 70 characters, natural English phrase, main subject first, then action/motion, style, setting. No keyword stuffing, no brand names, no file words like "stock" or "image".
DESCRIPTION: one sentence, max 200 characters, adds useful detail that is not in the title (mood, use case, motion, color).
KEYWORDS: 30 to 45 English keywords, lowercase, one concept each ("white", "puppy", not "white fluffy puppy"; established terms like "copy space" or "motion graphics" are fine). Order by importance: the first 10 are the most important and must include the main words of the title. Then: main subject, action, setting, style/technique, colors, mood, concept, use case (e.g. "background", "copy space", "loop", "4k" only if true). No brands, logos, trademarks, celebrity or character names, no wrong place names, no words for things that are not visible, no duplicates or plural/singular repeats.
ADOBE CATEGORY: one number: ${Object.entries(ADOBE_CATEGORIES)
  .map(([n, name]) => `${n} ${name}`)
  .join(', ')}.
SHUTTERSTOCK CATEGORIES: one or two from: ${SHUTTERSTOCK_CATEGORIES.join(', ')}.
isAiGenerated: true only if the creator's notes say it was made with generative AI.`

export type AiInput = {
  apiKey: string
  mode: AiMode
  /** Gambar (data URL JPEG). Untuk video: 1 lembar kontak, atau beberapa frame di mode Detail. */
  images: string[]
  /** Label tiap gambar, mis. "frame at 3.0s". */
  labels?: string[]
  fileName: string
  tech: string
  notes: string
  prev?: Partial<FileMeta>
  signal?: AbortSignal
}

export type AiResult = { meta: FileMeta; model: string; tokens?: number }

export class AiError extends Error {
  status: number
  /** Ganti model / coba lagi masih masuk akal. */
  retryable: boolean
  constructor(message: string, status = 0, retryable = false) {
    super(message)
    this.status = status
    this.retryable = retryable
  }
}

/** Minta metadata ke Ciora; kalau model utama gagal/penuh, otomatis pakai model cadangan. */
export async function generateMeta(input: AiInput): Promise<AiResult> {
  const mode = AI_MODES[input.mode] ?? AI_MODES.hemat
  const models = [mode.model, ...mode.fallback]
  let last: unknown
  for (const model of models) {
    try {
      return await callModel(model, input)
    } catch (err) {
      last = err
      if (err instanceof AiError && !err.retryable) throw err
      if (input.signal?.aborted) throw err
    }
  }
  throw last
}

async function callModel(model: string, input: AiInput): Promise<AiResult> {
  const content: unknown[] = [
    {
      type: 'text',
      text: [
        `File name: ${input.fileName}`,
        input.tech && `Technical data: ${input.tech}`,
        input.notes && `Creator's notes: ${input.notes}`,
        input.images.length > 1 ? `The following ${input.images.length} images are frames of one video, in time order.` : ''
      ]
        .filter(Boolean)
        .join('\n')
    }
  ]
  input.images.forEach((url, i) => {
    if (input.labels?.[i]) content.push({ type: 'text', text: input.labels[i] })
    content.push({ type: 'image_url', image_url: { url } })
  })

  const body = {
    model,
    temperature: 0.4,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content }
    ]
  }

  let res = await post(body, input)
  // Beberapa model tidak mendukung response_format: kirim ulang tanpa itu.
  if (res.status === 400) {
    const text = await res.text()
    if (/response_format|json_object|json mode/i.test(text)) {
      const { response_format: _rf, ...rest } = body
      res = await post(rest, input)
    } else {
      throw new AiError(`Permintaan ditolak (400): ${short(text)}`, 400, true)
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw httpError(res.status, text)
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | { text?: string }[] } }[]
    usage?: { total_tokens?: number }
  }
  const msg = data.choices?.[0]?.message?.content
  const text = Array.isArray(msg) ? msg.map((m) => m.text ?? '').join('') : (msg ?? '')
  const parsed = parseJson(text)
  if (!parsed) throw new AiError('Jawaban AI tidak bisa dibaca (bukan JSON).', 0, true)
  const meta = cleanMeta(parsed, input.prev)
  if (!meta.title || meta.keywords.length < 7) throw new AiError('Jawaban AI terlalu sedikit (judul/keyword kosong).', 0, true)
  return { meta, model, tokens: data.usage?.total_tokens }
}

async function post(body: unknown, input: AiInput): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 120_000)
  const onAbort = () => ctl.abort()
  input.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await fetch(`${CIORA_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify(body),
      signal: ctl.signal
    })
  } catch (err) {
    if (input.signal?.aborted) throw new AiError('Dibatalkan.', 0, false)
    const msg = (err as Error).name === 'AbortError' ? 'AI tidak menjawab dalam 2 menit.' : 'Tidak bisa terhubung ke Ciora. Cek koneksi internet.'
    throw new AiError(msg, 0, true)
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
  }
}

export function httpError(status: number, text: string): AiError {
  if (status === 401 || status === 403) return new AiError('API key Ciora salah atau tidak aktif. Cek di Pengaturan.', status, false)
  if (status === 402 || /insufficient|balance|saldo|credit/i.test(text)) return new AiError('Saldo Ciora habis. Isi saldo dulu di ciora.id.', status, false)
  if (status === 429) return new AiError('Model sedang penuh (terlalu banyak permintaan).', status, true)
  if (status >= 500) return new AiError(`Server AI sedang bermasalah (${status}).`, status, true)
  return new AiError(`Permintaan ditolak (${status}): ${short(text)}`, status, true)
}

function short(s: string): string {
  return s.replace(/\s+/g, ' ').slice(0, 160)
}

/** Ambil objek JSON dari jawaban AI, termasuk yang dibungkus ```json ... ```. */
export function parseJson(text: string): Record<string, unknown> | null {
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s)
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  const direct = tryParse(text.trim())
  if (direct) return direct
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    const v = tryParse(fenced[1].trim())
    if (v) return v
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? tryParse(text.slice(start, end + 1)) : null
}

/** Cek API key: daftar model hanya bisa dibaca dengan key yang benar. */
export async function testApiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${CIORA_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) })
    if (res.ok) return { ok: true, message: 'API key valid dan tersambung ke Ciora.' }
    return { ok: false, message: httpError(res.status, await res.text().catch(() => '')).message }
  } catch {
    return { ok: false, message: 'Tidak bisa terhubung ke Ciora. Cek koneksi internet.' }
  }
}
