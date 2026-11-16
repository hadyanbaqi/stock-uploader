/**
 * Profil browser: satu profil = satu folder data Chrome sendiri (login, cookie, ekstensi terpisah),
 * dengan proxy dan halaman awal sendiri. Bagian ini dipakai oleh proses utama dan tampilan.
 */

export type ProxyType = 'direct' | 'http' | 'https' | 'socks5'

export const PROXY_LABEL: Record<ProxyType, string> = {
  direct: 'Tanpa proxy (DIRECT)',
  http: 'HTTP',
  https: 'HTTPS',
  socks5: 'SOCKS5'
}

/** Proxy tanpa password (password disimpan terpisah, terenkripsi). */
export type ProxyConfig = {
  type: ProxyType
  host: string
  port: number
  username: string
}

/** Proxy lengkap, hanya dipakai di proses utama. */
export type ProxyFull = ProxyConfig & { password: string }

export type IpState = 'untested' | 'ok' | 'fail' | 'changed'

export type IpStatus = {
  state: IpState
  ip?: string
  ms?: number
  /** ISO waktu tes terakhir. */
  at?: string
  error?: string
}

export type BrowserProfile = {
  id: string
  name: string
  notes: string
  color: string
  /** null = tanpa grup. */
  groupId: string | null
  /** Halaman yang dibuka saat profil dijalankan (boleh kosong). */
  startUrls: string[]
  proxy: ProxyConfig
  hasProxyPassword: boolean
  ipStatus: IpStatus
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string
}

/**
 * Data dari formulir. `proxyPassword` kosong saat edit = password lama tetap dipakai,
 * kecuali `clearProxyPassword` dicentang.
 */
export type ProfileInput = Pick<BrowserProfile, 'name' | 'notes' | 'color' | 'groupId' | 'startUrls' | 'proxy'> & {
  id?: string
  proxyPassword?: string
  clearProxyPassword?: boolean
}

export type ProfileGroup = { id: string; name: string }

export type ProfilesState = {
  profiles: BrowserProfile[]
  groups: ProfileGroup[]
  /** id profil yang Chrome-nya sedang terbuka dari aplikasi ini. */
  running: string[]
  /** id profil yang sedang dites IP-nya. */
  testing: string[]
  /** Lokasi Chrome yang dipakai, null kalau tidak ditemukan. */
  browserPath: string | null
}

export type OpenResult = { id: string; ok: boolean; message: string }

export const DIRECT: ProxyConfig = { type: 'direct', host: '', port: 0, username: '' }

const DEFAULT_PORT: Record<Exclude<ProxyType, 'direct'>, number> = { http: 80, https: 443, socks5: 1080 }

export type ParsedProxy = { ok: true; proxy: ProxyFull } | { ok: false; error: string }

function validPort(p: string): number | null {
  if (!/^\d{1,5}$/.test(p)) return null
  const n = Number(p)
  return n >= 1 && n <= 65535 ? n : null
}

