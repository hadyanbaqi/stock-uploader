import { app, BrowserWindow, dialog, ipcMain, nativeTheme, powerSaveBlocker, shell } from 'electron'
import path from 'node:path'
import { deleteAccount, encryptionAvailable, exportAccountsJson, getPassword, importAccountsJson, listAccounts, saveAccount } from './accounts'
import { testConnection } from './connection'
import { expandPaths, FILE_KINDS } from './files'
import { History, historyCsv } from './history'
import { UploadQueue } from './queue'
import { deleteGroup, getAiKey, getSettings, listGroups, saveGroup, saveSettings, setAiKey } from './store'
import { aiFlags, cancelGenerate, exportCsv, flushMeta, generate, importFromCsv, inject, listMeta, updateMeta } from './metadata'
import { closeHelper } from './frames'
import { closeExifTool } from './inject'
import { testApiKey } from './ai'
import { AfterUpload } from './afterupload'
import { defaultGenDir, GenQueue } from './genqueue'
import { listImageModels } from './imagegen'
import { cancelRun, expandImages, inspect as alphaInspect, preview as alphaPreview, runAlpha } from './alphajob'
import { imageThumb } from './frames'
import type { FileMeta } from '../shared/metadata'
import type { AccountGroup, AccountInput, AlphaOptions, GenAction, GenStartInput, QueueAction, QueueTask, Settings } from '../shared/types'

let queue: UploadQueue | null = null
let history: History | null = null
let after: AfterUpload | null = null
let gen: GenQueue | null = null
let blocker: number | null = null
let quitting = false

/** Selama ada upload, komputer tidak boleh tidur. */
function updateKeepAwake(tasks: QueueTask[]): void {
  const busy = tasks.some((t) => t.status === 'uploading' || t.status === 'queued' || t.status === 'retrying')
  if (busy && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
  if (!busy && blocker !== null) {
    powerSaveBlocker.stop(blocker)
    blocker = null
  }
}

/** true = boleh keluar. */
function confirmQuit(win?: BrowserWindow): boolean {
  const n = queue?.activeCount() ?? 0
  if (!n) return true
  const opts = {
    type: 'question' as const,
    buttons: ['Keluar', 'Batal'],
    defaultId: 1,
    cancelId: 1,
    message: `Masih ada ${n} upload di antrean.`,
    detail: 'Kalau keluar sekarang, upload berhenti dan otomatis dilanjutkan saat aplikasi dibuka lagi.'
  }
  return (win ? dialog.showMessageBoxSync(win, opts) : dialog.showMessageBoxSync(opts)) === 0
}

function broadcast(tasks: QueueTask[]): void {
  updateKeepAwake(tasks)
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('queue:changed', tasks)
}

async function startQueue(): Promise<UploadQueue> {
  const settings = await getSettings()
  history = new History(path.join(app.getPath('userData'), 'history.jsonl'))
  await history.init()
  const q = new UploadQueue({
    file: path.join(app.getPath('userData'), 'queue.json'),
    perAccount: settings.perAccount,
    onChange: broadcast,
    wasSent: (id, name, size) => history?.wasSent(id, name, size) ?? false,
    onFinished: (t, agency) => {
      after?.finished(t, agency)
      void history
        ?.add({
          fileName: t.fileName,
          filePath: t.filePath,
          size: t.size,
          accountId: t.accountId,
          accountName: t.accountName,
          agency,
          status: t.status === 'done' ? 'done' : 'failed',
          at: Date.now(),
          ms: t.lastAttemptMs,
          error: t.status === 'done' ? undefined : t.error
        })
        .then(() => {
          for (const w of BrowserWindow.getAllWindows()) w.webContents.send('history:changed')
        })
    },
    resolve: async (id) => {
      const acc = (await listAccounts()).find((a) => a.id === id)
      const password = acc ? await getPassword(id) : null
      if (!acc) return null
      if (!password) return null
      return {
        name: acc.name,
        color: acc.color,
        agency: acc.agency,
        target: {
          protocol: acc.protocol,
          host: acc.host,
          port: acc.port,
          username: acc.username,
          password,
          remoteDir: acc.remoteDir,
          allowInvalidCert: acc.allowInvalidCert
        }
      }
    }
  })
  after = new AfterUpload({
    settings: getSettings,
    tasks: () => q.list(),
    trash: (p) => shell.trashItem(p),
    notify: (text) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('app:notice', text)
    }
  })
  await q.init()
  return q
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'Stock Uploader',
    // Ikon jendela saat dijalankan dari kode (installer memakai ikon dari build/icon.png).
    icon: app.isPackaged ? undefined : path.join(__dirname, '../../build/icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#07080b' : '#f5f6f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  // Windows: menutup jendela = keluar, jadi tanya dulu kalau upload masih berjalan.
  // Mac: menutup jendela tidak menghentikan upload; konfirmasi ada saat Quit.
  win.on('close', (e) => {
    if (process.platform === 'darwin' || quitting || process.env.SU_SMOKE) return
    if (confirmQuit(win)) quitting = true
    else e.preventDefault()
  })

  // Link luar dibuka di browser biasa, bukan di dalam aplikasi.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Uji cepat: SU_SMOKE=<file.png> menyimpan tangkapan layar jendela lalu menutup aplikasi.
  const smoke = process.env.SU_SMOKE
  if (smoke) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win.webContents.capturePage()
        await import('node:fs').then((fs) => fs.promises.writeFile(smoke, img.toPNG()))
        app.quit()
      }, 2000)
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

