import type { AiMode, FileMeta, MetaRecord } from './metadata'
import type { UpdateState } from './update'
import type { UpscaleOptions } from './upscale'
import type { BrowserProfile, IpStatus, OpenResult, ProfileGroup, ProfileInput, ProfilesState } from './profiles'

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
  /** Setelah berhasil: ubah "belum" jadi "sudah" di metadata-master.csv. */
  markMaster: boolean
  /** Setelah semua upload satu file berhasil: biarkan, pindah ke _sudah-upload, atau ke Tempat Sampah. */
  afterDone: 'keep' | 'move' | 'trash'
  /** Buat Gambar: folder simpan ('' = Pictures/Stock Uploader), model, rasio, ZIP otomatis. */
  genDir: string
  genModel: string
  genAspect: string
  genAutoZip: boolean
  /** Galeri dikosongkan tiap kali mulai membuat gambar baru. */
  genClearOnStart: boolean
  /** Profil browser: lokasi Chrome ('' = cari otomatis), jeda antarprofil saat buka banyak (detik), tes proxy dulu sebelum membuka. */
  browserPath: string
  browserDelay: number
  browserTestFirst: boolean
  /** Cek pembaruan aplikasi otomatis saat dibuka dan tiap 6 jam. */
  autoUpdate: boolean
  /** Upscale AI otomatis saat hasil Buat Gambar disimpan. */
  genUpscale: UpscaleOptions
  /** Peringatan "berjalan di komputer ini" sudah dibaca. */
  upscaleWarned: boolean
}

export type GenStatus = 'queued' | 'running' | 'ready' | 'saved' | 'discarded' | 'failed' | 'rejected' | 'canceled'

/** Satu gambar yang diminta ke AI. */
export type GenJob = {
  id: string
  batchId: string
  /** Prompt seperti yang ditulis pengguna. */
  prompt: string
  /** Prompt yang dikirim (dengan template gaya). */
  fullPrompt: string
  template: string
  model: string
  aspect: string
  status: GenStatus
  attempt: number
  error?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  width?: number
  height?: number
  savedPath?: string
  /** 0..1 saat sedang di-upscale AI di komputer ini. */
  upscale?: number
  /** Skala upscale AI yang sudah dipakai, mis. "4×". */
  upscaled?: string
}

export type GenBatch = { id: string; folder: string; autoZip: boolean; zipPath?: string; createdAt: number; refName?: string; /** Disembunyikan dari galeri (tetap ada di Riwayat). */ hidden?: boolean }

export type GenStartInput = {
  prompts: string[]
  variants: number
  template: string
  model: string
  aspect: string
  refPath?: string
  autoZip: boolean
  /** Sembunyikan kelompok sebelumnya dari galeri sebelum mulai. */
  clearPrevious?: boolean
}

/** Transparan: efek di latar polos → PNG transparan (+ JPG preview, PSD). */
export type AlphaBg = 'auto' | 'black' | 'white' | 'color'
export type AlphaPreviewStyle = 'black' | 'white' | 'checker' | 'split' | 'color'
export type AlphaOptions = {
  bg: AlphaBg
  /** Warna latar untuk bg = 'color' (#rrggbb). */
  color: string
  /** Pembersih noise 0..0.3. */
  floor: number
  /** Kekuatan glow 0.5..2. */
  glow: number
  /** Perbesar ke ±6 MP kalau di bawah 4 MP. */
  minMp: boolean
  jpg: boolean
  jpgStyle: AlphaPreviewStyle
  jpgColor: string
  jpgText: string
  psd: boolean
  naming: 'original' | 'sequence'
  prefix: string
  /** '' = folder "transparan-<waktu>" di sebelah file pertama. */
  outDir: string
  zip: boolean
}
export type AlphaInfo = { path: string; name: string; width: number; height: number; bg: 'black' | 'white' | 'color'; color: string; thumb: string }
export type AlphaProgress = { done: number; total: number; current: string; errors: number }
export type AlphaResult = { outDir: string; pngs: string[]; files: number; zipPath?: string; errors: { path: string; error: string }[]; canceled: boolean }

