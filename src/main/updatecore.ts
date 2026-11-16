/**
 * Inti pembaruan tanpa Electron (supaya bisa dites): baca latest.json, bandingkan versi, pilih installer,
 * unduh + cek SHA-256, dan susun skrip pengganti aplikasi di Mac.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

export type UpdateAsset = { name: string; sha256: string; size: number }

/** Isi latest.json yang diterbitkan workflow rilis. */
export type UpdateManifest = {
  version: string
  date: string
  notes: string
  files: { win?: UpdateAsset; mac?: UpdateAsset }
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** Bandingkan versi: >0 kalau a lebih baru dari b. Versi pra-rilis (1.2.0-beta) lebih tua dari 1.2.0. */
export function compareVersions(a: string, b: string): number {
  const ma = SEMVER.exec(a.trim())
  const mb = SEMVER.exec(b.trim())
  if (!ma || !mb) throw new Error(`Versi tidak valid: ${!ma ? a : b}`)
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i])
    if (d) return d
  }
  if (ma[4] && !mb[4]) return -1
  if (!ma[4] && mb[4]) return 1
  if (ma[4] && mb[4]) return ma[4] < mb[4] ? -1 : ma[4] > mb[4] ? 1 : 0
  return 0
}

function asset(v: unknown, label: string): UpdateAsset | undefined {
  if (v === undefined || v === null) return undefined
  const a = v as Partial<UpdateAsset>
  if (typeof a.name !== 'string' || !/^[\w.() -]+$/.test(a.name) || a.name.includes('..')) throw new Error(`Nama file ${label} di latest.json tidak valid.`)
  if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(a.sha256)) throw new Error(`Sidik SHA-256 ${label} di latest.json tidak valid.`)
  if (typeof a.size !== 'number' || !Number.isInteger(a.size) || a.size <= 0) throw new Error(`Ukuran file ${label} di latest.json tidak valid.`)
  return { name: a.name, sha256: a.sha256.toLowerCase(), size: a.size }
}

/** Periksa isi latest.json. */
export function parseManifest(json: unknown): UpdateManifest {
  const m = json as Partial<UpdateManifest> & { files?: Record<string, unknown> }
  if (!m || typeof m !== 'object') throw new Error('latest.json kosong.')
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) throw new Error('Versi di latest.json tidak valid.')
  const files = m.files ?? {}
  return {
    version: m.version.replace(/^v/, ''),
    date: typeof m.date === 'string' ? m.date : '',
    notes: typeof m.notes === 'string' ? m.notes.slice(0, 5000) : '',
    files: { win: asset(files.win, 'Windows'), mac: asset(files.mac, 'Mac') }
  }
}

/** Installer untuk komputer ini, atau pesan kenapa tidak ada. */
export function pickAsset(m: UpdateManifest, platform: NodeJS.Platform, arch: string): { asset: UpdateAsset } | { error: string } {
  if (platform === 'win32') return m.files.win ? { asset: m.files.win } : { error: 'Rilis ini belum punya installer Windows.' }
  if (platform === 'darwin') {
    if (arch !== 'arm64') return { error: 'Installer Mac hanya untuk Apple Silicon (M1/M2/M3/M4).' }
    return m.files.mac ? { asset: m.files.mac } : { error: 'Rilis ini belum punya installer Mac.' }
  }
  return { error: 'Pembaruan otomatis hanya untuk Windows dan Mac.' }
}

export const manifestUrl = (repo: string) => `https://github.com/${repo}/releases/latest/download/latest.json`
export const assetUrl = (repo: string, version: string, name: string) =>
  `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(name)}`

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>

