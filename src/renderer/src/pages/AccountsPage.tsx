import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Account, AccountInput, TestResult } from '../../../shared/types'
import { AGENCY_PRESETS, PROTOCOL_LABEL, presetByKey } from '../../../shared/presets'
import AccountForm from '../components/AccountForm'

type FormState = { mode: 'new' } | { mode: 'edit'; account: Account } | { mode: 'copy'; account: Account }

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormState | null>(null)
  const [tests, setTests] = useState<Record<string, TestResult | 'running'>>({})
  const [secureOk, setSecureOk] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setAccounts(await window.api.listAccounts())
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    void window.api.encryptionAvailable().then(setSecureOk)
  }, [refresh])

  const groups = useMemo(() => {
    const order = AGENCY_PRESETS.map((p) => p.key)
    const map = new Map<string, Account[]>()
    for (const a of accounts) map.set(a.agency, [...(map.get(a.agency) ?? []), a])
    return [...map.entries()]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([key, list]) => ({ key, name: presetByKey(key).name, list: list.sort((x, y) => x.name.localeCompare(y.name)) }))
  }, [accounts])

  async function runTest(a: Account) {
    setTests((t) => ({ ...t, [a.id]: 'running' }))
    const result = await window.api.testConnection({ ...a, password: '' })
    setTests((t) => ({ ...t, [a.id]: result }))
  }

  async function toggle(a: Account) {
    await window.api.saveAccount({ ...a, enabled: !a.enabled })
    await refresh()
  }

  async function remove(a: Account) {
    if (!window.confirm(`Hapus akun "${a.name}"? Password tersimpannya ikut terhapus.`)) return
    await window.api.deleteAccount(a.id)
    await refresh()
  }

  async function handleSave(input: AccountInput) {
    setError('')
    await window.api.saveAccount(input)
    setForm(null)
    await refresh()
  }

  const enabledCount = accounts.filter((a) => a.enabled).length

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Akun</h1>
          <p className="muted">
            {accounts.length} akun · {enabledCount} aktif · {groups.length} agensi
          </p>
        </div>
        <button className="btn primary" onClick={() => setForm({ mode: 'new' })} disabled={!secureOk}>
          + Tambah akun
        </button>
      </header>

      {!secureOk && (
        <div className="banner danger">
          Brankas password sistem tidak tersedia, jadi password belum bisa disimpan dengan aman.
        </div>
      )}
      {error && <div className="banner danger">{error}</div>}

      {loading ? (
        <p className="muted">Memuat…</p>
      ) : accounts.length === 0 ? (
        <div className="empty">
          <h2>Belum ada akun</h2>
          <p>
            Tambahkan akun pertamamu. Satu agensi boleh punya banyak akun, misalnya "Vecteezy - Utama" dan
            "Vecteezy - Kedua".
          </p>
          <button className="btn primary" onClick={() => setForm({ mode: 'new' })} disabled={!secureOk}>
            + Tambah akun
          </button>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="group">
            <h2 className="group-title">
              {g.name} <span className="count">{g.list.length}</span>
            </h2>
            <div className="cards">
              {g.list.map((a) => {
                const t = tests[a.id]
                return (
                  <article key={a.id} className={`card ${a.enabled ? '' : 'disabled'}`}>
                    <div className="card-top">
                      <span className="dot" style={{ background: a.color }} />
                      <div className="card-title">
                        <strong>{a.name}</strong>
                        <span className="muted small">
                          {PROTOCOL_LABEL[a.protocol]} · {a.host}:{a.port}
                        </span>
                      </div>
                      <label className="switch" title={a.enabled ? 'Aktif' : 'Nonaktif'}>
                        <input type="checkbox" checked={a.enabled} onChange={() => void toggle(a)} />
                        <span />
                      </label>
                    </div>
                    <div className="card-meta small">
                      <span>User: {a.username}</span>
                      {a.remoteDir && <span>Folder: {a.remoteDir}</span>}
                    </div>
                    {t && (
                      <div className={`test small ${t === 'running' ? 'running' : t.ok ? 'ok' : 'fail'}`}>
                        {t === 'running' ? 'Menguji koneksi…' : t.message}
                        {t !== 'running' && !t.ok && t.detail && <div className="detail">{t.detail}</div>}
                      </div>
                    )}
                    <div className="card-actions">
                      <button className="btn" onClick={() => void runTest(a)} disabled={t === 'running'}>
                        Tes koneksi
                      </button>
                      <button className="btn" onClick={() => setForm({ mode: 'edit', account: a })}>
                        Ubah
                      </button>
                      <button className="btn" onClick={() => setForm({ mode: 'copy', account: a })}>
                        Duplikat
                      </button>
                      <button className="btn ghost danger-text" onClick={() => void remove(a)}>
                        Hapus
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))
      )}

      {form && (
        <AccountForm
          mode={form.mode}
          account={form.mode === 'new' ? undefined : form.account}
          existing={accounts}
          onCancel={() => setForm(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
