import { useEffect, useState } from 'react'
import type { Settings } from '../../../shared/types'
import { AI_MODES, type AiMode } from '../../../shared/metadata'

type Props = { settings: Settings | null; onChange: (s: Settings) => void }

export default function SettingsPage({ settings, onChange }: Props) {
  const [hasKey, setHasKey] = useState(false)
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string } | 'running' | null>(null)
  const [saved, setSaved] = useState('')

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

  if (!settings) return null

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
