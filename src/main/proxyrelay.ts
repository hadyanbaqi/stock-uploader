/**
 * Proxy perantara lokal + cek IP, hanya memakai modul bawaan Node.
 *
 * Chrome tidak bisa memakai proxy ber-password secara otomatis (SOCKS5 sama sekali tidak bisa login,
 * HTTP memunculkan popup). Jadi Chrome diarahkan ke proxy HTTP kecil di 127.0.0.1 tanpa password,
 * dan proxy kecil itu meneruskan semua koneksi ke proxy asli (HTTP, HTTPS atau SOCKS5) sambil login.
 *
 * Gagal tertutup: kalau proxy asli tidak bisa dihubungi, koneksi Chrome ditolak (502), tidak pernah
 * diteruskan langsung lewat internet komputer ini.
 */
import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'
import type { ProxyFull } from '../shared/profiles'

const CONNECT_TIMEOUT = 15000

function withTimeout<T>(p: Promise<T>, ms: number, sock: net.Socket | null, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      sock?.destroy()
      reject(new Error(`${what}: tidak ada jawaban dalam ${Math.round(ms / 1000)} detik.`))
    }, ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/** Baca dari soket sampai `done(buf)` mengembalikan jumlah byte yang dipakai (atau -1 = belum cukup). */
function readUntil(sock: net.Socket, done: (buf: Buffer) => number): Promise<{ head: Buffer; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      let used: number
      try {
        used = done(buf)
      } catch (e) {
        cleanup()
        reject(e)
        return
      }
      if (used >= 0) {
        cleanup()
        resolve({ head: buf.subarray(0, used), rest: buf.subarray(used) })
      } else if (buf.length > 64 * 1024) {
        cleanup()
        reject(new Error('Jawaban proxy terlalu panjang.'))
      }
    }
    const onEnd = () => {
      cleanup()
      reject(new Error('Proxy menutup koneksi.'))
    }
    const onErr = (e: Error) => {
      cleanup()
      reject(e)
    }
    const cleanup = () => {
      sock.off('data', onData)
      sock.off('end', onEnd)
      sock.off('error', onErr)
    }
    sock.on('data', onData)
    sock.on('end', onEnd)
    sock.on('error', onErr)
  })
}

function rawConnect(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port })
    s.once('connect', () => {
      s.off('error', reject)
      resolve(s)
    })
    s.once('error', reject)
  })
}

function tlsWrap(sock: net.Socket | undefined, host: string, port: number, rejectUnauthorized = true): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ socket: sock, host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized })
    s.once('secureConnect', () => {
      s.off('error', reject)
      resolve(s)
    })
    s.once('error', reject)
  })
}

function friendly(err: unknown, p: ProxyFull): Error {
  const e = err as NodeJS.ErrnoException
  const where = `${p.host}:${p.port}`
  switch (e?.code) {
    case 'ECONNREFUSED':
      return new Error(`Proxy ${where} menolak koneksi. Cek host dan port.`)
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new Error(`Host proxy "${p.host}" tidak ditemukan.`)
    case 'ETIMEDOUT':
      return new Error(`Proxy ${where} tidak menjawab.`)
    case 'ECONNRESET':
      return new Error(`Koneksi ke proxy ${where} terputus.`)
    default:
      return e instanceof Error ? e : new Error(String(err))
  }
}

async function viaHttpProxy(p: ProxyFull, host: string, port: number): Promise<{ sock: net.Socket; rest: Buffer }> {
  let sock: net.Socket = await rawConnect(p.host, p.port)
  if (p.type === 'https') sock = await tlsWrap(sock, p.host, p.port)
  const target = net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`
  const auth = p.username ? `Proxy-Authorization: Basic ${Buffer.from(`${p.username}:${p.password}`).toString('base64')}\r\n` : ''
  sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`)
  const { head, rest } = await readUntil(sock, (b) => {
    const i = b.indexOf('\r\n\r\n')
    return i < 0 ? -1 : i + 4
  })
  const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(head.toString('latin1'))
  const code = status ? Number(status[1]) : 0
  if (code === 407) {
    sock.destroy()
    throw new Error(p.username ? 'Username atau password proxy salah (407).' : 'Proxy minta username dan password (407).')
  }
  if (code < 200 || code >= 300) {
    sock.destroy()
    throw new Error(`Proxy menolak tujuan ${target}${code ? ` (kode ${code})` : ''}.`)
  }
  return { sock, rest }
}