export type GenAction = 'keep' | 'discard' | 'retry' | 'again' | 'cancel'

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
  /** previews = JPG pratinjau PSD yang baru dibuat; smallPreviews = yang sisi terpanjangnya < 2.000 px. */
  metaInject(paths: string[]): Promise<{ saved: number; csvOnly: number; failed: number; previews: number; smallPreviews: string[] }>
  /** Pilih folder lalu simpan CSV untuk tiap agensi. null kalau dibatalkan. */
  metaExportCsv(paths: string[], agencies: string[]): Promise<{ files: string[]; rows: number } | null>
  /**
   * Isi metadata dari CSV yang sudah ada. pick=false: cari otomatis (CSV di folder file dan di atasnya,
   * termasuk _FILE-KERJA/metadata-master.csv); pick=true: pilih file CSV. null kalau dibatalkan.
   */
  /** Path yang ditandai dibuat dengan AI generatif. */
  metaAiFlags(paths: string[]): Promise<string[]>
  metaImportCsv(paths: string[], pick: boolean, overwrite: boolean): Promise<{ filled: number; notFound: number; skipped: number; sources: string[] } | null>
  onMetaRecord(cb: (r: MetaRecord) => void): () => void
  showInFolder(path: string): Promise<void>

  hasAiKey(): Promise<boolean>
  setAiKey(key: string): Promise<void>
  testAiKey(key?: string): Promise<{ ok: boolean; message: string }>

  /** Pesan singkat dari proses utama (mis. hasil merapikan setelah upload). */
  onNotice(cb: (text: string) => void): () => void

  genModels(): Promise<string[]>
  genStart(input: GenStartInput): Promise<{ queued: number; batchId: string }>
  genList(): Promise<{ jobs: GenJob[]; batches: GenBatch[] }>
  /** Gambar kecil (data URL) untuk id yang diminta. */
  genThumbs(ids: string[]): Promise<Record<string, string>>
  genAction(action: GenAction, ids: string[]): Promise<void>
  /** Simpan semua gambar tersimpan di satu kelompok jadi ZIP. */
  genZip(batchId: string): Promise<{ zipPath: string; count: number }>
  genFull(id: string): Promise<string | null>
  /** Kosongkan galeri: semua kelompok disembunyikan; discard = buang juga gambar yang belum disimpan dan hentikan yang masih antre. */
  genClear(discard: boolean): Promise<void>
  genPickRef(): Promise<{ path: string; thumb: string } | null>
  genPickDir(): Promise<string | null>
  genDefaultDir(): Promise<string>
  onGenChanged(cb: () => void): () => void

  alphaPickFiles(): Promise<string[]>
  alphaPickFolder(): Promise<string[]>
  alphaExpand(paths: string[]): Promise<string[]>
  alphaInspect(paths: string[]): Promise<AlphaInfo[]>
  alphaPreview(path: string, opts: AlphaOptions): Promise<{ before: string; after: string; bg: string; color: string }>
  alphaRun(paths: string[], opts: AlphaOptions): Promise<AlphaResult>
  alphaCancel(): Promise<void>
  alphaPickOut(): Promise<string | null>
  onAlphaProgress(cb: (p: AlphaProgress) => void): () => void

  getSettings(): Promise<Settings>
  saveSettings(s: Partial<Settings>): Promise<Settings>

  profilesState(): Promise<ProfilesState>
  profileSave(input: ProfileInput): Promise<BrowserProfile>
  profileDuplicate(id: string): Promise<BrowserProfile>
  /** deleteData = folder data Chrome (login, cookie) ikut dihapus. */
  profileRemove(ids: string[], deleteData: boolean): Promise<void>
  profileGroupSave(group: { id?: string; name: string }): Promise<ProfileGroup>
  profileGroupRemove(id: string): Promise<void>
  profileMove(ids: string[], groupId: string | null): Promise<void>
  profileOpen(ids: string[]): Promise<OpenResult[]>
  profileClose(ids: string[]): Promise<void>
  profileTest(ids: string[]): Promise<void>
  /** Tes proxy dari formulir (belum disimpan). */
  profileTestInput(input: ProfileInput): Promise<IpStatus>
  profileShowFolder(id: string): Promise<void>
  /** Pilih file Chrome secara manual. null kalau dibatalkan. */
  pickBrowser(): Promise<string | null>
  onProfilesChanged(cb: (state: ProfilesState) => void): () => void

  /** Program upscale ada di aplikasi ini? */
  upscaleInfo(): Promise<{ ok: boolean; reason?: string }>

  updateState(): Promise<UpdateState>
  updateCheck(): Promise<UpdateState>
  updateDownload(): Promise<UpdateState>
  updateCancel(): Promise<void>
  /** Tutup aplikasi dan pasang versi baru (tanya dulu kalau masih ada upload). */
  updateInstall(): Promise<UpdateState>
  onUpdate(cb: (state: UpdateState) => void): () => void
}
