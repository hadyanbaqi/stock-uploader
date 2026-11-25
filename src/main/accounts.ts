import { isOldFreepikTarget, MAGNIFIC_HOST, MAGNIFIC_PORT } from '../shared/magnific'
import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Account, AccountInput } from '../shared/types'

/** Bentuk yang disimpan di disk: password hanya dalam bentuk terenkripsi. */
type StoredAccount = Omit<Account, 'hasPassword'> & { passwordEnc: string | null }
type StoreFile = { version: 1; accounts: StoredAccount[] }

const storePath = () => path.join(app.getPath('userData'), 'accounts.json')

let cache: StoreFile | null = null

async function load(): Promise<StoreFile> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(storePath(), 'utf8')
    const parsed = JSON.parse(raw) as StoreFile
    cache = { version: 1, accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [] }
    // Freepik pindah ke Magnific: FTP port 21 mati, sekarang sFTP uploads.magnific.com:60022.
    for (const acc of cache.accounts) {
      if (acc.agency === 'freepik' && isOldFreepikTarget(acc)) {
        acc.protocol = 'sftp'
        acc.host = MAGNIFIC_HOST
        acc.port = MAGNIFIC_PORT
        acc.allowInvalidCert = false
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    cache = { version: 1, accounts: [] }
  }
  return cache
}

/** Tulis ke file sementara lalu ganti nama, supaya file tidak rusak kalau aplikasi tertutup di tengah jalan. */
async function persist(data: StoreFile): Promise<void> {
  const file = storePath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, file)
  cache = data
}

export function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

function encrypt(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Brankas password sistem tidak tersedia, password tidak bisa disimpan dengan aman.')
  }
  return safeStorage.encryptString(plain).toString('base64')
}

function decrypt(enc: string): string {
  return safeStorage.decryptString(Buffer.from(enc, 'base64'))
}

function toPublic(a: StoredAccount): Account {
  const { passwordEnc, ...rest } = a
  return { ...rest, hasPassword: Boolean(passwordEnc) }
}

function clean(input: AccountInput) {
  const name = input.name.trim()
  const host = input.host.trim().replace(/^(s?ftps?):\/\//i, '').replace(/\/+$/, '')
  if (!name) throw new Error('Nama panggilan akun wajib diisi.')
  if (!host) throw new Error('Host server wajib diisi.')
  if (!input.username.trim()) throw new Error('Username wajib diisi.')
  const port = Number(input.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port harus angka 1 sampai 65535.')
  return {
    name,
    agency: input.agency,
    protocol: input.protocol,
    host,
    port,
    username: input.username.trim(),
    remoteDir: input.remoteDir.trim(),
    color: input.color,
    enabled: input.enabled,
    allowInvalidCert: input.protocol === 'ftps' ? input.allowInvalidCert : false
  }
}

export async function listAccounts(): Promise<Account[]> {
  const data = await load()
  return data.accounts.map(toPublic)
}

export async function saveAccount(input: AccountInput): Promise<Account> {
  const data = await load()
  const fields = clean(input)
  const now = new Date().toISOString()
  const accounts = [...data.accounts]
  const idx = input.id ? accounts.findIndex((a) => a.id === input.id) : -1

  const duplicate = accounts.find(
    (a, i) => i !== idx && a.name.toLowerCase() === fields.name.toLowerCase()
  )
  if (duplicate) throw new Error(`Nama "${fields.name}" sudah dipakai akun lain. Pakai nama panggilan yang berbeda.`)

  let saved: StoredAccount
  if (idx >= 0) {
    const prev = accounts[idx]
    saved = {
      ...prev,
      ...fields,
      passwordEnc: input.password ? encrypt(input.password) : prev.passwordEnc,
      updatedAt: now
    }
    accounts[idx] = saved
  } else {
    if (!input.password) throw new Error('Password wajib diisi untuk akun baru.')
    saved = {
      id: randomUUID(),
      ...fields,
      passwordEnc: encrypt(input.password),
      createdAt: now,
      updatedAt: now
    }
    accounts.push(saved)
  }
  await persist({ version: 1, accounts })
  return toPublic(saved)
}

export async function deleteAccount(id: string): Promise<void> {
  const data = await load()
  await persist({ version: 1, accounts: data.accounts.filter((a) => a.id !== id) })
}

/** Password asli hanya dipakai di proses utama, untuk koneksi. */
export async function getPassword(id: string): Promise<string | null> {
  const data = await load()
  const acc = data.accounts.find((a) => a.id === id)
  if (!acc?.passwordEnc) return null
  return decrypt(acc.passwordEnc)
}

/** Cadangan daftar akun TANPA password, untuk pindah ke komputer baru. */
export async function exportAccountsJson(): Promise<string> {
  const data = await load()
  const accounts = data.accounts.map(({ passwordEnc: _p, id: _i, createdAt: _c, updatedAt: _u, ...rest }) => rest)
  return JSON.stringify({ app: 'Stock Uploader', version: 1, note: 'Tanpa password. Isi password lagi setelah impor.', accounts }, null, 2)
}

/** Impor cadangan: akun masuk tanpa password (perlu diisi lagi). Nama yang sudah ada dilewati. */
export async function importAccountsJson(text: string): Promise<{ added: number; skipped: number }> {
  let parsed: { accounts?: Partial<AccountInput>[] }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('File bukan cadangan akun Stock Uploader.')
  }
  if (!Array.isArray(parsed.accounts)) throw new Error('File bukan cadangan akun Stock Uploader.')
  const data = await load()
  const accounts = [...data.accounts]
  const now = new Date().toISOString()
  let added = 0
  let skipped = 0
  for (const a of parsed.accounts) {
    try {
      const fields = clean({
        name: String(a.name ?? ''),
        agency: String(a.agency ?? 'other'),
        protocol: (['ftp', 'ftps', 'sftp'].includes(String(a.protocol)) ? a.protocol : 'ftp') as AccountInput['protocol'],
        host: String(a.host ?? ''),
        port: Number(a.port ?? 21),
        username: String(a.username ?? ''),
        remoteDir: String(a.remoteDir ?? ''),
        color: /^#[0-9a-f]{6}$/i.test(String(a.color)) ? String(a.color) : '#2563eb',
        enabled: a.enabled !== false,
        allowInvalidCert: Boolean(a.allowInvalidCert)
      })
      if (accounts.some((x) => x.name.toLowerCase() === fields.name.toLowerCase())) {
        skipped++
        continue
      }
      accounts.push({ id: randomUUID(), ...fields, passwordEnc: null, createdAt: now, updatedAt: now })
      added++
    } catch {
      skipped++
    }
  }
  await persist({ version: 1, accounts })
  return { added, skipped }
}