function registerIpc(): void {
  ipcMain.handle('accounts:list', () => listAccounts())
  ipcMain.handle('accounts:save', (_e, input: AccountInput) => saveAccount(input))
  ipcMain.handle('accounts:delete', (_e, id: string) => deleteAccount(id))
  ipcMain.handle('accounts:export', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('documents'), 'cadangan-akun-stock-uploader.json'),
      filters: [{ name: 'Cadangan akun', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return false
    await import('node:fs/promises').then(async (fs) => fs.writeFile(r.filePath!, await exportAccountsJson(), 'utf8'))
    return true
  })
  ipcMain.handle('accounts:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Cadangan akun', extensions: ['json'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const text = await import('node:fs/promises').then((fs) => fs.readFile(r.filePaths[0], 'utf8'))
    return importAccountsJson(text)
  })
  ipcMain.handle('app:encryptionAvailable', () => encryptionAvailable())
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })

  const extFilter = [{ name: 'File stok', extensions: Object.keys(FILE_KINDS) }]
  ipcMain.handle('files:expand', (_e, paths: string[]) => expandPaths(Array.isArray(paths) ? paths.map(String) : []))
  ipcMain.handle('files:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'], filters: extFilter })
    return expandPaths(r.canceled ? [] : r.filePaths)
  })
  ipcMain.handle('files:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'multiSelections'] })
    return expandPaths(r.canceled ? [] : r.filePaths)
  })

  ipcMain.handle('groups:list', () => listGroups())
  ipcMain.handle('groups:save', (_e, g: AccountGroup) => saveGroup(g))
  ipcMain.handle('groups:delete', (_e, id: string) => deleteGroup(String(id)))

  ipcMain.handle('queue:list', () => queue?.list() ?? [])
  ipcMain.handle('queue:add', (_e, paths: string[], accountIds: string[], force?: boolean) =>
    queue!.add(paths.map(String), accountIds.map(String), Boolean(force))
  )

  ipcMain.handle('history:list', () => history?.list() ?? [])
  ipcMain.handle('history:remove', async (_e, ids: string[]) => {
    await history?.remove(ids.map(String))
  })
  ipcMain.handle('history:export', async (e, ids: string[]) => {
    const want = new Set(ids.map(String))
    const rows = (history?.list() ?? []).filter((h) => want.has(h.id)).sort((a, b) => b.at - a.at)
    const win = BrowserWindow.fromWebContents(e.sender)!
    const stamp = new Date().toISOString().slice(0, 10)
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('documents'), `riwayat-upload-${stamp}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (r.canceled || !r.filePath) return false
    await import('node:fs/promises').then((fs) => fs.writeFile(r.filePath!, historyCsv(rows), 'utf8'))
    return true
  })
  ipcMain.handle('history:check', async (_e, paths: string[], accountIds: string[]) => {
    const fs = await import('node:fs/promises')
    const out: { path: string; accountIds: string[] }[] = []
    for (const p of paths.map(String)) {
      let size: number
      try {
        size = (await fs.stat(p)).size
      } catch {
        continue
      }
      const name = path.basename(p)
      const ids = accountIds.map(String).filter((id) => history?.wasSent(id, name, size))
      if (ids.length) out.push({ path: p, accountIds: ids })
    }
    return out
  })
  ipcMain.handle('queue:action', (_e, action: QueueAction, ids: string[]) => {
    if (!['pause', 'resume', 'cancel', 'retry', 'remove'].includes(action)) return
    queue?.action(action, ids.map(String))
  })
  ipcMain.handle('queue:pauseAll', (_e, paused: boolean) => queue?.pauseAll(Boolean(paused)))
  ipcMain.handle('queue:clearDone', () => queue?.clearDone())

  ipcMain.handle('meta:list', (_e, paths: string[]) => listMeta(paths.map(String)))
  ipcMain.handle('meta:update', (_e, p: string, patch: Partial<FileMeta>) => updateMeta(String(p), patch))
  ipcMain.handle('meta:generate', (_e, paths: string[], overwrite: boolean) => generate(paths.map(String), Boolean(overwrite)))
  ipcMain.handle('meta:cancel', () => cancelGenerate())
  ipcMain.handle('meta:inject', (_e, paths: string[]) => inject(paths.map(String)))
  ipcMain.handle('meta:exportCsv', async (e, paths: string[], agencies: string[]) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      title: 'Pilih folder untuk menyimpan CSV',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    return exportCsv(paths.map(String), agencies.map(String), r.filePaths[0])
  })
  ipcMain.handle('meta:aiFlags', (_e, paths: string[]) => aiFlags(paths.map(String)))
  ipcMain.handle('meta:importCsv', async (e, paths: string[], pick: boolean, overwrite: boolean) => {
    let csvFiles: string[] | undefined
    if (pick) {
      const win = BrowserWindow.fromWebContents(e.sender)!
      const r = await dialog.showOpenDialog(win, {
        title: 'Pilih CSV metadata (mis. metadata-master.csv atau adobe-stock.csv)',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (r.canceled || !r.filePaths.length) return null
      csvFiles = r.filePaths
    }
    return importFromCsv(paths.map(String), csvFiles, Boolean(overwrite))
  })
  ipcMain.handle('app:showInFolder', (_e, p: string) => shell.showItemInFolder(String(p)))

  ipcMain.handle('gen:models', async () => {
    const key = await getAiKey()
    if (!key) throw new Error('Isi API key Ciora dulu di halaman Pengaturan.')
    return listImageModels(key)
  })
  ipcMain.handle('gen:start', (_e, input: GenStartInput) =>
    gen!.start({
      prompts: Array.isArray(input?.prompts) ? input.prompts.map(String) : [],
      variants: Number(input?.variants) || 1,
      template: String(input?.template ?? 'none'),
      model: String(input?.model ?? ''),
      aspect: String(input?.aspect ?? '3:2'),
      refPath: input?.refPath ? String(input.refPath) : undefined,
      autoZip: Boolean(input?.autoZip)
    })
  )
  ipcMain.handle('gen:list', () => gen?.list() ?? { jobs: [], batches: [] })
  ipcMain.handle('gen:thumbs', (_e, ids: string[]) => gen?.thumbs(ids.map(String)) ?? {})
  ipcMain.handle('gen:action', (_e, action: GenAction, ids: string[]) => {
    if (!['keep', 'discard', 'retry', 'again', 'cancel'].includes(action)) return
    return gen?.action(action, ids.map(String))
  })
  ipcMain.handle('gen:zip', async (_e, batchId: string) => {
    const r = await gen!.zip(String(batchId))
    shell.showItemInFolder(r.zipPath)
    return r
  })
  ipcMain.handle('gen:full', (_e, id: string) => gen?.full(String(id)) ?? null)
  ipcMain.handle('gen:pickRef', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      title: 'Pilih gambar referensi',
      properties: ['openFile'],
      filters: [{ name: 'Gambar', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const t = await imageThumb(r.filePaths[0], 320)
    return { path: r.filePaths[0], thumb: t.data }
  })
  ipcMain.handle('gen:pickDir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { title: 'Folder simpan gambar', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    await saveSettings({ genDir: r.filePaths[0] })
    return r.filePaths[0]
  })
  ipcMain.handle('gen:defaultDir', () => defaultGenDir())

  const imgFilter = [{ name: 'Gambar', extensions: ['jpg', 'jpeg', 'png'] }]
  ipcMain.handle('alpha:pickFiles', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { title: 'Pilih gambar efek', properties: ['openFile', 'multiSelections'], filters: imgFilter })
    return r.canceled ? [] : expandImages(r.filePaths)
  })
  ipcMain.handle('alpha:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { title: 'Pilih folder render', properties: ['openDirectory', 'multiSelections'] })
    return r.canceled ? [] : expandImages(r.filePaths)
  })
  ipcMain.handle('alpha:expand', (_e, paths: string[]) => expandImages(paths.map(String)))
  ipcMain.handle('alpha:inspect', (_e, paths: string[]) => alphaInspect(paths.map(String)))
  ipcMain.handle('alpha:preview', (_e, p: string, o: AlphaOptions) => alphaPreview(String(p), o))
  ipcMain.handle('alpha:run', async (_e, paths: string[], o: AlphaOptions) => {
    const r = await runAlpha(paths.map(String), o)
    if (r.files) shell.showItemInFolder(r.zipPath ?? r.pngs[0])
    return r
  })
  ipcMain.handle('alpha:cancel', () => cancelRun())
  ipcMain.handle('alpha:pickOut', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { title: 'Folder hasil', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })

  ipcMain.handle('ai:hasKey', async () => Boolean(await getAiKey()))
  ipcMain.handle('ai:setKey', (_e, key: string) => setAiKey(String(key ?? '')))
  ipcMain.handle('ai:testKey', async (_e, key?: string) => {
    const k = key ? String(key).trim() : await getAiKey()
    if (!k) return { ok: false, message: 'API key belum diisi.' }
    return testApiKey(k)
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', async (_e, patch: Partial<Settings>) => {
    const s = await saveSettings(patch)
    queue?.setPerAccount(s.perAccount)
    nativeTheme.themeSource = s.theme
    return s
  })

  ipcMain.handle('accounts:test', async (_e, input: AccountInput) => {
    // Password dari formulir dipakai kalau diisi; kalau kosong, pakai password tersimpan.
    let password = input.password ?? ''
    if (!password && input.id) password = (await getPassword(input.id)) ?? ''
    if (!password) return { ok: false, message: 'Isi password dulu untuk tes koneksi.', ms: 0 }
    return testConnection({
      protocol: input.protocol,
      host: input.host.trim().replace(/^(s?ftps?):\/\//i, '').replace(/\/+$/, ''),
      port: Number(input.port),
      username: input.username.trim(),
      password,
      remoteDir: input.remoteDir.trim(),
      allowInvalidCert: input.allowInvalidCert
    })
  })
}

// Folder data terpisah untuk uji, supaya data asli tidak tersentuh.
if (process.env.SU_USERDATA) app.setPath('userData', process.env.SU_USERDATA)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    if (process.env.SU_SELFTEST) {
      // Uji simpan → enkripsi → baca ulang password, di folder data uji.
      const { readFile } = await import('node:fs/promises')
      const secret = `uji-${Date.now()}`
      const acc = await saveAccount({
        name: 'Uji enkripsi', agency: 'other', protocol: 'ftp', host: '127.0.0.1', port: 21,
        username: 'uji', password: secret, remoteDir: '', color: '#2563eb', enabled: true, allowInvalidCert: false
      })
      const file = await readFile(path.join(app.getPath('userData'), 'accounts.json'), 'utf8')
      const back = await getPassword(acc.id)
      await saveAccount({ ...acc, name: 'Uji enkripsi 2', password: '' })
      const kept = await getPassword(acc.id)
      await deleteAccount(acc.id)
      console.log(JSON.stringify({
        encryption: encryptionAvailable(),
        plainTextInFile: file.includes(secret),
        decryptedMatches: back === secret,
        keptAfterEditWithoutPassword: kept === secret,
        deleted: (await listAccounts()).length === 0
      }))
      app.quit()
      return
    }
    nativeTheme.themeSource = (await getSettings()).theme
    queue = await startQueue()
    gen = new GenQueue((text) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('app:notice', text)
    })
    await gen.init()
    registerIpc()
    const win = createWindow()
    if (process.env.SU_E2E) {
      quitting = true
      void import('./e2e').then((m) => m.runE2E(process.env.SU_E2E!, win, queue!))
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Simpan antrean sebelum keluar.
  app.on('before-quit', (e) => {
    if (!queue) return
    if (!quitting && !process.env.SU_SMOKE && !confirmQuit(BrowserWindow.getAllWindows()[0])) {
      e.preventDefault()
      return
    }
    quitting = true
    const q = queue
    queue = null
    e.preventDefault()
    closeHelper()
    void Promise.allSettled([q.shutdown().then(() => after?.flush()), gen?.shutdown(), flushMeta(), closeExifTool()]).finally(() => app.quit())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
