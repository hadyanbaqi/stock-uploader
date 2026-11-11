import type { AgencyPreset, Protocol } from './types'

/**
 * Preset agensi. Nilai ini titik awal; host dan login selalu bisa diubah
 * dan sebaiknya disalin dari dashboard kontributor masing-masing.
 */
export const AGENCY_PRESETS: AgencyPreset[] = [
  {
    key: 'adobe',
    name: 'Adobe Stock',
    protocol: 'sftp',
    host: 'sftp.contributor.adobestock.com',
    port: 22,
    loginHint: 'ID + password dari Contributor Portal > Upload > Learn More > Generate password',
    note: 'Hanya untuk akun yang sudah mendapat akses SFTP.',
    helpUrl: 'https://helpx.adobe.com/stock/how-to/upload-video-to-adobe-stock.html'
  },
  {
    key: 'shutterstock',
    name: 'Shutterstock',
    protocol: 'ftps',
    host: 'ftps.shutterstock.com',
    port: 21,
    loginHint: 'Email atau username + password akun Shutterstock',
    note: 'Video hanya bisa lewat FTPS atau web.',
    helpUrl: 'https://submit.shutterstock.com/help/en/articles/10617392-how-do-i-upload-content-via-ftps'
  },
  {
    key: 'dreamstime',
    name: 'Dreamstime',
    protocol: 'ftp',
    host: 'upload.dreamstime.com',
    port: 21,
    loginHint: 'Nomor ID akun (angka) + password akun',
    helpUrl: 'https://www.dreamstime.com/ftp_instructions'
  },
  {
    key: 'vecteezy',
    name: 'Vecteezy',
    protocol: 'sftp',
    host: '',
    port: 22,
    loginHint: 'Host, username, dan password dari dashboard kontributor Vecteezy',
    helpUrl: 'https://eezycontributors.zendesk.com/hc/en-us/articles/26668485078676-Upload-Settings'
  },
  {
    key: 'freepik',
    name: 'Freepik',
    protocol: 'ftp',
    host: '',
    port: 21,
    loginHint: 'Host, username, dan password dari dashboard kontributor Freepik',
    note: 'File di FTP Freepik dihapus otomatis setelah 6 bulan.',
    helpUrl: 'https://www.freepik.com/ai/contributors/ftp-upload-method'
  },
  {
    key: 'pond5',
    name: 'Pond5',
    protocol: 'ftp',
    host: '',
    port: 21,
    loginHint: 'Username + password FTP khusus dari halaman upload Pond5',
    note: 'Password FTP baru butuh beberapa menit sampai aktif.'
  },
  {
    key: '123rf',
    name: '123RF',
    protocol: 'ftp',
    host: '',
    port: 21,
    loginHint: 'Lihat tombol "Upload Via FTP" di dashboard 123RF',
    helpUrl: 'https://blog.123rf.com/how-to-upload-photos-or-illustrations'
  },
  {
    key: 'depositphotos',
    name: 'Depositphotos',
    protocol: 'ftp',
    host: 'ftp.depositphotos.com',
    port: 21,
    loginHint: 'Username + password akun (cek ulang di dashboard)'
  },
  {
    key: 'alamy',
    name: 'Alamy',
    protocol: 'ftp',
    host: 'upload.alamy.com',
    port: 21,
    loginHint: 'Detail FTP dari halaman upload Alamy',
    helpUrl: 'https://www.alamy.com/help/contributor-uploading'
  },
  {
    key: 'other',
    name: 'Lainnya',
    protocol: 'ftp',
    host: '',
    port: 21,
    loginHint: 'Isi manual sesuai petunjuk agensi'
  }
]

export const DEFAULT_PORT: Record<Protocol, number> = { ftp: 21, ftps: 21, sftp: 22 }

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  ftp: 'FTP',
  ftps: 'FTPS (TLS)',
  sftp: 'SFTP'
}

export const ACCOUNT_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#4b5563']

export function presetByKey(key: string): AgencyPreset {
  return AGENCY_PRESETS.find((p) => p.key === key) ?? AGENCY_PRESETS[AGENCY_PRESETS.length - 1]
}
