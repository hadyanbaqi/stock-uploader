/**
 * Tes Profil Browser: baca format proxy, flag Chrome, cari Chrome, perantara proxy lokal, cek IP.
 * Proxy HTTP (dengan login) dan SOCKS5 (dengan login) tiruan dijalankan di komputer ini.
 * Jalankan: node scripts/test-profiles.mts
 */
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { cleanStartUrls, maskProxy, parseProxy, proxyKey, type ProxyFull } from '../src/shared/profiles.ts'
import { browserCandidates, buildArgs, findBrowser } from '../src/main/browserlaunch.ts'
import { checkIp, connectVia, extractIp, startRelay, type IpEndpoint } from '../src/main/proxyrelay.ts'

let failed = 0
function check(name: string, ok: boolean, info = '') {
  if (!ok) failed++
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${info ? `  → ${info}` : ''}`)
}
async function rejects(name: string, p: Promise<unknown>, match: RegExp) {
  try {
    await p
    check(name, false, 'tidak ada error')
  } catch (e) {
    const m = (e as Error).message
    check(name, match.test(m), m)
  }
}

// ---------- 1. Format proxy ----------
console.log('[1] Baca format proxy')
const P = (t: string) => parseProxy(t)
const ok = (t: string) => {
  const r = P(t)
  return r.ok ? r.proxy : null
}
check('kosong = DIRECT', ok('')?.type === 'direct')
check('"direct" = DIRECT', ok('DIRECT')?.type === 'direct')
check('host:port', JSON.stringify(ok('142.111.126.243:6070')) === JSON.stringify({ type: 'http', host: '142.111.126.243', port: 6070, username: '', password: '' }))
check('host:port:user:pass', JSON.stringify(ok('1.2.3.4:8000:budi:rahasia')) === JSON.stringify({ type: 'http', host: '1.2.3.4', port: 8000, username: 'budi', password: 'rahasia' }))
check('password berisi titik dua', ok('1.2.3.4:8000:budi:a:b:c')?.password === 'a:b:c')
check('user:pass@host:port', JSON.stringify(ok('budi:rhs@proxy.contoh.com:3128')) === JSON.stringify({ type: 'http', host: 'proxy.contoh.com', port: 3128, username: 'budi', password: 'rhs' }))
check('host:port@user:pass', ok('proxy.contoh.com:3128@budi:rhs')?.username === 'budi' && ok('proxy.contoh.com:3128@budi:rhs')?.host === 'proxy.contoh.com')
check('http://user:pass@host:port', ok('http://u:p@9.9.9.9:80')?.type === 'http' && ok('http://u:p@9.9.9.9:80')?.password === 'p')
check('socks5://', ok('socks5://u:p@9.9.9.9:1080')?.type === 'socks5')
check('socks5h:// juga SOCKS5', ok('socks5h://9.9.9.9:1080')?.type === 'socks5')
check('https://', ok('https://9.9.9.9:443')?.type === 'https')
check('password URL-encoded dibaca', ok('http://u:p%40ss@9.9.9.9:80')?.password === 'p@ss')
check('spasi dan garis miring akhir dibuang', ok('  9.9.9.9:80/  ')?.port === 80)
check('tanpa skema + defaultType socks5', parseProxy('9.9.9.9:1080', 'socks5').ok && (parseProxy('9.9.9.9:1080', 'socks5') as { proxy: ProxyFull }).proxy.type === 'socks5')
const bad = (t: string) => {
  const r = P(t)
  return r.ok ? '' : r.error
}
check('tanpa port ditolak', /Port/.test(bad('9.9.9.9')), bad('9.9.9.9'))
check('port 70000 ditolak', /Port/.test(bad('9.9.9.9:70000')), bad('9.9.9.9:70000'))
check('SOCKS4 ditolak dengan pesan jelas', /SOCKS4/.test(bad('socks4://9.9.9.9:1080')), bad('socks4://9.9.9.9:1080'))
check('skema asing ditolak', /tidak dikenal/.test(bad('ftp://9.9.9.9:21')))
check('host aneh ditolak', /tidak valid/.test(bad('ha ha:80')), bad('ha ha:80'))

console.log('[2] Tampilan dan perubahan proxy')
check('password disamarkan', maskProxy({ type: 'http', host: 'h', port: 1, username: 'u' }, true) === 'http://u:***@h:1')
check('tanpa user', maskProxy({ type: 'socks5', host: 'h', port: 2, username: '' }, false) === 'socks5://h:2')
check('DIRECT', maskProxy({ type: 'direct', host: '', port: 0, username: '' }, false) === 'DIRECT')
check('ganti port = proxy berubah', proxyKey({ type: 'http', host: 'H', port: 1, username: 'u' }) !== proxyKey({ type: 'http', host: 'h', port: 2, username: 'u' }))
check('huruf besar host tidak dihitung berubah', proxyKey({ type: 'http', host: 'H', port: 1, username: 'u' }) === proxyKey({ type: 'http', host: 'h', port: 1, username: 'u' }))
check('halaman awal: https:// ditambahkan, dobel dibuang', JSON.stringify(cleanStartUrls(['contributor.stock.adobe.com', ' ', 'https://contributor.stock.adobe.com/'])) === JSON.stringify(['https://contributor.stock.adobe.com/']))
let urlErr = ''
try {
  cleanStartUrls(['javascript:alert(1)'])
} catch (e) {
  urlErr = (e as Error).message
}
check('halaman awal javascript: ditolak', /http/.test(urlErr), urlErr)

// ---------- 3. Chrome ----------
console.log('[3] Cari Chrome dan susun flag')
const win = browserCandidates('win32', { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' })
check('Windows: Chrome di Program Files paling atas', win[0] === 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', win[0])
check('Windows: Chrome di LocalAppData ikut dicari', win.includes('C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'))
const mac = browserCandidates('darwin', { HOME: '/Users/a' })
check('Mac: /Applications/Google Chrome.app', mac[0] === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', mac[0])
const only = '/Users/a/Applications/Chromium.app/Contents/MacOS/Chromium'
check('Mac: Chromium di ~/Applications ditemukan kalau Chrome tidak ada', findBrowser('', 'darwin', { HOME: '/Users/a' }, (p) => p === only) === only)
check('pilihan manual dipakai kalau ada', findBrowser('/x/chrome', 'linux', {}, (p) => p === '/x/chrome') === '/x/chrome')
check('pilihan manual yang hilang → cari otomatis', findBrowser('/hilang', 'linux', {}, (p) => p === '/usr/bin/chromium') === '/usr/bin/chromium')
check('tidak ada Chrome → null', findBrowser('', 'linux', {}, () => false) === null)
const args = buildArgs({ userDataDir: path.join('d', 'p1'), proxyUrl: 'http://127.0.0.1:5000', startUrls: ['https://a.com/'] })
check('flag: folder data sendiri', args.includes(`--user-data-dir=${path.join('d', 'p1')}`))
check('flag: proxy lokal', args.includes('--proxy-server=http://127.0.0.1:5000'))
check('flag: blok bocor WebRTC', args.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'))
check('flag: tanpa layar sambutan', args.includes('--no-first-run') && args.includes('--no-default-browser-check'))
check('flag: halaman awal paling akhir', args[args.length - 1] === 'https://a.com/')
check('flag: DIRECT tanpa --proxy-server', !buildArgs({ userDataDir: 'x', proxyUrl: null, startUrls: [] }).some((a) => a.startsWith('--proxy-server')))
check('ambil IP dari JSON, teks, dan HTML', extractIp('{"ip":"203.0.113.7"}') === '203.0.113.7' && extractIp('203.0.113.8\n') === '203.0.113.8' && extractIp('<b>IP 203.0.113.9</b>') === '203.0.113.9')

// ---------- 4. Jaringan: proxy tiruan ----------
console.log('[4] Proxy tiruan: HTTP + SOCKS5 dengan login')
const sockets = new Set<net.Socket>()
const keep = (s: net.Socket) => {
  sockets.add(s)
  s.on('close', () => sockets.delete(s))
  s.on('error', () => s.destroy())
}

// Server tujuan: menjawab IP palsu + header yang diterima.
const target = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ip: '203.0.113.7', path: req.url, host: req.headers.host }))
})
target.on('connection', keep)
await new Promise<void>((r) => target.listen(0, '127.0.0.1', r))
const targetPort = (target.address() as net.AddressInfo).port
const endpoint: IpEndpoint = { host: '127.0.0.1', port: targetPort, tls: false, path: '/?format=json' }

// Proxy HTTP CONNECT dengan Basic auth budi:rahasia.
let httpConnects = 0
const httpProxy = http.createServer((_req, res) => res.writeHead(405).end())
httpProxy.on('connection', keep)
httpProxy.on('connect', (req, client: net.Socket, head: Buffer) => {
  keep(client)
  const want = `Basic ${Buffer.from('budi:rahasia').toString('base64')}`
  if (req.headers['proxy-authorization'] !== want) {
    client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n')
    return
  }
  httpConnects++
  const [h, p] = (req.url ?? '').split(':')
  const up = net.connect(Number(p), h, () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) up.write(head)
    up.pipe(client)
    client.pipe(up)
  })
  keep(up)
})
await new Promise<void>((r) => httpProxy.listen(0, '127.0.0.1', r))
const httpProxyPort = (httpProxy.address() as net.AddressInfo).port

// Proxy SOCKS5 dengan login user/pass (RFC 1929), alamat domain/IPv4.
let socksConnects = 0
const socks = net.createServer((c) => {
  keep(c)
  let stage = 0
  let buf = Buffer.alloc(0)
  c.on('data', function onData(d: Buffer) {
    buf = Buffer.concat([buf, d])
    if (stage === 0 && buf.length >= 2 && buf.length >= 2 + buf[1]) {
      const methods = [...buf.subarray(2, 2 + buf[1])]
      buf = buf.subarray(2 + buf[1])
      if (!methods.includes(2)) {
        c.end(Buffer.from([5, 0xff]))
        return
      }
      c.write(Buffer.from([5, 2]))
      stage = 1
    }
    if (stage === 1 && buf.length >= 2) {
      const ul = buf[1]
      if (buf.length < 3 + ul) return
      const pl = buf[2 + ul]
      if (buf.length < 3 + ul + pl) return
      const u = buf.subarray(2, 2 + ul).toString()
      const pw = buf.subarray(3 + ul, 3 + ul + pl).toString()
      buf = buf.subarray(3 + ul + pl)
      if (u !== 'sinta' || pw !== 'p@ss:w0rd') {
        c.end(Buffer.from([1, 1]))
        return
      }
      c.write(Buffer.from([1, 0]))
      stage = 2
    }
    if (stage === 2 && buf.length >= 5) {
      const atyp = buf[3]
      const alen = atyp === 1 ? 4 : atyp === 3 ? 1 + buf[4] : 16
      if (buf.length < 4 + alen + 2) return
      const host = atyp === 1 ? [...buf.subarray(4, 8)].join('.') : buf.subarray(5, 5 + buf[4]).toString()
      const port = buf.readUInt16BE(4 + alen)
      buf = buf.subarray(4 + alen + 2)
      stage = 3
      c.off('data', onData)
      const up = net.connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
        socksConnects++
        c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
        if (buf.length) up.write(buf)
        up.pipe(c)
        c.pipe(up)
      })
      up.on('error', () => c.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])))
      keep(up)
    }
  })
})
await new Promise<void>((r) => socks.listen(0, '127.0.0.1', r))
const socksPort = (socks.address() as net.AddressInfo).port

// Port yang pasti mati.
const dead = net.createServer()
await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r))
const deadPort = (dead.address() as net.AddressInfo).port
await new Promise<void>((r) => dead.close(() => r()))

const HTTP_OK: ProxyFull = { type: 'http', host: '127.0.0.1', port: httpProxyPort, username: 'budi', password: 'rahasia' }
const SOCKS_OK: ProxyFull = { type: 'socks5', host: '127.0.0.1', port: socksPort, username: 'sinta', password: 'p@ss:w0rd' }

const direct = await checkIp(null, endpoint)
check('cek IP tanpa proxy', direct.ip === '203.0.113.7', JSON.stringify(direct))
const viaHttp = await checkIp(HTTP_OK, endpoint)
check('cek IP lewat proxy HTTP + login', viaHttp.ip === '203.0.113.7' && httpConnects === 1, JSON.stringify(viaHttp))
await rejects('HTTP password salah → pesan 407', checkIp({ ...HTTP_OK, password: 'salah' }, endpoint), /salah \(407\)/)
await rejects('HTTP tanpa login → minta login', checkIp({ ...HTTP_OK, username: '', password: '' }, endpoint), /minta username/)
const viaSocks = await checkIp(SOCKS_OK, endpoint)
check('cek IP lewat SOCKS5 + login (password berisi @ dan :)', viaSocks.ip === '203.0.113.7' && socksConnects === 1, JSON.stringify(viaSocks))
await rejects('SOCKS5 password salah', checkIp({ ...SOCKS_OK, password: 'x' }, endpoint), /SOCKS5 salah/)
await rejects('SOCKS5 tanpa login padahal wajib', checkIp({ ...SOCKS_OK, username: '', password: '' }, endpoint), /minta username/)
await rejects('proxy mati → pesan menolak koneksi', checkIp({ ...HTTP_OK, port: deadPort }, endpoint), /menolak koneksi/)
await rejects('SOCKS5 ke tujuan mati → pesan jelas', connectVia(SOCKS_OK, '127.0.0.1', deadPort), /SOCKS5 gagal/)
await rejects('bukan proxy SOCKS5', checkIp({ ...SOCKS_OK, port: targetPort }, endpoint), /bukan proxy SOCKS5|terputus|menutup/)

console.log('[5] Perantara lokal (yang dipakai Chrome)')
/** Kirim permintaan seperti Chrome: CONNECT ke perantara, lalu GET di dalam terowongan. */
function viaRelayConnect(relayPort: number): Promise<{ code: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: relayPort, method: 'CONNECT', path: `127.0.0.1:${targetPort}` })
    req.on('connect', (res, sock) => {
      if (res.statusCode !== 200) {
        sock.destroy()
        resolve({ code: res.statusCode ?? 0, body: '' })
        return
      }
      const r2 = http.request({ createConnection: () => sock, path: '/lewat-terowongan', headers: { host: `127.0.0.1:${targetPort}`, connection: 'close' } }, (res2) => {
        let body = ''
        res2.on('data', (d) => (body += d))
        res2.on('end', () => resolve({ code: res2.statusCode ?? 0, body }))
      })
      r2.on('error', reject)
      r2.end()
    })
    req.on('error', reject)
    req.end()
  })
}
function viaRelayPlain(relayPort: number): Promise<{ code: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: relayPort, path: `http://127.0.0.1:${targetPort}/biasa?x=1`, headers: { host: `127.0.0.1:${targetPort}`, 'proxy-connection': 'keep-alive' } }, (res) => {
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => resolve({ code: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

for (const [label, up] of [['HTTP', HTTP_OK], ['SOCKS5', SOCKS_OK]] as const) {
  const relay = await startRelay(up)
  check(`${label}: perantara hanya di 127.0.0.1`, relay.url === `http://127.0.0.1:${relay.port}`)
  const a = await viaRelayConnect(relay.port)
  check(`${label}: HTTPS (CONNECT) lewat perantara tanpa login di Chrome`, a.code === 200 && a.body.includes('/lewat-terowongan'), `${a.code} ${a.body}`)
  const b = await viaRelayPlain(relay.port)
  check(`${label}: http:// biasa lewat perantara, path dirapikan`, b.code === 200 && b.body.includes('"/biasa?x=1"'), `${b.code} ${b.body}`)
  const ip = await checkIp({ type: 'http', host: '127.0.0.1', port: relay.port, username: '', password: '' }, endpoint)
  check(`${label}: cek IP lewat perantara`, ip.ip === '203.0.113.7')
  await relay.close()
  await rejects(`${label}: perantara ditutup → tidak bisa dipakai lagi`, viaRelayConnect(relay.port), /ECONNREFUSED|menolak/)
}

const deadRelay = await startRelay({ ...HTTP_OK, port: deadPort })
const blocked = await viaRelayConnect(deadRelay.port)
check('gagal tertutup: proxy asli mati → 502, tidak lewat internet langsung', blocked.code === 502, String(blocked.code))
const blockedPlain = await viaRelayPlain(deadRelay.port)
check('gagal tertutup juga untuk http:// biasa', blockedPlain.code === 502 && !blockedPlain.body.includes('203.0.113.7'), `${blockedPlain.code} ${blockedPlain.body}`)
await deadRelay.close()

const wrongPw = await startRelay({ ...HTTP_OK, password: 'salah' })
check('password proxy salah → Chrome dapat 502', (await viaRelayConnect(wrongPw.port)).code === 502)
await wrongPw.close()

for (const s of sockets) s.destroy()
await Promise.all([target, httpProxy, socks].map((srv) => new Promise<void>((r) => srv.close(() => r()))))

console.log(failed ? `\n${failed} tes GAGAL` : '\nSemua tes lulus')
process.exit(failed ? 1 : 0)
