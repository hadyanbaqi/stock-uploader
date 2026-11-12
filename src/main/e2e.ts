import { app, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { saveAccount } from './accounts'
import type { UploadQueue } from './queue'
import type { AccountInput } from '../shared/types'

/**
 * Uji ujung-ke-ujung (hanya jalan kalau SU_E2E diisi, dipakai scripts/test-app.mts):
 * simpan akun uji → masukkan file ke antrean → tangkap layar → tunggu selesai → tulis hasil.
 */
type E2EConfig = { accounts: AccountInput[]; files: string[]; folder: string; out: string; shots: string }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runE2E(configPath: string, win: BrowserWindow, queue: UploadQueue): Promise<void> {
  const cfg = JSON.parse(await fs.readFile(configPath, 'utf8')) as E2EConfig
  const shot = async (name: string) => {
    const img = await win.webContents.capturePage()
    await fs.writeFile(path.join(cfg.shots, `${name}.png`), img.toPNG())
  }
  const result: Record<string, unknown> = {}
  try {
    await new Promise<void>((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', () => r()) : r()))
    const ids: string[] = []
    for (const a of cfg.accounts) ids.push((await saveAccount(a)).id)

    // Lewat jembatan tampilan, sama seperti saat folder diseret.
    result.expanded = await win.webContents.executeJavaScript(
      `window.api.expandPaths(${JSON.stringify([cfg.folder])}).then(r => ({ files: r.files.length, skipped: r.skipped }))`
    )
    await win.webContents.executeJavaScript(`location.hash = 'upload'`)
    await wait(1200)
    await shot('1-upload')

    result.added = await win.webContents.executeJavaScript(
      `window.api.queueAdd(${JSON.stringify(cfg.files)}, ${JSON.stringify(ids)})`
    )
    await win.webContents.executeJavaScript(`location.hash = 'queue'`)
    await wait(2500)
    await shot('2-antrean-berjalan')

    const end = Date.now() + 10 * 60_000
    while (queue.activeCount() > 0 && Date.now() < end) await wait(500)
    await wait(800)
    await shot('3-antrean-selesai')
    result.tasks = queue.list()

    // Cegah dobel: file yang sama ke akun yang sama harus dilewati.
    await wait(500)
    result.readd = await win.webContents.executeJavaScript(
      `window.api.queueAdd(${JSON.stringify(cfg.files)}, ${JSON.stringify(ids)})`
    )
    result.history = await win.webContents.executeJavaScript(`window.api.historyList().then(h => h.length)`)
    await win.webContents.executeJavaScript(`location.hash = 'history'`)
    await wait(1200)
    await shot('4-riwayat')
  } catch (err) {
    result.error = String((err as Error)?.stack ?? err)
  }
  await fs.writeFile(cfg.out, JSON.stringify(result, null, 2))
  app.quit()
}
