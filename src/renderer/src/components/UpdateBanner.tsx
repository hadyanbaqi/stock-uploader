import { useEffect, useState } from 'react'
import type { UpdateState } from '../../../shared/update'

/** Status pembaruan, ikut berubah saat proses utama mengirim kabar baru. */
export function useUpdate(): [UpdateState | null, (s: UpdateState) => void] {
  const [st, setSt] = useState<UpdateState | null>(null)
  useEffect(() => {
    void window.api.updateState().then(setSt)
    return window.api.onUpdate(setSt)
  }, [])
  return [st, setSt]
}

export const fmtSize = (b?: number) => (b ? `${(b / 1048576).toFixed(b > 104857600 ? 0 : 1)} MB` : '')

/** Tombol-tombol pembaruan; dipakai di banner dan di Pengaturan. */
export function UpdateActions({ st, onChange }: { st: UpdateState; onChange(s: UpdateState): void }) {
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<UpdateState | void>) => {
    setBusy(true)
    try {
      const r = await fn()
      if (r) onChange(r)
    } finally {
      setBusy(false)
    }
  }
  if (st.status === 'available')
    return (
      <button className="btn small primary" disabled={busy} onClick={() => void act(() => window.api.updateDownload())}>
        Download {fmtSize(st.size)}
      </button>
    )
  if (st.status === 'downloading')
    return (
      <span className="upd-progress">
        <span className="upd-bar">
          <span style={{ width: `${Math.round((st.progress ?? 0) * 100)}%` }} />
        </span>
        <span className="small muted">{Math.round((st.progress ?? 0) * 100)}%</span>
        <button className="btn small ghost" onClick={() => void act(() => window.api.updateCancel())}>
          Batal
        </button>
      </span>
    )
  if (st.status === 'ready')
    return (
      <button className="btn small primary" disabled={busy} onClick={() => void act(() => window.api.updateInstall())}>
        {st.manual ? 'Buka installer' : 'Pasang & buka ulang'}
      </button>
    )
  if (st.status === 'installing') return <span className="small muted">Memasang… aplikasi akan tertutup dan terbuka lagi.</span>
  return null
}

/** Banner di atas semua halaman saat ada versi baru. "Nanti" menyembunyikan sampai ada versi yang lebih baru lagi. */
export default function UpdateBanner() {
  const [st, setSt] = useUpdate()
  const [hidden, setHidden] = useState<string | null>(() => {
    try {
      return localStorage.getItem('su-update-later')
    } catch {
      return null
    }
  })
  if (!st || !['available', 'downloading', 'ready', 'installing'].includes(st.status)) return null
  if (st.status === 'available' && hidden === st.latest) return null

  const later = () => {
    setHidden(st.latest ?? null)
    try {
      localStorage.setItem('su-update-later', st.latest ?? '')
    } catch {
      /* abaikan */
    }
  }

  return (
    <div className="upd-banner" role="status">
      <div className="upd-text">
        <strong>
          {st.status === 'ready' ? `Versi ${st.latest} siap dipasang` : `Versi baru ${st.latest} tersedia`}
        </strong>
        <span className="muted small"> · sekarang {st.current}</span>
        {st.status === 'ready' && st.manual && (
          <div className="small muted">Installer (DMG) akan dibuka: seret Stock Uploader ke Applications, pilih Ganti.</div>
        )}
        {st.notes && (
          <details className="upd-notes">
            <summary className="small">Apa yang baru</summary>
            <pre>{st.notes}</pre>
          </details>
        )}
      </div>
      <div className="upd-actions">
        <UpdateActions st={st} onChange={setSt} />
        {st.status === 'available' && (
          <button className="btn small ghost" onClick={later}>
            Nanti
          </button>
        )}
      </div>
    </div>
  )
}
