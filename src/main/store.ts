import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AccountGroup, Settings } from '../shared/types'
import { UPSCALE_DEFAULTS, UPSCALE_MODELS } from '../shared/upscale'

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
const settingsStore = jsonStore<Settings>('settings.json', () => ({ perAccount: 2, aiMode: 'hemat', theme: 'dark', markMaster: true, afterDone: 'keep', genDir: '', genModel: '', genAspect: '3:2', genAutoZip: true, genClearOnStart: true, browserPath: '', browserDelay: 2, browserTestFirst: true, autoUpdate: true, genUpscale: { ...UPSCALE_DEFAULTS }, upscaleWarned: false }))
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
  if (typeof patch.genDir === 'string') next.genDir = patch.genDir
  if (typeof patch.genModel === 'string') next.genModel = patch.genModel.slice(0, 200)
  if (patch.genAspect && ['16:9', '3:2', '4:3', '1:1', '9:16', '2:3'].includes(patch.genAspect)) next.genAspect = patch.genAspect
  if (patch.genAutoZip !== undefined) next.genAutoZip = Boolean(patch.genAutoZip)
  if (patch.genClearOnStart !== undefined) next.genClearOnStart = Boolean(patch.genClearOnStart)
  if (typeof patch.browserPath === 'string') next.browserPath = patch.browserPath
  if (patch.browserDelay !== undefined) next.browserDelay = Math.max(0, Math.min(30, Math.round(Number(patch.browserDelay) || 0)))
  if (patch.browserTestFirst !== undefined) next.browserTestFirst = Boolean(patch.browserTestFirst)
  if (patch.autoUpdate !== undefined) next.autoUpdate = Boolean(patch.autoUpdate)
  if (patch.upscaleWarned !== undefined) next.upscaleWarned = Boolean(patch.upscaleWarned)
  if (patch.genUpscale) {
    const u = { ...UPSCALE_DEFAULTS, ...(next.genUpscale ?? {}), ...patch.genUpscale }
    const model = u.model in UPSCALE_MODELS ? u.model : UPSCALE_DEFAULTS.model
    next.genUpscale = {
      enabled: Boolean(u.enabled),
      model,
      scale: ([2, 3, 4] as const).includes(u.scale) ? u.scale : 4,
      format: (['jpg', 'png', 'webp'] as const).includes(u.format) ? u.format : 'jpg'
    }
  }
  await settingsStore.write(next)
  return next
}
