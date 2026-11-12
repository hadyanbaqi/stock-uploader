import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api, QueueTask } from '../shared/types'

const api: Api = {
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  saveAccount: (input) => ipcRenderer.invoke('accounts:save', input),
  deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', id),
  testConnection: (input) => ipcRenderer.invoke('accounts:test', input),
  encryptionAvailable: () => ipcRenderer.invoke('app:encryptionAvailable'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  pathForFile: (file) => webUtils.getPathForFile(file),
  expandPaths: (paths) => ipcRenderer.invoke('files:expand', paths),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  pickFolder: () => ipcRenderer.invoke('files:pickFolder'),

  listGroups: () => ipcRenderer.invoke('groups:list'),
  saveGroup: (g) => ipcRenderer.invoke('groups:save', g),
  deleteGroup: (id) => ipcRenderer.invoke('groups:delete', id),

  queueList: () => ipcRenderer.invoke('queue:list'),
  queueAdd: (paths, accountIds) => ipcRenderer.invoke('queue:add', paths, accountIds),
  queueAction: (action, ids) => ipcRenderer.invoke('queue:action', action, ids),
  queuePauseAll: (paused) => ipcRenderer.invoke('queue:pauseAll', paused),
  queueClearDone: () => ipcRenderer.invoke('queue:clearDone'),
  onQueueChanged: (cb) => {
    const listener = (_e: unknown, tasks: QueueTask[]) => cb(tasks)
    ipcRenderer.on('queue:changed', listener)
    return () => ipcRenderer.removeListener('queue:changed', listener)
  },

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s)
}

contextBridge.exposeInMainWorld('api', api)
