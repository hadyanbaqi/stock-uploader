import { useMemo, useState } from 'react'
import type { Account, AccountInput, Protocol, TestResult } from '../../../shared/types'
import { ACCOUNT_COLORS, AGENCY_PRESETS, DEFAULT_PORT, PROTOCOL_LABEL, presetByKey } from '../../../shared/presets'

type Props = {
  mode: 'new' | 'edit' | 'copy'
  account?: Account
  existing: Account[]
  onCancel(): void
  onSave(input: AccountInput): Promise<void>
}

function suggestName(agencyKey: string, existing: Account[]): string {
  const base = presetByKey(agencyKey).name
  const taken = new Set(existing.map((a) => a.name.toLowerCase()))
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base} - Utama` : `${base} - Akun ${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

function initial(props: Props): AccountInput {
  if (props.account && props.mode === 'edit') {
    const { hasPassword, createdAt, updatedAt, ...rest } = props.account
    return { ...rest, password: '' }
  }
  if (props.account && props.mode === 'copy') {
    const { id, hasPassword, createdAt, updatedAt, ...rest } = props.account
    return { ...rest, name: suggestName(rest.agency, props.existing), password: '' }
  }
  const preset = AGENCY_PRESETS[0]
  return {
    name: suggestName(preset.key, props.existing),
    agency: preset.key,
    protocol: preset.protocol,
    host: preset.host,
    port: preset.port,
    username: '',
    password: '',
    remoteDir: '',
    color: ACCOUNT_COLORS[props.existing.length % ACCOUNT_COLORS.length],
    enabled: true,
    allowInvalidCert: false
  }
}

export default function AccountForm(props: Props) {
  const [v, setV] = useState<AccountInput>(() => initial(props))
  const [showPw, setShowPw] = useState(false)
  const [test, setTest] = useState<TestResult | 'running' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const preset = useMemo(() => presetByKey(v.agency), [v.agency])
  const isEdit = props.mode === 'edit'
  const others = props.existing.filter((a) => a.id !== v.id)

  const set = <K extends keyof AccountInput>(key: K, value: AccountInput[K]) => {
    setV((prev) => ({ ...prev, [key]: value }))
    setTest(null)
  }

  function changeAgency(key: string) {
    const p = presetByKey(key)
    setV((prev) => {
      const autoName = prev.name === suggestName(prev.agency, others) || !prev.name.trim()
      return {
        ...prev,
        agency: key,
        protocol: p.protocol,
        host: p.host,
        port: p.port,
        name: autoName ? suggestName(key, others) : prev.name
      }
    })
    setTest(null)
  }

  function changeProtocol(p: Protocol) {
    setV((prev) => ({
      ...prev,
      protocol: p,
      port: prev.port === DEFAULT_PORT[prev.protocol] ? DEFAULT_PORT[p] : prev.port
    }))
    setTest(null)
  }

  async function runTest() {
    setTest('running')
    // Duplikat belum punya password tersimpan sendiri, jadi pakai id akun asal hanya kalau password kosong.
    const id = props.mode === 'copy' ? props.account?.id : v.id
    setTest(await window.api.testConnection({ ...v, id }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await props.onSave(v)
    } catch (err) {
      setError(String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setSaving(false)
    }
  }

  const title = isEdit ? 'Ubah akun' : props.mode === 'copy' ? 'Duplikat akun' : 'Tambah akun'

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <form className="modal" onSubmit={submit}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost" onClick={props.onCancel} aria-label="Tutup">
            ✕
          </button>
        </header>

        <div className="form-grid">
          <label className="field">
            <span>Agensi</span>
            <select value={v.agency} onChange={(e) => changeAgency(e.target.value)}>
              {AGENCY_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Nama panggilan</span>
            <input value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="mis. Vecteezy - Kedua" />
          </label>

          <div className="hint span-2">
            <strong>Login:</strong> {preset.loginHint}
            {preset.note && <div>{preset.note}</div>}
            {preset.helpUrl && (
              <button type="button" className="link" onClick={() => void window.api.openExternal(preset.helpUrl!)}>
                Buka panduan {preset.name}
              </button>
            )}
          </div>

          <label className="field">
            <span>Protokol</span>
            <select value={v.protocol} onChange={(e) => changeProtocol(e.target.value as Protocol)}>
              {(Object.keys(PROTOCOL_LABEL) as Protocol[]).map((p) => (
                <option key={p} value={p}>
                  {PROTOCOL_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          <div className="field-row">
            <label className="field grow">
              <span>Host server</span>
              <input value={v.host} onChange={(e) => set('host', e.target.value)} placeholder="mis. ftp.contoh.com" />
            </label>
            <label className="field port">
              <span>Port</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={v.port}
                onChange={(e) => set('port', Number(e.target.value))}
              />
            </label>
          </div>

          <label className="field">
            <span>Username</span>
            <input value={v.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
          </label>

          <label className="field">
            <span>Password</span>
            <div className="pw">
              <input
                type={showPw ? 'text' : 'password'}
                value={v.password}
                onChange={(e) => set('password', e.target.value)}
                autoComplete="new-password"
                placeholder={isEdit ? 'Kosongkan untuk pakai password lama' : props.mode === 'copy' ? 'Password akun ini' : ''}
              />
              <button type="button" className="btn ghost" onClick={() => setShowPw((s) => !s)}>
                {showPw ? 'Sembunyikan' : 'Lihat'}
              </button>
            </div>
          </label>

          {v.agency === 'adobe' ? (
            <div className="field">
              <span>Folder tujuan</span>
              <span className="muted small">
                Adobe Stock hanya menghitung file di folder utama (file di dalam folder atau ZIP diabaikan), jadi file selalu dikirim ke folder utama.
              </span>
            </div>
          ) : (
          <label className="field">
            <span>{v.agency === 'freepik' ? 'Nama subfolder (opsional)' : 'Folder tujuan (opsional)'}</span>
            <input
              value={v.remoteDir}
              onChange={(e) => set('remoteDir', e.target.value)}
              placeholder={v.agency === 'freepik' ? 'mis. batch-1 · kosong = upload-tanggal' : 'Kosongkan = folder utama'}
            />
            {v.agency === 'freepik' && (
              <span className="muted small">
                Magnific menolak file di folder utama. File otomatis dikirim ke photo/, psd/, vector/, atau video/ lalu subfolder ini. JPG ikut pasangannya (EPS → vector, PSD → psd).
              </span>
            )}
          </label>
          )}

          <div className="field">
            <span>Warna label</span>
            <div className="colors">
              {ACCOUNT_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`swatch ${v.color === c ? 'picked' : ''}`}
                  style={{ background: c }}
                  onClick={() => set('color', c)}
                  aria-label={`Warna ${c}`}
                />
              ))}
            </div>
          </div>

          <label className="check span-2">
            <input type="checkbox" checked={v.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            Akun aktif (muncul sebagai tujuan upload)
          </label>

          {v.protocol === 'ftps' && (
            <label className="check span-2">
              <input
                type="checkbox"
                checked={v.allowInvalidCert}
                onChange={(e) => set('allowInvalidCert', e.target.checked)}
              />
              Izinkan sertifikat tidak valid (hanya kalau tes koneksi gagal karena sertifikat dan kamu yakin servernya benar)
            </label>
          )}
        </div>

        {test && (
          <div className={`test ${test === 'running' ? 'running' : test.ok ? 'ok' : 'fail'}`}>
            {test === 'running' ? 'Menguji koneksi…' : `${test.message} (${(test.ms / 1000).toFixed(1)} dtk)`}
            {test !== 'running' && !test.ok && test.detail && <div className="detail">{test.detail}</div>}
          </div>
        )}
        {error && <div className="banner danger">{error}</div>}

        <footer className="modal-foot">
          <button type="button" className="btn" onClick={() => void runTest()} disabled={test === 'running'}>
            Tes koneksi
          </button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={props.onCancel}>
            Batal
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </footer>
      </form>
    </div>
  )
}
