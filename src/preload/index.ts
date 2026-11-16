import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api, QueueTask } from '../shared/types'
import type { MetaRecord } from '../shared/metadata'
import type { ProfilesState } from '../shared/profiles'

const api: Api = {
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  saveAccount: (input) => ipcRenderer.invoke('accounts:save', input),
  deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', id),
  testConnection: (input) => ipcRenderer.invoke('accounts:test', input),
  exportAccounts: () => ipcRenderer.invoke('accounts:export'),
  importAccounts: () => ipcRenderer.invoke('accounts:import'),
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
  queueAdd: (paths, accountIds, force) => ipcRenderer.invoke('queue:add', paths, accountIds, force),
  queueAction: (action, ids) => ipcRenderer.invoke('queue:action', action, ids),
  queuePauseAll: (paused) => ipcRenderer.invoke('queue:pauseAll', paused),
  queueClearDone: () => ipcRenderer.invoke('queue:clearDone'),
  onQueueChanged: (cb) => {
    const listener = (_e: unknown, tasks: QueueTask[]) => cb(tasks)
    ipcRenderer.on('queue:changed', listener)
    return () => ipcRenderer.removeListener('queue:changed', listener)
  },

  historyList: () => ipcRenderer.invoke('history:list'),
  historyRemove: (ids) => ipcRenderer.invoke('history:remove', ids),
  historyExport: (ids) => ipcRenderer.invoke('history:export', ids),
  historyCheck: (paths, accountIds) => ipcRenderer.invoke('history:check', paths, accountIds),
  onHistoryChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('history:changed', listener)
    return () => ipcRenderer.removeListener('history:changed', listener)
  },

  metaList: (paths) => ipcRenderer.invoke('meta:list', paths),
  metaUpdate: (path, patch) => ipcRenderer.invoke('meta:update', path, patch),
  metaGenerate: (paths, overwrite) => ipcRenderer.invoke('meta:generate', paths, overwrite),
  metaCancel: () => ipcRenderer.invoke('meta:cancel'),
  metaInject: (paths) => ipcRenderer.invoke('meta:inject', paths),
  metaExportCsv: (paths, agencies) => ipcRenderer.invoke('meta:exportCsv', paths, agencies),
  metaAiFlags: (paths) => ipcRenderer.invoke('meta:aiFlags', paths),
  metaImportCsv: (paths, pick, overwrite) => ipcRenderer.invoke('meta:importCsv', paths, pick, overwrite),
  onMetaRecord: (cb) => {
    const listener = (_e: unknown, r: MetaRecord) => cb(r)
    ipcRenderer.on('meta:record', listener)
    return () => ipcRenderer.removeListener('meta:record', listener)
  },
  showInFolder: (path) => ipcRenderer.invoke('app:showInFolder', path),

  hasAiKey: () => ipcRenderer.invoke('ai:hasKey'),
  setAiKey: (key) => ipcRenderer.invoke('ai:setKey', key),
  testAiKey: (key) => ipcRenderer.invoke('ai:testKey', key),

  onNotice: (cb) => {
    const listener = (_e: unknown, text: string) => cb(text)
    ipcRenderer.on('app:notice', listener)
    return () => ipcRenderer.removeListener('app:notice', listener)
  },
  genModels: () => ipcRenderer.invoke('gen:models'),
  genStart: (input) => ipcRenderer.invoke('gen:start', input),
  genList: () => ipcRenderer.invoke('gen:list'),
  genThumbs: (ids) => ipcRenderer.invoke('gen:thumbs', ids),
  genAction: (action, ids) => ipcRenderer.invoke('gen:action', action, ids),
  genZip: (batchId) => ipcRenderer.invoke('gen:zip', batchId),
  genFull: (id) => ipcRenderer.invoke('gen:full', id),
  genClear: (discard) => ipcRenderer.invoke('gen:clear', discard),
  genPickRef: () => ipcRenderer.invoke('gen:pickRef'),
  genPickDir: () => ipcRenderer.invoke('gen:pickDir'),
  genDefaultDir: () => ipcRenderer.invoke('gen:defaultDir'),
  onGenChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('gen:changed', listener)
    return () => ipcRenderer.removeListener('gen:changed', listener)
  },
  alphaPickFiles: () => ipcRenderer.invoke('alpha:pickFiles'),
  alphaPickFolder: () => ipcRenderer.invoke('alpha:pickFolder'),
  alphaExpand: (paths) => ipcRenderer.invoke('alpha:expand', paths),
  alphaInspect: (paths) => ipcRenderer.invoke('alpha:inspect', paths),
  alphaPreview: (path, opts) => ipcRenderer.invoke('alpha:preview', path, opts),
  alphaRun: (paths, opts) => ipcRenderer.invoke('alpha:run', paths, opts),
  alphaCancel: () => ipcRenderer.invoke('alpha:cancel'),
  alphaPickOut: () => ipcRenderer.invoke('alpha:pickOut'),
  onAlphaProgress: (cb) => {
    const listener = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
    ipcRenderer.on('alpha:progress', listener)
    return () => ipcRenderer.removeListener('alpha:progress', listener)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),

  profilesState: () => ipcRenderer.invoke('profiles:state'),
  profileSave: (input) => ipcRenderer.invoke('profiles:save', input),
  profileDuplicate: (id) => ipcRenderer.invoke('profiles:duplicate', id),
  profileRemove: (ids, deleteData) => ipcRenderer.invoke('profiles:remove', ids, deleteData),
  profileGroupSave: (g) => ipcRenderer.invoke('profiles:groupSave', g),
  profileGroupRemove: (id) => ipcRenderer.invoke('profiles:groupRemove', id),
  profileMove: (ids, groupId) => ipcRenderer.invoke('profiles:move', ids, groupId),
  profileOpen: (ids) => ipcRenderer.invoke('profiles:open', ids),
  profileClose: (ids) => ipcRenderer.invoke('profiles:close', ids),
  profileTest: (ids) => ipcRenderer.invoke('profiles:test', ids),
  profileTestInput: (input) => ipcRenderer.invoke('profiles:testInput', input),
  profileShowFolder: (id) => ipcRenderer.invoke('profiles:showFolder', id),
  pickBrowser: () => ipcRenderer.invoke('profiles:pickBrowser'),
  onProfilesChanged: (cb) => {
    const listener = (_e: unknown, state: ProfilesState) => cb(state)
    ipcRenderer.on('profiles:changed', listener)
    return () => ipcRenderer.removeListener('profiles:changed', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
