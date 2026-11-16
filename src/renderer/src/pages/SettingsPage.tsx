import { useEffect, useState } from 'react'
import type { Settings } from '../../../shared/types'
import { AI_MODES, type AiMode } from '../../../shared/metadata'
import { UpdateActions, useUpdate } from '../components/UpdateBanner'

type Props = { settings: Settings | null; onChange: (s: Settings) => void }

export default function SettingsPage({ settings, onChange }: Props) {
  const [hasKey, setHasKey] = useState(false)
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string } | 'running' | null>(null)
  const [saved, setSaved] = useState('')
  const [upd, setUpd] = useUpdate()
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void window.api.hasAiKey().then(setHasKey)
  }, [])

  async function save(patch: Partial<Settings>) {
    onChange(await window.api.saveSettings(patch))
  }

  async function saveKey() {
    setTest('running')
    const r = await window.api.testAiKey(key.trim())
    setTest(r)
    if (r.ok) {
      await window.api.setAiKey(key.trim())
      setHasKey(true)
      setKey('')
      setSaved('API key tersimpan (terenkripsi).')
    }
  }

  async function removeKey() {
    if (!window.confirm('Hapus API key Ciora dari aplikasi ini?')) return
    await window.api.setAiKey('')
    setHasKey(false)
    setTest(null)
    setSaved('API key dihapus.')
  }

  async function checkNow() {
    setChecking(true)
    try {
      setUpd(await window.api.updateCheck())
    } finally {
      setChecking(false)
    }
  }

  if (!settings) return null

  const updText = (() => {
    if (!upd) return ''
    const when = upd.checkedAt ? ` (dicek ${new Date(upd.checkedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })})` : ''
    switch (upd.status) {
      case 'disabled':
        return 'Pembaruan otomatis hanya aktif di aplikasi yang terpasang.'
      case 'checking':
        return 'Mengecek…'
      case 'none':
        return `Sudah versi terbaru${when}.`
      case 'available':
        return `Versi ${upd.latest} tersedia${when}.`
      case 'downloading':
        return `Mengunduh versi ${upd.latest}…`
      case 'ready':
        return `Versi ${upd.latest} sudah diunduh dan dicek, siap dipasang.`
      case 'installing':
        return 'Memasang…'
      case 'error':
        return `Gagal: ${upd.error ?? 'tidak diketahui'}${when}`
      default:
        return 'Belum dicek.'
    }
  })()

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Pengaturan</h1>
          <p className="muted">Semua pengaturan tersimpan di komputer ini saja.</p>
        </div>
      </header>

      <section className="panel settings">
        <h2>AI metadata (Ciora)</h2>
        <p className="muted small">
          Satu API key Ciora untuk semua model. Buat key dan isi saldo di{' '}
          <button className="link" onClick={() => void window.api.openExternal('https://ciora.id/')}>
            ciora.id
          </button>
          . Key disimpan terenkripsi seperti password FTP.
        </p>
        <div className="setting-row">
          <span className="setting-label">API key</span>
          <div className="grow">
            {hasKey && !key ? (
              <div className="field-row">
                <span className="pill pill-done">Tersimpan</span>
                <button className="btn small" onClick={() => void window.api.testAiKey().then(setTest)}>
                  Tes key
                </button>
                <button className="btn small ghost danger-text" onClick={() => void removeKey()}>
                  Hapus
                </button>
                <span className="muted small">Ketik key baru di bawah untuk mengganti.</span>
              </div>
            ) : null}
            <div className="pw" style={{ marginTop: hasKey ? 8 : 0 }}>
              <input
                className="text-input grow"
                type={show ? 'text' : 'password'}
                placeholder={hasKey ? 'Ganti dengan key baru…' : 'Tempel API key Ciora di sini'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="btn" onClick={() => setShow(!show)}>
                {show ? 'Sembunyikan' : 'Lihat'}
              </button>
              <button className="btn primary" disabled={!key.trim() || test === 'running'} onClick={() => void saveKey()}>
                Tes &amp; simpan
              </button>
            </div>
            {test && (
              <div className={`test small ${test === 'running' ? 'running' : test.ok ? 'ok' : 'fail'}`} style={{ marginTop: 8 }}>
                {test === 'running' ? 'Mengecek key…' : test.message}
              </div>
            )}
            {saved && <div className="muted small" style={{ marginTop: 6 }}>{saved}</div>}
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label">Mode bawaan</span>
          <div className="grow">
            <div className="seg">
              {(Object.keys(AI_MODES) as AiMode[]).map((k) => (
                <button key={k} className={settings.aiMode === k ? 'on' : ''} onClick={() => void save({ aiMode: k })}>
                  {AI_MODES[k].label}
                </button>
              ))}
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              {AI_MODES[settings.aiMode].hint} Model: {AI_MODES[settings.aiMode].model}
            </div>
          </div>
        </div>
      </section>

      <section className="panel settings">
        <h2>Upload</h2>
        <div className="setting-row">
          <span className="setting-label">Bersamaan per akun</span>
          <div className="grow">
            <select className="text-input narrow" value={settings.perAccount} onChange={(e) => void save({ perAccount: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <div className="muted small" style={{ marginTop: 6 }}>
              Berapa file dikirim bersamaan ke satu akun. 2 sudah cukup untuk kebanyakan agensi.
            </div>
          </div>
        </div>
      </section>

      <section className="panel settings">
        <h2>Setelah upload berhasil</h2>
        <div className="setting-row">
          <span className="setting-label">metadata-master.csv</span>
          <div className="grow">
            <label className="check">
              <input type="checkbox" checked={settings.markMaster} onChange={(e) => void save({ markMaster: e.target.checked })} />
              Ubah status "belum" jadi "sudah" di kolom agensi tujuan
            </label>
            <div className="muted small" style={{ marginTop: 6 }}>
              File dicari di folder _FILE-KERJA pada folder file atau folder di atasnya. Kolom berisi "-" tidak diubah.
            </div>
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label">File yang sudah terkirim</span>
          <div className="grow">
            <div className="seg">
              {(
                [
                  ['keep', 'Biarkan'],
                  ['move', 'Pindah ke _sudah-upload'],
                  ['trash', 'Pindah ke Tempat Sampah']
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={settings.afterDone === k ? 'on' : ''} onClick={() => void save({ afterDone: k })}>
                  {label}
                </button>
              ))}
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              Dijalankan setelah semua upload file itu berhasil (kalau ada yang gagal, file dibiarkan).{' '}
              {settings.afterDone === 'move' &&
                'Contoh: Microstok/ADOBE-STOCK/14/a.jpg → Microstok/_sudah-upload/ADOBE-STOCK/14/a.jpg. Hapus folder itu sendiri kalau perlu ruang.'}
              {settings.afterDone === 'trash' && 'Ruang disk baru lega setelah Tempat Sampah dikosongkan.'}
            </div>
          </div>
        </div>
      </section>

      <section className="panel settings">
        <h2>Pembaruan aplikasi</h2>
        <div className="setting-row">
          <span className="setting-label">Versi sekarang</span>
          <div className="upd-row">
            <strong>{upd?.current ?? __APP_VERSION__}</strong>
            <span className={`small ${upd?.status === 'error' ? 'danger-text' : 'muted'}`}>{updText}</span>
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label" />
          <div className="upd-row">
            <button className="btn small" disabled={checking || !upd || ['disabled', 'checking', 'downloading', 'installing'].includes(upd.status)} onClick={() => void checkNow()}>
              {checking ? 'Mengecek…' : 'Cek pembaruan'}
            </button>
            {upd && <UpdateActions st={upd} onChange={setUpd} />}
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label" />
          <label className="check">
            <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => void save({ autoUpdate: e.target.checked })} />
            Cek otomatis saat aplikasi dibuka dan tiap 6 jam
          </label>
        </div>
        {upd?.notes && ['available', 'downloading', 'ready'].includes(upd.status) && (
          <details className="upd-notes">
            <summary className="small">Apa yang baru di versi {upd.latest}</summary>
            <pre>{upd.notes}</pre>
          </details>
        )}
      </section>

      <section className="panel settings">
        <h2>Tampilan</h2>
        <div className="setting-row">
          <span className="setting-label">Tema</span>
          <div className="seg">
            {(
              [
                ['system', 'Ikuti sistem'],
                ['light', 'Terang'],
                ['dark', 'Gelap']
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={settings.theme === k ? 'on' : ''} onClick={() => void save({ theme: k })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
