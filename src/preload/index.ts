import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/types'

const api: Api = {
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  saveAccount: (input) => ipcRenderer.invoke('accounts:save', input),
  deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', id),
  testConnection: (input) => ipcRenderer.invoke('accounts:test', input),
  encryptionAvailable: () => ipcRenderer.invoke('app:encryptionAvailable'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
}

contextBridge.exposeInMainWorld('api', api)
