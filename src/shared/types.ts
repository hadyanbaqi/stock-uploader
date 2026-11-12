import type { AiMode, FileMeta, MetaRecord } from './metadata'

export type Protocol = 'ftp' | 'ftps' | 'sftp'

/** Akun seperti yang dilihat tampilan: password tidak pernah dikirim ke tampilan. */
export type Account = {
  id: string
  name: string
  agency: string
  protocol: Protocol
  host: string
  port: number
  username: string
  remoteDir: string
  color: string
  enabled: boolean
  allowInvalidCert: boolean
  hasPassword: boolean
  createdAt: string
  updatedAt: string
}

/** Data dari formulir. `password` kosong saat edit = password lama dipakai. */
export type AccountInput = Omit<Account, 'id' | 'hasPassword' | 'createdAt' | 'updatedAt'> & {
  id?: string
  password?: string
}

export type TestResult = {
  ok: boolean
  message: string
  detail?: string
  ms: number
}

export type AgencyPreset = {
  key: string
  name: string
  protocol: Protocol
  host: string
  port: number
  loginHint: string
  note?: string
  helpUrl?: string
}

/** File yang dipilih untuk diupload. */
export type FileKind = 'video' | 'image' | 'vector' | 'archive'
export type PickedFile = {
  path: string
  name: string
  size: number
  ext: string
  kind: FileKind
}
export type PickResult = { files: PickedFile[]; skipped: number }

export type TaskStatus = 'queued' | 'uploading' | 'retrying' | 'paused' | 'done' | 'failed' | 'canceled'

/** Satu tugas = satu file ke satu akun. */
export type QueueTask = {
  id: string
  filePath: string
  fileName: string
  size: number
  accountId: string
  accountName: string
  accountColor: string
  status: TaskStatus
  /** Byte yang sudah terkirim. */
  sent: number
  /** Kecepatan rata-rata, byte per detik. */
  speed: number
  /** Berapa kali sudah dicoba. */
  attempt: number
  maxAttempts: number
  error?: string
  errorDetail?: string
  /** Kalau upload dilanjutkan dari bagian yang sudah terkirim. */
  resumedFrom?: number
  nextRetryAt?: number
  addedAt: number
  /** Lama percobaan terakhir (ms). */
  lastAttemptMs?: number
  startedAt?: number
  finishedAt?: number
}

export type AddResult = {
  added: number
  duplicates: number
  sameName: number
  missing: number
  /** Dilewati karena sudah pernah berhasil dikirim ke akun itu. */
  alreadySent: number
}

export type HistoryEntry = {
  id: string
  fileName: string
  filePath: string
  size: number
  accountId: string
  accountName: string
  agency: string
  status: 'done' | 'failed'
  at: number
  ms?: number
  error?: string
}

/** File yang sudah pernah dikirim ke akun-akun tertentu. */
export type SentCheck = { path: string; accountIds: string[] }

export type AccountGroup = { id: string; name: string; accountIds: string[] }

export type Settings = {
  /** Upload bersamaan per akun. */
  perAccount: number
  aiMode: AiMode
  theme: 'system' | 'light' | 'dark'
}

export type QueueAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'remove'

export type Api = {
  listAccounts(): Promise<Account[]>
  saveAccount(input: AccountInput): Promise<Account>
  deleteAccount(id: string): Promise<void>
  testConnection(input: AccountInput): Promise<TestResult>
  /** Simpan daftar akun tanpa password ke file. true kalau tersimpan. */
  exportAccounts(): Promise<boolean>
  importAccounts(): Promise<{ added: number; skipped: number } | null>
  encryptionAvailable(): Promise<boolean>
  openExternal(url: string): Promise<void>

  /** Path asli dari file yang diseret ke jendela. */
  pathForFile(file: File): string
  expandPaths(paths: string[]): Promise<PickResult>
  pickFiles(): Promise<PickResult>
  pickFolder(): Promise<PickResult>

  listGroups(): Promise<AccountGroup[]>
  saveGroup(group: Omit<AccountGroup, 'id'> & { id?: string }): Promise<AccountGroup>
  deleteGroup(id: string): Promise<void>

  queueList(): Promise<QueueTask[]>
  queueAdd(paths: string[], accountIds: string[], force?: boolean): Promise<AddResult>
  queueAction(action: QueueAction, ids: string[]): Promise<void>
  queuePauseAll(paused: boolean): Promise<void>
  queueClearDone(): Promise<void>
  onQueueChanged(cb: (tasks: QueueTask[]) => void): () => void

  historyList(): Promise<HistoryEntry[]>
  historyRemove(ids: string[]): Promise<void>
  /** Simpan riwayat terpilih ke file CSV (jendela simpan muncul). true kalau tersimpan. */
  historyExport(ids: string[]): Promise<boolean>
  historyCheck(paths: string[], accountIds: string[]): Promise<SentCheck[]>
  onHistoryChanged(cb: () => void): () => void

  metaList(paths: string[]): Promise<MetaRecord[]>
  metaUpdate(path: string, patch: Partial<FileMeta>): Promise<MetaRecord>
  metaGenerate(paths: string[], overwrite: boolean): Promise<{ queued: number; skipped: number }>
  metaCancel(): Promise<void>
  metaInject(paths: string[]): Promise<{ saved: number; csvOnly: number; failed: number }>
  /** Pilih folder lalu simpan CSV untuk tiap agensi. null kalau dibatalkan. */
  metaExportCsv(paths: string[], agencies: string[]): Promise<{ files: string[]; rows: number } | null>
  onMetaRecord(cb: (r: MetaRecord) => void): () => void
  showInFolder(path: string): Promise<void>

  hasAiKey(): Promise<boolean>
  setAiKey(key: string): Promise<void>
  testAiKey(key?: string): Promise<{ ok: boolean; message: string }>

  getSettings(): Promise<Settings>
  saveSettings(s: Partial<Settings>): Promise<Settings>
}