async function viaSocks5(p: ProxyFull, host: string, port: number): Promise<{ sock: net.Socket; rest: Buffer }> {
  const sock = await rawConnect(p.host, p.port)
  const wantAuth = Boolean(p.username)
  sock.write(Buffer.from(wantAuth ? [5, 2, 0, 2] : [5, 1, 0]))
  const hello = await readUntil(sock, (b) => (b.length >= 2 ? 2 : -1))
  if (hello.head[0] !== 5) {
    sock.destroy()
    throw new Error('Server ini bukan proxy SOCKS5.')
  }
  const method = hello.head[1]
  if (method === 2) {
    const u = Buffer.from(p.username, 'utf8')
    const pw = Buffer.from(p.password, 'utf8')
    if (u.length > 255 || pw.length > 255) {
      sock.destroy()
      throw new Error('Username atau password SOCKS5 terlalu panjang.')
    }
    sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([pw.length]), pw]))
    const r = await readUntil(sock, (b) => (b.length >= 2 ? 2 : -1))
    if (r.head[1] !== 0) {
      sock.destroy()
      throw new Error('Username atau password SOCKS5 salah.')
    }
  } else if (method !== 0) {
    sock.destroy()
    throw new Error(method === 0xff ? 'Proxy SOCKS5 minta username dan password.' : 'Cara login SOCKS5 tidak didukung.')
  }
  let addr: Buffer
  if (net.isIPv4(host)) addr = Buffer.from([1, ...host.split('.').map(Number)])
  else if (net.isIPv6(host)) {
    const full = new URL(`http://[${host}]`).hostname.slice(1, -1)
    const groups = full.includes('::') ? expandV6(full) : full.split(':')
    addr = Buffer.alloc(17)
    addr[0] = 4
    groups.forEach((g, i) => addr.writeUInt16BE(parseInt(g || '0', 16), 1 + i * 2))
  } else {
    const h = Buffer.from(host, 'utf8')
    addr = Buffer.concat([Buffer.from([3, h.length]), h])
  }
  const portBuf = Buffer.alloc(2)
  portBuf.writeUInt16BE(port)
  sock.write(Buffer.concat([Buffer.from([5, 1, 0]), addr, portBuf]))
  const reply = await readUntil(sock, (b) => {
    if (b.length < 5) return -1
    const atyp = b[3]
    const len = atyp === 1 ? 4 : atyp === 4 ? 16 : atyp === 3 ? 1 + b[4] : -1
    if (len < 0) throw new Error('Jawaban SOCKS5 tidak dikenal.')
    const total = 4 + len + 2
    return b.length >= total ? total : -1
  })
  if (reply.head[1] !== 0) {
    sock.destroy()
    const why: Record<number, string> = { 2: 'tidak diizinkan', 3: 'jaringan tidak terjangkau', 4: 'host tidak terjangkau', 5: 'koneksi ditolak', 6: 'waktu habis' }
    throw new Error(`Proxy SOCKS5 gagal ke ${host}:${port} (${why[reply.head[1]] ?? `kode ${reply.head[1]}`}).`)
  }
  return { sock, rest: reply.rest }
}

function expandV6(a: string): string[] {
  const [l, r] = a.split('::')
  const left = l ? l.split(':') : []
  const right = r ? r.split(':') : []
  return [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
}

/** Buka koneksi TCP ke host:port lewat proxy. `rest` = byte yang sudah terbaca setelah jabat tangan. */
export async function connectVia(p: ProxyFull, host: string, port: number, timeoutMs = CONNECT_TIMEOUT): Promise<{ sock: net.Socket; rest: Buffer }> {
  if (p.type === 'direct') throw new Error('connectVia butuh proxy.')
  const work = p.type === 'socks5' ? viaSocks5(p, host, port) : viaHttpProxy(p, host, port)
  try {
    return await withTimeout(work, timeoutMs, null, `Proxy ${p.host}:${p.port}`)
  } catch (e) {
    throw friendly(e, p)
  }
}

export type Relay = { port: number; url: string; close(): Promise<void> }

/** Jalankan proxy HTTP lokal di 127.0.0.1 (port acak) yang meneruskan semua lalu lintas lewat `upstream`. */
export function startRelay(upstream: ProxyFull): Promise<Relay> {
  const sockets = new Set<net.Socket>()
  const track = (s: net.Socket) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  }

  const server = http.createServer((req, res) => {
    // Permintaan http:// biasa (bukan CONNECT): URL-nya absolut, mis. GET http://contoh.com/a HTTP/1.1
    let target: URL
    try {
      target = new URL(req.url ?? '')
      if (target.protocol !== 'http:') throw new Error()
    } catch {
      res.writeHead(400).end('Bad request')
      return
    }
    const port = Number(target.port) || 80
    connectVia(upstream, target.hostname, port)
      .then(({ sock, rest }) => {
        track(sock)
        const headers = { ...req.headers }
        delete headers['proxy-connection']
        delete headers['proxy-authorization']
        const fwd = http.request({
          createConnection: () => sock,
          method: req.method,
          path: `${target.pathname}${target.search}`,
          headers: { ...headers, host: target.host, connection: 'close' }
        })
        if (rest.length) sock.unshift(rest)
        fwd.on('response', (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers)
          up.pipe(res)
        })
        fwd.on('error', () => {
          if (!res.headersSent) res.writeHead(502)
          res.end()
        })
        req.pipe(fwd)
      })
      .catch((e: Error) => {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end(`Proxy gagal: ${e.message}`)
      })
  })

  server.on('connect', (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    track(client)
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? '')
    if (!m) {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      return
    }
    client.on('error', () => client.destroy())
    connectVia(upstream, m[1], Number(m[2]))
      .then(({ sock, rest }) => {
        track(sock)
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (rest.length) client.write(rest)
        if (head.length) sock.write(head)
        sock.on('error', () => client.destroy())
        client.on('close', () => sock.destroy())
        sock.on('close', () => client.destroy())
        sock.pipe(client)
        client.pipe(sock)
      })
      .catch(() => {
        client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
      })
  })
  server.on('connection', track)
  server.on('clientError', (_e, s) => s.destroy())

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      resolve({
        port: addr.port,
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy()
            server.close(() => done())
          })
      })
    })
  })
}

