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
  startedAt?: number
  finishedAt?: number
}

export type AddResult = { added: number; duplicates: number; sameName: number; missing: number }

export type AccountGroup = { id: string; name: string; accountIds: string[] }

export type Settings = {
  /** Upload bersamaan per akun. */
  perAccount: number
}

export type QueueAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'remove'

export type Api = {
  listAccounts(): Promise<Account[]>
  saveAccount(input: AccountInput): Promise<Account>
  deleteAccount(id: string): Promise<void>
  testConnection(input: AccountInput): Promise<TestResult>
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
  queueAdd(paths: string[], accountIds: string[]): Promise<AddResult>
  queueAction(action: QueueAction, ids: string[]): Promise<void>
  queuePauseAll(paused: boolean): Promise<void>
  queueClearDone(): Promise<void>
  onQueueChanged(cb: (tasks: QueueTask[]) => void): () => void

  getSettings(): Promise<Settings>
  saveSettings(s: Partial<Settings>): Promise<Settings>
}