/** Ambil dan periksa latest.json. null = belum ada rilis sama sekali. */
export async function fetchManifest(fetchImpl: FetchLike, url: string, signal?: AbortSignal): Promise<UpdateManifest | null> {
  const res = await fetchImpl(url, { signal, headers: { accept: 'application/json', 'cache-control': 'no-cache' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Server pembaruan menjawab kode ${res.status}.`)
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new Error('latest.json tidak bisa dibaca.')
  }
  return parseManifest(json)
}

/**
 * Unduh ke `dest` lewat file sementara `.part`, hitung SHA-256 sambil jalan,
 * dan hanya ganti nama jadi `dest` kalau ukuran + sidiknya cocok.
 */
export async function downloadVerified(
  fetchImpl: FetchLike,
  url: string,
  dest: string,
  expect: UpdateAsset,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const part = `${dest}.part`
  await fs.rm(part, { force: true })
  const res = await fetchImpl(url, { signal })
  if (!res.ok || !res.body) throw new Error(`Unduhan gagal (kode ${res.status}).`)
  const hash = createHash('sha256')
  const out = createWriteStream(part)
  let done = 0
  let lastTick = 0
  try {
    const body = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>)
    for await (const chunk of body) {
      const buf = chunk as Buffer
      done += buf.length
      if (done > expect.size) throw new Error('File unduhan lebih besar dari seharusnya.')
      hash.update(buf)
      if (!out.write(buf)) await new Promise<void>((r) => out.once('drain', () => r()))
      const now = Date.now()
      if (onProgress && now - lastTick > 150) {
        lastTick = now
        onProgress(done, expect.size)
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  } catch (e) {
    out.destroy()
    await fs.rm(part, { force: true })
    throw e
  }
  onProgress?.(done, expect.size)
  const digest = hash.digest('hex')
  if (done !== expect.size || digest !== expect.sha256) {
    await fs.rm(part, { force: true })
    throw new Error('File unduhan tidak cocok dengan sidik di rilis (rusak atau terpotong). Coba lagi.')
  }
  await fs.rm(dest, { force: true })
  await fs.rename(part, dest)
}

/** Lokasi bundle .app dari process.execPath (…/Stock Uploader.app/Contents/MacOS/Stock Uploader). */
export function macBundlePath(execPath: string): string | null {
  const m = /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath)
  return m ? m[1] : null
}

/** Dijalankan dari DMG atau dari lokasi sementara Gatekeeper: tidak bisa diganti di tempat. */
export function macCannotReplace(bundle: string): boolean {
  return bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * Skrip bash: tunggu aplikasi tertutup, pasang DMG, salin .app baru ke tempat yang lama, lalu buka lagi.
 * Kalau gagal di tengah jalan, aplikasi lama dikembalikan dan DMG dibuka untuk dipasang manual.
 */
export function macInstallScript(o: { pid: number; dmg: string; bundle: string; log: string }): string {
  return `#!/bin/bash
PID=${o.pid}
DMG=${q(o.dmg)}
TARGET=${q(o.bundle)}
LOG=${q(o.log)}
exec >>"$LOG" 2>&1
echo "== $(date) pembaruan mulai"
for i in $(seq 1 120); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
MNT=$(mktemp -d /tmp/su-update.XXXXXX)
fail() { echo "gagal: $1"; rm -rf "$TARGET.new"; [ -d "$TARGET.old" ] && [ ! -d "$TARGET" ] && mv "$TARGET.old" "$TARGET"; hdiutil detach "$MNT" -quiet 2>/dev/null; open "$DMG"; exit 1; }
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MNT" "$DMG" || fail "DMG tidak bisa dibuka"
APP=$(ls -d "$MNT"/*.app 2>/dev/null | head -1)
[ -n "$APP" ] || fail "aplikasi tidak ada di DMG"
rm -rf "$TARGET.new" "$TARGET.old"
ditto "$APP" "$TARGET.new" || fail "salin gagal"
mv "$TARGET" "$TARGET.old" || fail "aplikasi lama tidak bisa dipindah"
mv "$TARGET.new" "$TARGET" || fail "aplikasi baru tidak bisa dipasang"
rm -rf "$TARGET.old"
hdiutil detach "$MNT" -quiet
xattr -cr "$TARGET" 2>/dev/null
rm -f "$DMG"
echo "selesai, membuka $TARGET"
open "$TARGET"
`
}