function looksLikeHost(h: string): boolean {
  return /^[a-z0-9.-]+$/i.test(h) && /[a-z0-9]/i.test(h) && !h.startsWith('.') && !h.endsWith('.')
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * Baca proxy dari teks yang ditempel. Bentuk yang dikenali:
 *   (kosong) / direct
 *   host:port
 *   host:port:user:pass            (format penjual proxy; password boleh berisi ":")
 *   user:pass@host:port
 *   host:port@user:pass
 *   http://user:pass@host:port     (juga https://, socks5://, socks5h://, socks://)
 * Tanpa skema dianggap HTTP, kecuali `defaultType` diberikan.
 */
export function parseProxy(text: string, defaultType: Exclude<ProxyType, 'direct'> = 'http'): ParsedProxy {
  let s = text.trim()
  if (!s || /^direct(:\/\/)?$/i.test(s)) return { ok: true, proxy: { ...DIRECT, password: '' } }

  let type: Exclude<ProxyType, 'direct'> = defaultType
  const scheme = /^([a-z0-9]+):\/\//i.exec(s)
  if (scheme) {
    const sc = scheme[1].toLowerCase()
    if (sc === 'http') type = 'http'
    else if (sc === 'https') type = 'https'
    else if (sc === 'socks5' || sc === 'socks5h' || sc === 'socks') type = 'socks5'
    else if (sc === 'socks4' || sc === 'socks4a') return { ok: false, error: 'SOCKS4 tidak didukung. Pakai HTTP atau SOCKS5.' }
    else return { ok: false, error: `Jenis proxy "${sc}" tidak dikenal. Pakai http://, https:// atau socks5://.` }
    s = s.slice(scheme[0].length)
  }
  s = s.replace(/\/+$/, '')

  let hostPart = s
  let user = ''
  let pass = ''
  const at = s.lastIndexOf('@')
  if (at >= 0) {
    const left = s.slice(0, at)
    const right = s.slice(at + 1)
    // user:pass@host:port atau host:port@user:pass
    const rightHostPort = /^([^:]+):(\d{1,5})$/.exec(right)
    const leftHostPort = /^([^:]+):(\d{1,5})$/.exec(left)
    if (rightHostPort && looksLikeHost(rightHostPort[1])) {
      hostPart = right
      const c = left.indexOf(':')
      user = c >= 0 ? left.slice(0, c) : left
      pass = c >= 0 ? left.slice(c + 1) : ''
    } else if (leftHostPort && looksLikeHost(leftHostPort[1])) {
      hostPart = left
      const c = right.indexOf(':')
      user = c >= 0 ? right.slice(0, c) : right
      pass = c >= 0 ? right.slice(c + 1) : ''
    } else {
      return { ok: false, error: 'Bentuk proxy tidak dikenali. Contoh: host:port:user:pass atau http://user:pass@host:port' }
    }
    user = safeDecode(user)
    pass = safeDecode(pass)
  }

  const parts = hostPart.split(':')
  if (parts.length < 2) {
    return { ok: false, error: 'Port proxy belum ada. Contoh: 142.111.126.243:6070' }
  }
  const host = parts[0].trim()
  const port = validPort(parts[1].trim())
  if (!host || !looksLikeHost(host)) return { ok: false, error: `Host proxy "${host}" tidak valid.` }
  if (port === null) return { ok: false, error: `Port proxy "${parts[1]}" harus angka 1 sampai 65535.` }
  if (parts.length > 2) {
    if (at >= 0) return { ok: false, error: 'Bentuk proxy tidak dikenali. Contoh: host:port:user:pass' }
    user = parts[2]
    pass = parts.slice(3).join(':')
  }
  if (!user && pass) return { ok: false, error: 'Password proxy ada, tapi username kosong.' }
  return { ok: true, proxy: { type, host, port, username: user, password: pass } }
}

export function defaultProxyPort(type: ProxyType): number {
  return type === 'direct' ? 0 : DEFAULT_PORT[type]
}

/** Teks proxy untuk tabel, password selalu disamarkan. */
export function maskProxy(p: ProxyConfig, hasPassword: boolean): string {
  if (p.type === 'direct') return 'DIRECT'
  const auth = p.username ? `${p.username}${hasPassword ? ':***' : ''}@` : ''
  return `${p.type}://${auth}${p.host}:${p.port}`
}

/** Kunci untuk mendeteksi proxy berubah (tanpa password; password dicek terpisah). */
export function proxyKey(p: ProxyConfig): string {
  return p.type === 'direct' ? 'direct' : `${p.type}|${p.host.toLowerCase()}|${p.port}|${p.username}`
}

/** Rapikan daftar halaman awal: satu per baris, tambahkan https:// kalau belum ada. */
export function cleanStartUrls(list: string[]): string[] {
  const out: string[] = []
  for (const raw of list) {
    const u = raw.trim()
    if (!u) continue
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`
    let parsed: URL
    try {
      parsed = new URL(withScheme)
    } catch {
      throw new Error(`Alamat "${u}" tidak valid.`)
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`Alamat "${u}" harus http:// atau https://.`)
    if (!out.includes(parsed.href)) out.push(parsed.href)
  }
  return out
}

/** Halaman kontributor agensi untuk tombol cepat di formulir. */
export const START_PRESETS: { label: string; url: string }[] = [
  { label: 'Adobe Stock', url: 'https://contributor.stock.adobe.com/' },
  { label: 'Shutterstock', url: 'https://submit.shutterstock.com/' },
  { label: 'Freepik', url: 'https://contributor.freepik.com/' },
  { label: 'Vecteezy', url: 'https://www.vecteezy.com/' },
  { label: 'Dreamstime', url: 'https://www.dreamstime.com/' },
  { label: '123RF', url: 'https://www.123rf.com/' },
  { label: 'Pond5', url: 'https://www.pond5.com/' },
  { label: 'Cek IP', url: 'https://api.ipify.org/' }
]
