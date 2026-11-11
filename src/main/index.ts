import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { deleteAccount, encryptionAvailable, getPassword, listAccounts, saveAccount } from './accounts'
import { testConnection } from './connection'
import type { AccountInput } from '../shared/types'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'Stock Uploader',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
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
}

function registerIpc(): void {
  ipcMain.handle('accounts:list', () => listAccounts())
  ipcMain.handle('accounts:save', (_e, input: AccountInput) => saveAccount(input))
  ipcMain.handle('accounts:delete', (_e, id: string) => deleteAccount(id))
  ipcMain.handle('app:encryptionAvailable', () => encryptionAvailable())
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
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
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
