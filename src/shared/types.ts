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

export type Api = {
  listAccounts(): Promise<Account[]>
  saveAccount(input: AccountInput): Promise<Account>
  deleteAccount(id: string): Promise<void>
  testConnection(input: AccountInput): Promise<TestResult>
  encryptionAvailable(): Promise<boolean>
  openExternal(url: string): Promise<void>
}
