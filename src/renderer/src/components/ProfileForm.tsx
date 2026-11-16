import { useState } from 'react'
import { ACCOUNT_COLORS } from '../../../shared/presets'
import {
  DIRECT,
  PROXY_LABEL,
  START_PRESETS,
  defaultProxyPort,
  parseProxy,
  type BrowserProfile,
  type IpStatus,
  type ProfileGroup,
  type ProfileInput,
  type ProxyType
} from '../../../shared/profiles'

type Props = {
  mode: 'new' | 'edit'
  profile?: BrowserProfile
  groups: ProfileGroup[]
  /** Grup yang sedang dibuka di panel kiri, jadi bawaan untuk profil baru. */
  defaultGroupId: string | null
  onCancel(): void
  onSave(input: ProfileInput): Promise<void>
}

type FormValue = Omit<ProfileInput, 'startUrls'> & { startText: string; proxyPassword: string }

const clean = (err: unknown) => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function initial(p: Props): FormValue {
  if (p.profile && p.mode === 'edit') {
    const { id, name, notes, color, groupId, startUrls, proxy } = p.profile
    return { id, name, notes, color, groupId, proxy: { ...proxy }, startText: startUrls.join('\n'), proxyPassword: '', clearProxyPassword: false }
  }
  return {
    name: '',
    notes: '',
    color: ACCOUNT_COLORS[0],
    groupId: p.defaultGroupId,
    proxy: { ...DIRECT },
    startText: '',
    proxyPassword: '',
    clearProxyPassword: false
  }
}

