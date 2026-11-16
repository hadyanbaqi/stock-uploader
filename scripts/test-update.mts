/**
 * Tes pembaruan aplikasi: versi, latest.json, pilih installer, unduh + SHA-256, skrip ganti aplikasi Mac,
 * dan penyusun latest.json untuk workflow rilis.
 * Jalankan: node scripts/test-update.mts
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assetUrl,
  compareVersions,
  downloadVerified,
  fetchManifest,
  macBundlePath,
  macCannotReplace,
  macInstallScript,
  manifestUrl,
  parseManifest,
  pickAsset
} from '../src/main/updatecore.ts'

let failed = 0
function check(name: string, ok: boolean, info = '') {
  if (!ok) failed++
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${info ? `  → ${info}` : ''}`)
}
async function rejects(name: string, p: Promise<unknown> | (() => unknown), match: RegExp) {
  try {
    await (typeof p === 'function' ? p() : p)
    check(name, false, 'tidak ada error')
  } catch (e) {
    const m = (e as Error).message
    check(name, match.test(m), m)
  }
}

console.log('[1] Versi')
check('1.7.0 > 1.6.0', compareVersions('1.7.0', '1.6.0') > 0)
check('1.10.0 > 1.9.9 (angka, bukan huruf)', compareVersions('1.10.0', '1.9.9') > 0)
check('v1.6.0 = 1.6.0', compareVersions('v1.6.0', '1.6.0') === 0)
check('1.6.0 > 1.6.0-beta.1', compareVersions('1.6.0', '1.6.0-beta.1') > 0)
check('1.6.0-beta.2 > 1.6.0-beta.1', compareVersions('1.6.0-beta.2', '1.6.0-beta.1') > 0)
check('2.0.0 > 1.99.99', compareVersions('2.0.0', '1.99.99') > 0)
await rejects('versi aneh ditolak', () => compareVersions('1.6', '1.6.0'), /tidak valid/)

console.log('[2] latest.json')
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const good = {
  version: '1.7.0',
  date: '2026-11-16T00:00:00Z',
  notes: 'Fitur baru',
  files: {
    win: { name: 'Stock-Uploader-Setup-1.7.0.exe', sha256: sha('w'), size: 10 },
    mac: { name: 'Stock-Uploader-1.7.0-mac.dmg', sha256: sha('m').toUpperCase(), size: 20 }
  }
}
const m = parseManifest(good)
check('valid dibaca, sidik jadi huruf kecil', m.version === '1.7.0' && m.files.mac?.sha256 === sha('m'))
check('versi "v1.7.0" dibersihkan', parseManifest({ ...good, version: 'v1.7.0' }).version === '1.7.0')
await rejects('nama file dengan ../ ditolak', () => parseManifest({ ...good, files: { win: { ...good.files.win, name: '../evil.exe' } } }), /Nama file/)
await rejects('nama file dengan / ditolak', () => parseManifest({ ...good, files: { win: { ...good.files.win, name: 'a/b.exe' } } }), /Nama file/)
await rejects('sidik pendek ditolak', () => parseManifest({ ...good, files: { win: { ...good.files.win, sha256: 'abc' } } }), /SHA-256/)
await rejects('ukuran 0 ditolak', () => parseManifest({ ...good, files: { mac: { ...good.files.mac, size: 0 } } }), /Ukuran/)
await rejects('versi kosong ditolak', () => parseManifest({ ...good, version: '' }), /Versi/)
check('catatan sangat panjang dipotong', parseManifest({ ...good, notes: 'x'.repeat(9000) }).notes.length === 5000)

console.log('[3] Pilih installer')
const pw = pickAsset(m, 'win32', 'x64')
check('Windows → .exe', 'asset' in pw && pw.asset.name.endsWith('.exe'))
const pm = pickAsset(m, 'darwin', 'arm64')
check('Mac Apple Silicon → .dmg', 'asset' in pm && pm.asset.name.endsWith('.dmg'))
const pi = pickAsset(m, 'darwin', 'x64')
check('Mac Intel → pesan jelas', 'error' in pi && /Apple Silicon/.test(pi.error))
const pl = pickAsset(m, 'linux', 'x64')
check('Linux → tidak didukung', 'error' in pl)
const noWin = pickAsset(parseManifest({ ...good, files: { mac: good.files.mac } }), 'win32', 'x64')
check('rilis tanpa installer Windows → pesan', 'error' in noWin && /Windows/.test(noWin.error))
check('alamat latest.json', manifestUrl('a/b') === 'https://github.com/a/b/releases/latest/download/latest.json')
check('alamat installer (spasi di-encode)', assetUrl('a/b', '1.7.0', 'X Y.dmg') === 'https://github.com/a/b/releases/download/v1.7.0/X%20Y.dmg')

console.log('[4] Ambil latest.json dan unduh (server lokal)')
const payload = Buffer.alloc(300_000)
for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) % 251
const routes: Record<string, (res: http.ServerResponse) => void> = {
  '/latest.json': (res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(good)),
  '/broken.json': (res) => res.writeHead(200).end('{nope'),
  '/err.json': (res) => res.writeHead(500).end(),
  '/redirect': (res) => res.writeHead(302, { location: '/file' }).end(),
  '/file': (res) => res.writeHead(200, { 'content-length': payload.length }).end(payload),
  '/short': (res) => res.writeHead(200).end(payload.subarray(0, 1000)),
  '/big': (res) => res.writeHead(200).end(Buffer.concat([payload, Buffer.alloc(10)]))
}
const server = http.createServer((req, res) => (routes[req.url ?? ''] ?? ((r: http.ServerResponse) => r.writeHead(404).end()))(res))
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const f = (u: string, i?: { signal?: AbortSignal; headers?: Record<string, string> }) => fetch(u, i)

const got = await fetchManifest(f, `${base}/latest.json`)
check('latest.json dibaca', got?.version === '1.7.0')
check('belum ada rilis (404) → null', (await fetchManifest(f, `${base}/tidak-ada`)) === null)
await rejects('kode 500 → pesan', fetchManifest(f, `${base}/err.json`), /kode 500/)
await rejects('JSON rusak → pesan', fetchManifest(f, `${base}/broken.json`), /tidak bisa dibaca/)

const dir = mkdtempSync(path.join(tmpdir(), 'su-upd-'))
const asset = { name: 'x.exe', sha256: sha(payload), size: payload.length }
const dest = path.join(dir, 'x.exe')
let lastProgress = 0
await downloadVerified(f, `${base}/redirect`, dest, asset, (d, t) => (lastProgress = d / t))
check('unduh lewat redirect, sidik cocok, file utuh', existsSync(dest) && sha(readFileSync(dest)) === asset.sha256)
check('progres sampai 100%', lastProgress === 1)
check('tidak ada sisa .part', !existsSync(`${dest}.part`))
const bad = path.join(dir, 'bad.exe')
await rejects('sidik salah → ditolak', downloadVerified(f, `${base}/file`, bad, { ...asset, sha256: sha('lain') }), /tidak cocok/)
check('file salah tidak disimpan (juga .part)', !existsSync(bad) && !existsSync(`${bad}.part`))
await rejects('unduhan terpotong → ditolak', downloadVerified(f, `${base}/short`, bad, asset), /tidak cocok/)
await rejects('unduhan kebesaran → dihentikan', downloadVerified(f, `${base}/big`, bad, asset), /lebih besar/)
await rejects('404 → pesan', downloadVerified(f, `${base}/hilang`, bad, asset), /kode 404/)
const ac = new AbortController()
const aborted = downloadVerified(f, `${base}/file`, bad, asset, () => ac.abort(), ac.signal)
await rejects('bisa dibatalkan', aborted, /abort/i)
check('batal: tidak ada sisa file', !existsSync(bad) && !existsSync(`${bad}.part`))
server.close()

console.log('[5] Mac: lokasi aplikasi')
check('bundle dari execPath', macBundlePath('/Applications/Stock Uploader.app/Contents/MacOS/Stock Uploader') === '/Applications/Stock Uploader.app')
check('bukan .app → null', macBundlePath('/usr/bin/node') === null)
check('jalan dari DMG → tidak bisa diganti', macCannotReplace('/Volumes/Stock Uploader/Stock Uploader.app'))
check('lokasi sementara Gatekeeper → tidak bisa diganti', macCannotReplace('/private/var/folders/x/AppTranslocation/ABC/d/Stock Uploader.app'))
check('Applications → bisa diganti', !macCannotReplace('/Applications/Stock Uploader.app'))

if (process.platform === 'win32') {
  console.log('[6] Skrip Mac: dilewati di Windows')
} else {
  console.log('[6] Skrip ganti aplikasi Mac (hdiutil/ditto/open tiruan)')
  const sim = mkdtempSync(path.join(tmpdir(), 'su-mac-'))
  const bin = path.join(sim, 'bin')
  mkdirSync(bin)
  const newApp = path.join(sim, 'isi-dmg', 'Stock Uploader.app')
  mkdirSync(path.join(newApp, 'Contents'), { recursive: true })
  writeFileSync(path.join(newApp, 'Contents', 'versi'), 'baru')
  const shim = (name: string, body: string) => {
    writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`)
    chmodSync(path.join(bin, name), 0o755)
  }
  // hdiutil attach … -mountpoint DIR DMG → salin isi DMG tiruan ke DIR; detach → tidak apa-apa.
  shim('hdiutil', `if [ "$1" = attach ]; then while [ $# -gt 1 ]; do [ "$1" = -mountpoint ] && MP="$2"; shift; done; cp -R ${JSON.stringify(path.join(sim, 'isi-dmg'))}/. "$MP"/; fi; exit 0`)
  shim('ditto', 'cp -R "$1" "$2"')
  shim('xattr', 'exit 0')
  shim('open', `echo "$1" >> ${JSON.stringify(path.join(sim, 'dibuka.txt'))}`)
  const run = (bundle: string, dmg: string) => {
    const script = path.join(sim, 'pasang.sh')
    writeFileSync(script, macInstallScript({ pid: 999999, dmg, bundle, log: path.join(sim, 'pasang.log') }))
    return spawnSync('/bin/bash', [script], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' })
  }
  const syntax = spawnSync('/bin/bash', ['-n', '-c', macInstallScript({ pid: 1, dmg: "/tmp/a'b.dmg", bundle: '/Applications/X Y.app', log: '/tmp/l' })])
  check('skrip lolos cek sintaks bash (kutip, spasi)', syntax.status === 0, syntax.stderr?.toString())

  const apps = path.join(sim, 'Applications')
  const target = path.join(apps, 'Stock Uploader.app')
  mkdirSync(path.join(target, 'Contents'), { recursive: true })
  writeFileSync(path.join(target, 'Contents', 'versi'), 'lama')
  const dmg = path.join(sim, 'unduh.dmg')
  writeFileSync(dmg, 'dmg')
  const r1 = run(target, dmg)
  check('aplikasi lama diganti yang baru', r1.status === 0 && readFileSync(path.join(target, 'Contents', 'versi'), 'utf8') === 'baru', readFileSync(path.join(sim, 'pasang.log'), 'utf8').slice(-200))
  check('tidak ada sisa .old/.new, DMG dihapus', !existsSync(`${target}.old`) && !existsSync(`${target}.new`) && !existsSync(dmg))
  check('aplikasi dibuka lagi', readFileSync(path.join(sim, 'dibuka.txt'), 'utf8').trim() === target)

  // Gagal: folder tujuan tidak bisa ditulisi → aplikasi lama tetap utuh, DMG dibuka untuk manual.
  writeFileSync(path.join(target, 'Contents', 'versi'), 'lama')
  writeFileSync(path.join(sim, 'dibuka.txt'), '')
  writeFileSync(dmg, 'dmg')
  chmodSync(apps, 0o555)
  const r2 = run(target, dmg)
  chmodSync(apps, 0o755)
  const isRoot = process.getuid?.() === 0
  if (isRoot) {
    console.log('(lewati tes izin tulis: berjalan sebagai root)')
  } else {
    check('gagal → keluar dengan error', r2.status === 1)
    check('gagal → aplikasi lama tetap ada dan utuh', readFileSync(path.join(target, 'Contents', 'versi'), 'utf8') === 'lama')
    check('gagal → DMG dibuka untuk dipasang manual', readFileSync(path.join(sim, 'dibuka.txt'), 'utf8').trim() === dmg)
  }

  // Gagal: DMG tidak berisi aplikasi.
  shim('hdiutil', 'exit 0')
  writeFileSync(path.join(target, 'Contents', 'versi'), 'lama')
  writeFileSync(dmg, 'dmg')
  writeFileSync(path.join(sim, 'dibuka.txt'), '')
  const r3 = run(target, dmg)
  check('DMG tanpa aplikasi → aplikasi lama tidak disentuh', r3.status === 1 && readFileSync(path.join(target, 'Contents', 'versi'), 'utf8') === 'lama')
}

console.log('[7] Penyusun latest.json (workflow rilis)')
{
  const rel = mkdtempSync(path.join(tmpdir(), 'su-rel-'))
  mkdirSync(path.join(rel, 'Stock-Uploader-Windows'))
  mkdirSync(path.join(rel, 'Stock-Uploader-macOS'))
  writeFileSync(path.join(rel, 'Stock-Uploader-Windows', 'Stock-Uploader-Setup-1.7.0.exe'), 'isi exe')
  writeFileSync(path.join(rel, 'Stock-Uploader-macOS', 'Stock-Uploader-1.7.0-mac.dmg'), 'isi dmg')
  writeFileSync(path.join(rel, 'catatan.md'), 'Fitur pembaruan otomatis\n\nCo-Authored-By: Seseorang <a@b.c>\nClaude-Session: https://x\n')
  const out = path.join(rel, 'latest.json')
  const script = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'release-manifest.mts')
  const r = spawnSync(process.execPath, [script, 'v1.7.0', rel, path.join(rel, 'catatan.md'), out], { encoding: 'utf8' })
  check('skrip berhasil', r.status === 0, r.stderr.split('\n').filter((l) => !/Warning|MODULE_TYPELESS|Reparsing|eliminate|trace-warnings|^\s*$/.test(l)).join(' ').slice(0, 300))
  if (r.status === 0) {
    const man = parseManifest(JSON.parse(readFileSync(out, 'utf8')))
    check('versi tanpa "v"', man.version === '1.7.0')
    check('sidik dan ukuran Windows benar', man.files.win?.sha256 === sha('isi exe') && man.files.win?.size === 7)
    check('sidik Mac benar', man.files.mac?.sha256 === sha('isi dmg'))
    check('catatan tanpa baris atribusi', man.notes === 'Fitur pembaruan otomatis', JSON.stringify(man.notes))
    const assets = JSON.parse(/ASSETS=(.*)/.exec(r.stdout)?.[1] ?? '[]') as string[]
    check('daftar file untuk diunggah', assets.length === 2 && assets.every((a) => existsSync(a)))
  }
  writeFileSync(path.join(rel, 'Stock-Uploader-Windows', 'Stock-Uploader-Setup-1.6.0.exe'), 'lama')
  const r2 = spawnSync(process.execPath, [script, '1.6.0', rel, '', out], { encoding: 'utf8' })
  check('installer versi lain tidak ikut / versi salah ditolak', r2.status !== 0 && /Harus ada tepat satu .dmg/.test(r2.stderr), r2.stderr.split('\n').find((l) => l.includes('Harus')) ?? '')
}

console.log(failed ? `\n${failed} tes GAGAL` : '\nSemua tes lulus')
process.exit(failed ? 1 : 0)
