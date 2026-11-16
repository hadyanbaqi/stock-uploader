/**
 * Profil browser: simpan daftar profil + grup, buka Chrome per profil (folder data sendiri,
 * proxy lewat perantara lokal), lacak yang sedang terbuka, dan cek IP keluar.
 */
import { app, safeStorage } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  cleanStartUrls,
  DIRECT,
  proxyKey,
  type BrowserProfile,
  type IpStatus,
  type OpenResult,
  type ProfileGroup,
  type ProfileInput,
  type ProfilesState,
  type ProxyConfig,
  type ProxyFull
} from '../shared/profiles'
import { buildArgs, findBrowser } from './browserlaunch'
import { checkIp, startRelay, type Relay } from './proxyrelay'
import { getSettings } from './store'

type StoredProfile = Omit<BrowserProfile, 'hasProxyPassword'> & { proxyPasswordEnc: string | null }
type StoreFile = { version: 1; profiles: StoredProfile[]; groups: ProfileGroup[] }

type Running = { child: ChildProcess; relay: Relay | null; startedAt: number }

const storePath = () => path.join(app.getPath('userData'), 'profiles.json')
export const profilesRoot = () => path.join(app.getPath('userData'), 'browser-profiles')
export const profileDir = (id: string) => path.join(profilesRoot(), id)

function encrypt(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Brankas password sistem tidak tersedia, password proxy tidak bisa disimpan dengan aman.')
  return safeStorage.encryptString(plain).toString('base64')
}

function decrypt(enc: string | null): string {
  if (!enc) return ''
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    throw new Error('Password proxy tidak bisa dibuka (mungkin disimpan di komputer lain). Isi ulang lewat Ubah.')
  }
}

function toPublic(p: StoredProfile): BrowserProfile {
  const { proxyPasswordEnc, ...rest } = p
  return { ...rest, hasProxyPassword: Boolean(proxyPasswordEnc) }
}