export default function ProfileForm(props: Props) {
  const [v, setV] = useState<FormValue>(() => initial(props))
  const [paste, setPaste] = useState('')
  const [pasteMsg, setPasteMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [showPw, setShowPw] = useState(false)
  const [test, setTest] = useState<IpStatus | 'running' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isEdit = props.mode === 'edit'
  const hadPw = Boolean(isEdit && props.profile?.hasProxyPassword)
  const direct = v.proxy.type === 'direct'

  function set<K extends keyof FormValue>(key: K, value: FormValue[K]) {
    setV((prev) => ({ ...prev, [key]: value }))
  }
  function setProxy<K extends keyof FormValue['proxy']>(key: K, value: FormValue['proxy'][K]) {
    setV((prev) => ({ ...prev, proxy: { ...prev.proxy, [key]: value } }))
    setTest(null)
  }

  function changeType(t: ProxyType) {
    setV((prev) => {
      const portWasDefault = !prev.proxy.port || prev.proxy.port === defaultProxyPort(prev.proxy.type)
      return {
        ...prev,
        proxy: t === 'direct' ? { ...DIRECT } : { ...prev.proxy, type: t, port: portWasDefault ? defaultProxyPort(t) : prev.proxy.port }
      }
    })
    setTest(null)
  }

  function applyPaste(text: string) {
    setPaste(text)
    if (!text.trim()) {
      setPasteMsg(null)
      return
    }
    const r = parseProxy(text, v.proxy.type === 'direct' ? 'http' : v.proxy.type)
    if (!r.ok) {
      setPasteMsg({ ok: false, text: r.error })
      return
    }
    const { password, ...proxy } = r.proxy
    setV((prev) => ({ ...prev, proxy, proxyPassword: password, clearProxyPassword: false }))
    setTest(null)
    setPasteMsg({
      ok: true,
      text: proxy.type === 'direct' ? 'Diisi: tanpa proxy.' : `Diisi: ${PROXY_LABEL[proxy.type]} ${proxy.host}:${proxy.port}${proxy.username ? `, user ${proxy.username}` : ''}${password ? ', password ✓' : ''}`
    })
  }

  function addStart(url: string) {
    setV((prev) => {
      const lines = prev.startText.split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.includes(url)) return prev
      return { ...prev, startText: [...lines, url].join('\n') }
    })
  }

  function toInput(): ProfileInput {
    const { startText, ...rest } = v
    return { ...rest, startUrls: startText.split('\n') }
  }

  async function runTest() {
    setTest('running')
    try {
      setTest(await window.api.profileTestInput(toInput()))
    } catch (err) {
      setTest({ state: 'fail', error: clean(err) })
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await props.onSave(toInput())
    } catch (err) {
      setError(clean(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <form className="modal wide" onSubmit={submit}>
        <header className="modal-head">
          <h2>{isEdit ? 'Ubah profil' : 'Profil baru'}</h2>
          <button type="button" className="btn ghost" onClick={props.onCancel} aria-label="Tutup">
            ✕
          </button>
        </header>

        <div className="form-grid">
          <label className="field">
            <span>Nama profil</span>
            <input value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="mis. Microstock 3 - Yubi" autoFocus />
          </label>

          <label className="field">
            <span>Grup</span>
            <select value={v.groupId ?? ''} onChange={(e) => set('groupId', e.target.value || null)}>
              <option value="">Tanpa grup</option>
              {props.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field span-2">
            <span>Catatan (opsional)</span>
            <input value={v.notes} onChange={(e) => set('notes', e.target.value)} placeholder="mis. akun Adobe + Shutterstock punya Mbak Rizka" />
          </label>

          <div className="field span-2 proxy-box">
            <span>Proxy</span>
            <input
              value={paste}
              onChange={(e) => applyPaste(e.target.value)}
              placeholder="Tempel proxy di sini: host:port:user:pass, user:pass@host:port, socks5://… (otomatis diisi ke bawah)"
              autoComplete="off"
              spellCheck={false}
            />
            {pasteMsg && <div className={`small ${pasteMsg.ok ? 'ok-text' : 'danger-text'}`}>{pasteMsg.text}</div>}

            <div className="proxy-grid">
              <label className="field">
                <span>Jenis</span>
                <select value={v.proxy.type} onChange={(e) => changeType(e.target.value as ProxyType)}>
                  {(Object.keys(PROXY_LABEL) as ProxyType[]).map((t) => (
                    <option key={t} value={t}>
                      {PROXY_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              {!direct && (
                <>
                  <label className="field">
                    <span>Host</span>
                    <input value={v.proxy.host} onChange={(e) => setProxy('host', e.target.value)} placeholder="142.111.126.243" spellCheck={false} />
                  </label>
                  <label className="field port">
                    <span>Port</span>
                    <input type="number" min={1} max={65535} value={v.proxy.port || ''} onChange={(e) => setProxy('port', Number(e.target.value))} />
                  </label>
                  <label className="field">
                    <span>Username (opsional)</span>
                    <input value={v.proxy.username} onChange={(e) => setProxy('username', e.target.value)} autoComplete="off" spellCheck={false} />
                  </label>
                  <label className="field">
                    <span>Password</span>
                    <div className="pw">
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={v.proxyPassword}
                        onChange={(e) => {
                          set('proxyPassword', e.target.value)
                          setTest(null)
                        }}
                        autoComplete="new-password"
                        disabled={v.clearProxyPassword}
                        placeholder={hadPw ? 'Kosongkan = pakai password lama' : ''}
                      />
                      <button type="button" className="btn ghost" onClick={() => setShowPw((s) => !s)}>
                        {showPw ? 'Sembunyikan' : 'Lihat'}
                      </button>
                    </div>
                  </label>
                </>
              )}
            </div>
            {!direct && hadPw && (
              <label className="check">
                <input type="checkbox" checked={Boolean(v.clearProxyPassword)} onChange={(e) => set('clearProxyPassword', e.target.checked)} />
                Hapus password proxy tersimpan
              </label>
            )}
            {direct && <div className="hint">Tanpa proxy: Chrome memakai internet dan IP komputer ini.</div>}
          </div>

          <label className="field span-2">
            <span>Halaman awal (satu per baris, opsional)</span>
            <textarea rows={3} value={v.startText} onChange={(e) => set('startText', e.target.value)} placeholder="https://contributor.stock.adobe.com/" spellCheck={false} />
            <div className="chips">
              {START_PRESETS.map((s) => (
                <button type="button" key={s.url} className="chip" onClick={() => addStart(s.url)} title={s.url}>
                  + {s.label}
                </button>
              ))}
            </div>
          </label>

          <div className="field span-2">
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
        </div>

        {test && (
          <div className={`test ${test === 'running' ? 'running' : test.state === 'ok' ? 'ok' : 'fail'}`}>
            {test === 'running'
              ? 'Mengecek IP keluar…'
              : test.state === 'ok'
                ? `OK - IP keluar ${test.ip} (${test.ms} ms)`
                : `Gagal: ${test.error}`}
          </div>
        )}
        {error && <div className="banner danger">{error}</div>}

        <footer className="modal-foot">
          <button type="button" className="btn" onClick={() => void runTest()} disabled={test === 'running'}>
            {direct ? 'Cek IP' : 'Tes proxy'}
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
