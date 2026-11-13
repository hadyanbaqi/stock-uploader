import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AccountGroup, Settings } from '../shared/types'

/** File JSON kecil: baca sekali, tulis atomik (file sementara lalu ganti nama). */
function jsonStore<T>(name: string, fallback: () => T) {
  const file = () => path.join(app.getPath('userData'), name)
  let cache: T | null = null
  return {
    async read(): Promise<T> {
      if (cache) return cache
      try {
        cache = { ...fallback(), ...(JSON.parse(await fs.readFile(file(), 'utf8')) as T) }
      } catch {
        cache = fallback()
      }
      return cache
    },
    async write(data: T): Promise<void> {
      await fs.mkdir(path.dirname(file()), { recursive: true })
      const tmp = `${file()}.tmp`
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
      await fs.rename(tmp, file())
      cache = data
    }
  }
}

const groupsStore = jsonStore<{ groups: AccountGroup[] }>('groups.json', () => ({ groups: [] }))
const settingsStore = jsonStore<Settings>('settings.json', () => ({ perAccount: 2, aiMode: 'hemat', theme: 'dark', markMaster: true, afterDone: 'keep' }))
const secretStore = jsonStore<{ aiKeyEnc?: string }>('secrets.json', () => ({}))

/** API key AI, disimpan terenkripsi lewat brankas sistem seperti password FTP. */
export async function getAiKey(): Promise<string | null> {
  const enc = (await secretStore.read()).aiKeyEnc
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export async function setAiKey(key: string): Promise<void> {
  const k = key.trim()
  if (k && !safeStorage.isEncryptionAvailable()) throw new Error('Brankas password sistem tidak tersedia.')
  await secretStore.write(k ? { aiKeyEnc: safeStorage.encryptString(k).toString('base64') } : {})
}

export async function listGroups(): Promise<AccountGroup[]> {
  return (await groupsStore.read()).groups
}

export async function saveGroup(input: Omit<AccountGroup, 'id'> & { id?: string }): Promise<AccountGroup> {
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('Nama grup wajib diisi.')
  const accountIds = [...new Set((input.accountIds ?? []).map(String))]
  if (!accountIds.length) throw new Error('Pilih minimal satu akun untuk grup.')
  const data = await groupsStore.read()
  if (data.groups.some((g) => g.id !== input.id && g.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Grup "${name}" sudah ada.`)
  }
  const group: AccountGroup = { id: input.id ?? randomUUID(), name, accountIds }
  const groups = input.id ? data.groups.map((g) => (g.id === input.id ? group : g)) : [...data.groups, group]
  await groupsStore.write({ groups })
  return group
}

export async function deleteGroup(id: string): Promise<void> {
  const data = await groupsStore.read()
  await groupsStore.write({ groups: data.groups.filter((g) => g.id !== id) })
}

export async function getSettings(): Promise<Settings> {
  return settingsStore.read()
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await settingsStore.read()
  const next: Settings = { ...cur }
  if (patch.perAccount !== undefined) next.perAccount = Math.max(1, Math.min(5, Math.round(Number(patch.perAccount) || 2)))
  if (patch.aiMode && ['hemat', 'gratis', 'detail'].includes(patch.aiMode)) next.aiMode = patch.aiMode
  if (patch.theme && ['system', 'light', 'dark'].includes(patch.theme)) next.theme = patch.theme
  if (patch.markMaster !== undefined) next.markMaster = Boolean(patch.markMaster)
  if (patch.afterDone && ['keep', 'move', 'trash'].includes(patch.afterDone)) next.afterDone = patch.afterDone
  await settingsStore.write(next)
  return next
}
