/** Pembaruan aplikasi dari rilis GitHub publik. */

/** Repo publik tempat installer diterbitkan (kode tetap di repo private). */
export const RELEASES_REPO = 'hadyanbaqi/stock-uploader-releases'

export type UpdateStatus =
  | 'idle' // belum dicek
  | 'disabled' // mode pengembangan / uji
  | 'checking'
  | 'none' // sudah versi terbaru
  | 'available'
  | 'downloading'
  | 'ready' // sudah diunduh dan dicek, tinggal pasang
  | 'installing'
  | 'error'

export type UpdateState = {
  status: UpdateStatus
  current: string
  latest?: string
  notes?: string
  /** Tanggal rilis (ISO). */
  date?: string
  /** Ukuran file installer (byte). */
  size?: number
  /** 0..1 saat mengunduh. */
  progress?: number
  error?: string
  /** Waktu cek terakhir (ms). */
  checkedAt?: number
  /** Mac: aplikasi tidak bisa diganti otomatis, jadi DMG akan dibuka untuk dipasang manual. */
  manual?: boolean
}