export type IpEndpoint = { host: string; port: number; tls: boolean; path: string; rejectUnauthorized?: boolean }

/** Layanan cek IP bawaan: {"ip":"1.2.3.4"}. */
export const IPIFY: IpEndpoint = { host: 'api.ipify.org', port: 443, tls: true, path: '/?format=json' }

export type IpResult = { ip: string; ms: number }

/** Cari IP keluar lewat proxy (null = tanpa proxy). */
export async function checkIp(p: ProxyFull | null, endpoint: IpEndpoint = IPIFY, timeoutMs = CONNECT_TIMEOUT): Promise<IpResult> {
  const t0 = Date.now()
  let sock: net.Socket
  let rest: Buffer = Buffer.alloc(0)
  if (p && p.type !== 'direct') {
    ;({ sock, rest } = await connectVia(p, endpoint.host, endpoint.port, timeoutMs))
  } else {
    sock = await withTimeout(rawConnect(endpoint.host, endpoint.port), timeoutMs, null, endpoint.host)
  }
  try {
    if (rest.length) sock.unshift(rest)
    if (endpoint.tls) sock = await withTimeout(tlsWrap(sock, endpoint.host, endpoint.port, endpoint.rejectUnauthorized ?? true), timeoutMs, sock, 'TLS')
    sock.write(`GET ${endpoint.path} HTTP/1.1\r\nHost: ${endpoint.host}\r\nUser-Agent: StockUploader\r\nAccept: application/json, text/plain\r\nConnection: close\r\n\r\n`)
    const body = await withTimeout(
      new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        sock.on('data', (d: Buffer) => chunks.push(d))
        sock.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        sock.once('error', reject)
      }),
      timeoutMs,
      sock,
      'Cek IP'
    )
    const split = body.indexOf('\r\n\r\n')
    const statusLine = body.slice(0, body.indexOf('\r\n'))
    const code = Number(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine)?.[1] ?? 0)
    if (code !== 200) throw new Error(`Layanan cek IP menjawab kode ${code || '?'}.`)
    let text = split >= 0 ? body.slice(split + 4) : ''
    if (/transfer-encoding:\s*chunked/i.test(body.slice(0, split))) text = dechunk(text)
    const ip = extractIp(text)
    if (!ip) throw new Error('Jawaban layanan cek IP tidak berisi alamat IP.')
    return { ip, ms: Date.now() - t0 }
  } finally {
    sock.destroy()
  }
}

function dechunk(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const nl = s.indexOf('\r\n', i)
    if (nl < 0) break
    const size = parseInt(s.slice(i, nl), 16)
    if (!size) break
    out += s.slice(nl + 2, nl + 2 + size)
    i = nl + 2 + size + 2
  }
  return out
}

export function extractIp(text: string): string | null {
  const t = text.trim()
  try {
    const j = JSON.parse(t) as { ip?: unknown }
    if (typeof j.ip === 'string' && net.isIP(j.ip)) return j.ip
  } catch {
    /* bukan JSON */
  }
  if (net.isIP(t)) return t
  const m = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/.exec(t)
  return m && net.isIPv4(m[1]) ? m[1] : null
}