function cleanProxy(p: ProxyConfig): ProxyConfig {
  if (!p || p.type === 'direct') return { ...DIRECT }
  if (!['http', 'https', 'socks5'].includes(p.type)) throw new Error('Jenis proxy tidak dikenal.')
  const host = String(p.host ?? '').trim().replace(/^[a-z0-9]+:\/\//i, '').replace(/\/+$/, '')
  if (!host || !/^[a-z0-9.:\[\]-]+$/i.test(host)) throw new Error('Host proxy wajib diisi dengan benar.')
  const port = Number(p.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port proxy harus angka 1 sampai 65535.')
  return { type: p.type, host, port, username: String(p.username ?? '').trim() }
}

const GROUP_LIMIT = 200

export class ProfileManager {
  private data: StoreFile | null = null
  private running = new Map<string, Running>()
  private testing = new Set<string>()
  private browserPath: string | null = null

  constructor(
    private readonly emit: (state: ProfilesState) => void,
    private readonly notice: (text: string) => void
  ) {}

  private async load(): Promise<StoreFile> {
    if (this.data) return this.data
    try {
      const parsed = JSON.parse(await fs.readFile(storePath(), 'utf8')) as Partial<StoreFile>
      this.data = {
        version: 1,
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
        groups: Array.isArray(parsed.groups) ? parsed.groups : []
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      this.data = { version: 1, profiles: [], groups: [] }
    }
    return this.data
  }

  private async persist(next: StoreFile): Promise<void> {
    const file = storePath()
    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
    await fs.rename(tmp, file)
    this.data = next
    void this.broadcast()
  }

  async state(): Promise<ProfilesState> {
    const d = await this.load()
    this.browserPath = findBrowser((await getSettings()).browserPath ?? '')
    return {
      profiles: d.profiles.map(toPublic),
      groups: d.groups,
      running: [...this.running.keys()],
      testing: [...this.testing],
      browserPath: this.browserPath
    }
  }

  private async broadcast(): Promise<void> {
    this.emit(await this.state())
  }

  // ---------- Profil ----------

  async save(input: ProfileInput): Promise<BrowserProfile> {
    const d = await this.load()
    const name = String(input.name ?? '').trim()
    if (!name) throw new Error('Nama profil wajib diisi.')
    const profiles = [...d.profiles]
    const idx = input.id ? profiles.findIndex((p) => p.id === input.id) : -1
    if (input.id && idx < 0) throw new Error('Profil tidak ditemukan.')
    if (profiles.some((p, i) => i !== idx && p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Nama "${name}" sudah dipakai profil lain.`)
    }
    const groupId = input.groupId && d.groups.some((g) => g.id === input.groupId) ? input.groupId : null
    const proxy = cleanProxy(input.proxy)
    const startUrls = cleanStartUrls(Array.isArray(input.startUrls) ? input.startUrls.map(String) : [])
    const now = new Date().toISOString()
    const newPw = String(input.proxyPassword ?? '')

    let saved: StoredProfile
    if (idx >= 0) {
      const prev = profiles[idx]
      let enc = prev.proxyPasswordEnc
      if (proxy.type === 'direct' || input.clearProxyPassword) enc = null
      else if (newPw) enc = encrypt(newPw)
      const changed = proxyKey(prev.proxy) !== proxyKey(proxy) || enc !== prev.proxyPasswordEnc
      const ipStatus: IpStatus = changed
        ? prev.ipStatus.state === 'untested'
          ? { state: 'untested' }
          : { ...prev.ipStatus, state: 'changed', error: undefined }
        : prev.ipStatus
      saved = { ...prev, name, notes: String(input.notes ?? ''), color: String(input.color ?? prev.color), groupId, startUrls, proxy, proxyPasswordEnc: enc, ipStatus, updatedAt: now }
      profiles[idx] = saved
    } else {
      saved = {
        id: randomUUID(),
        name,
        notes: String(input.notes ?? ''),
        color: String(input.color || '#4f8bff'),
        groupId,
        startUrls,
        proxy,
        proxyPasswordEnc: proxy.type !== 'direct' && newPw ? encrypt(newPw) : null,
        ipStatus: { state: 'untested' },
        createdAt: now,
        updatedAt: now
      }
      profiles.push(saved)
    }
    await this.persist({ ...d, profiles })
    return toPublic(saved)
  }

  async duplicate(id: string): Promise<BrowserProfile> {
    const d = await this.load()
    const src = d.profiles.find((p) => p.id === id)
    if (!src) throw new Error('Profil tidak ditemukan.')
    const taken = new Set(d.profiles.map((p) => p.name.toLowerCase()))
    let name = `${src.name} (salinan)`
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${src.name} (salinan ${n})`
    const now = new Date().toISOString()
    // Hanya setelan yang disalin; login/cookie tidak (folder data baru dan kosong).
    const copy: StoredProfile = { ...src, id: randomUUID(), name, ipStatus: { state: 'untested' }, createdAt: now, updatedAt: now, lastOpenedAt: undefined }
    await this.persist({ ...d, profiles: [...d.profiles, copy] })
    return toPublic(copy)
  }

  /** Hapus profil. `deleteData` = folder data Chrome (login, cookie) ikut dihapus. */
  async remove(ids: string[], deleteData: boolean): Promise<void> {
    const d = await this.load()
    const set = new Set(ids)
    const busy = ids.filter((id) => this.running.has(id))
    if (busy.length) throw new Error('Tutup dulu Chrome profil yang mau dihapus.')
    if (deleteData) {
      for (const id of set) await fs.rm(profileDir(id), { recursive: true, force: true })
    }
    await this.persist({ ...d, profiles: d.profiles.filter((p) => !set.has(p.id)) })
  }

  // ---------- Grup ----------

  async saveGroup(g: { id?: string; name: string }): Promise<ProfileGroup> {
    const d = await this.load()
    const name = String(g.name ?? '').trim()
    if (!name) throw new Error('Nama grup wajib diisi.')
    const groups = [...d.groups]
    const idx = g.id ? groups.findIndex((x) => x.id === g.id) : -1
    if (groups.some((x, i) => i !== idx && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`Grup "${name}" sudah ada.`)
    let saved: ProfileGroup
    if (idx >= 0) {
      saved = { ...groups[idx], name }
      groups[idx] = saved
    } else {
      if (groups.length >= GROUP_LIMIT) throw new Error('Grup terlalu banyak.')
      saved = { id: randomUUID(), name }
      groups.push(saved)
    }
    await this.persist({ ...d, groups })
    return saved
  }

  /** Hapus grup; profilnya tidak ikut terhapus, hanya jadi "Tanpa grup". */
  async removeGroup(id: string): Promise<void> {
    const d = await this.load()
    await this.persist({
      ...d,
      groups: d.groups.filter((g) => g.id !== id),
      profiles: d.profiles.map((p) => (p.groupId === id ? { ...p, groupId: null } : p))
    })
  }

  async moveToGroup(ids: string[], groupId: string | null): Promise<void> {
    const d = await this.load()
    const gid = groupId && d.groups.some((g) => g.id === groupId) ? groupId : null
    const set = new Set(ids)
    await this.persist({ ...d, profiles: d.profiles.map((p) => (set.has(p.id) ? { ...p, groupId: gid } : p)) })
  }

  // ---------- Proxy & IP ----------

  private fullProxy(p: StoredProfile): ProxyFull | null {
    if (p.proxy.type === 'direct') return null
    return { ...p.proxy, password: decrypt(p.proxyPasswordEnc) }
  }

  private async setStatus(id: string, status: IpStatus): Promise<void> {
    const d = await this.load()
    await this.persist({ ...d, profiles: d.profiles.map((p) => (p.id === id ? { ...p, ipStatus: status } : p)) })
  }

  /** Tes satu profil. Hasilnya juga disimpan sebagai status profil. */
  async testOne(id: string): Promise<IpStatus> {
    const d = await this.load()
    const p = d.profiles.find((x) => x.id === id)
    if (!p) throw new Error('Profil tidak ditemukan.')
    this.testing.add(id)
    void this.broadcast()
    let status: IpStatus
    try {
      const r = await checkIp(this.fullProxy(p))
      status = { state: 'ok', ip: r.ip, ms: r.ms, at: new Date().toISOString() }
    } catch (e) {
      status = { state: 'fail', error: (e as Error).message, at: new Date().toISOString() }
    } finally {
      this.testing.delete(id)
    }
    await this.setStatus(id, status)
    return status
  }

  /** Tes proxy dari formulir sebelum disimpan. Password kosong = pakai password tersimpan profil itu. */
  async testInput(input: ProfileInput): Promise<IpStatus> {
    const proxy = cleanProxy(input.proxy)
    let password = String(input.proxyPassword ?? '')
    if (!password && !input.clearProxyPassword && input.id && proxy.type !== 'direct') {
      const prev = (await this.load()).profiles.find((p) => p.id === input.id)
      password = decrypt(prev?.proxyPasswordEnc ?? null)
    }
    try {
      const r = await checkIp(proxy.type === 'direct' ? null : { ...proxy, password })
      return { state: 'ok', ip: r.ip, ms: r.ms, at: new Date().toISOString() }
    } catch (e) {
      return { state: 'fail', error: (e as Error).message, at: new Date().toISOString() }
    }
  }

  /** Tes banyak profil, paling banyak 4 bersamaan. */
  async test(ids: string[]): Promise<void> {
    const queue = [...new Set(ids)]
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) await this.testOne(id).catch(() => undefined)
    }
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker))
  }

  // ---------- Buka / tutup Chrome ----------

  private async openOne(id: string): Promise<OpenResult> {
    const settings = await getSettings()
    const browser = findBrowser(settings.browserPath ?? '')
    if (!browser) return { id, ok: false, message: 'Chrome tidak ditemukan. Pilih lokasinya di pengaturan profil.' }
    const d = await this.load()
    const p = d.profiles.find((x) => x.id === id)
    if (!p) return { id, ok: false, message: 'Profil tidak ditemukan.' }
    const dir = profileDir(id)

    const live = this.running.get(id)
    if (live) {
      // Sudah terbuka: menjalankan Chrome lagi dengan folder yang sama hanya membuka jendela baru di Chrome itu.
      spawn(browser, buildArgs({ userDataDir: dir, proxyUrl: live.relay?.url ?? null, startUrls: [] }), { stdio: 'ignore', detached: false }).on('error', () => undefined)
      return { id, ok: true, message: `${p.name}: sudah terbuka, jendela baru dibuka di Chrome-nya.` }
    }

    let proxy: ProxyFull | null
    try {
      proxy = this.fullProxy(p)
    } catch (e) {
      return { id, ok: false, message: `${p.name}: ${(e as Error).message}` }
    }

    if (proxy && settings.browserTestFirst !== false) {
      const st = await this.testOne(id)
      if (st.state !== 'ok') {
        return { id, ok: false, message: `${p.name}: tidak dibuka karena proxy gagal (${st.error ?? 'tidak diketahui'}). IP asli tidak dipakai.` }
      }
    }

    let relay: Relay | null = null
    if (proxy) relay = await startRelay(proxy)
    await fs.mkdir(dir, { recursive: true })

    const child = spawn(browser, buildArgs({ userDataDir: dir, proxyUrl: relay?.url ?? null, startUrls: p.startUrls }), {
      stdio: 'ignore',
      detached: false,
      windowsHide: false
    })
    const startedAt = Date.now()
    const ok = await new Promise<boolean>((resolve) => {
      child.once('spawn', () => resolve(true))
      child.once('error', () => resolve(false))
    })
    if (!ok) {
      await relay?.close()
      return { id, ok: false, message: `${p.name}: Chrome gagal dijalankan dari ${browser}.` }
    }
    this.running.set(id, { child, relay, startedAt })
    child.once('exit', () => {
      const r = this.running.get(id)
      if (r?.child !== child) return
      this.running.delete(id)
      void r.relay?.close()
      if (Date.now() - startedAt < 4000) {
        this.notice(`${p.name}: Chrome langsung tertutup. Kalau profil ini masih terbuka di jendela Chrome lain, tutup dulu lalu buka lagi dari sini.`)
      }
      void this.broadcast()
    })
    const fresh = await this.load()
    await this.persist({ ...fresh, profiles: fresh.profiles.map((x) => (x.id === id ? { ...x, lastOpenedAt: new Date().toISOString() } : x)) })
    return { id, ok: true, message: `${p.name}: dibuka.` }
  }

  /** Buka beberapa profil berurutan dengan jeda supaya komputer tidak berat. */
  async open(ids: string[]): Promise<OpenResult[]> {
    const settings = await getSettings()
    const delay = Math.max(0, Math.min(30, Number(settings.browserDelay ?? 2))) * 1000
    const results: OpenResult[] = []
    const list = [...new Set(ids)]
    for (let i = 0; i < list.length; i++) {
      const wasRunning = this.running.has(list[i])
      const r = await this.openOne(list[i]).catch((e: Error) => ({ id: list[i], ok: false, message: e.message }))
      results.push(r)
      if (r.ok && !wasRunning && i < list.length - 1 && delay) await new Promise((res) => setTimeout(res, delay))
    }
    void this.broadcast()
    return results
  }

  close(ids: string[]): void {
    for (const id of ids) this.running.get(id)?.child.kill()
  }

  runningCount(): number {
    return this.running.size
  }

  /** Saat aplikasi keluar: tutup semua Chrome yang dibuka dari sini dan semua perantara proxy. */
  async shutdown(): Promise<void> {
    const all = [...this.running.values()]
    this.running.clear()
    for (const r of all) r.child.kill()
    await Promise.allSettled(all.map((r) => r.relay?.close()))
  }
}
