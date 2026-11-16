import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { maskProxy, type BrowserProfile, type IpStatus, type ProfileInput, type ProfilesState } from '../../../shared/profiles'
import type { Settings } from '../../../shared/types'
import ProfileForm from '../components/ProfileForm'

/** 'all' = semua profil, 'none' = tanpa grup, selain itu id grup. */
type GroupFilter = 'all' | 'none' | string

type FormState = { mode: 'new' } | { mode: 'edit'; profile: BrowserProfile }

const EMPTY: ProfilesState = { profiles: [], groups: [], running: [], testing: [], browserPath: null }

const clean = (err: unknown) => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const timeFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function StatusCell({ s, testing }: { s: IpStatus; testing: boolean }) {
  if (testing) return <span className="pill pill-uploading">Mengecek…</span>
  const when = s.at ? ` · ${timeFmt.format(new Date(s.at))}` : ''
  switch (s.state) {
    case 'ok':
      return (
        <span className="pf-status" title={`Dites${when}`}>
          <span className="pill pill-done">OK</span> <span className="pf-ip">{s.ip}</span>
          {s.ms !== undefined && <span className="muted small"> {s.ms} ms</span>}
        </span>
      )
    case 'fail':
      return (
        <span className="pf-status" title={`${s.error ?? ''}${when}`}>
          <span className="pill pill-failed">Gagal</span> <span className="muted small pf-err">{s.error}</span>
        </span>
      )
    case 'changed':
      return (
        <span className="pf-status" title={s.ip ? `IP sebelumnya ${s.ip}` : undefined}>
          <span className="pill pf-pill-warn">Berubah - belum dites</span>
        </span>
      )
    default:
      return <span className="muted small">Belum dites</span>
  }
}

export default function ProfilesPage() {
  const [st, setSt] = useState<ProfilesState>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<GroupFilter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [groupEdit, setGroupEdit] = useState<{ id?: string; name: string } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setSt(await window.api.profilesState())
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    void window.api.getSettings().then(setSettings)
    return window.api.onProfilesChanged(setSt)
  }, [refresh])

  const running = useMemo(() => new Set(st.running), [st.running])
  const testing = useMemo(() => new Set(st.testing), [st.testing])
  const groupName = useMemo(() => new Map(st.groups.map((g) => [g.id, g.name])), [st.groups])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of st.profiles) {
      const k = p.groupId ?? 'none'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [st.profiles])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return st.profiles
      .filter((p) => (filter === 'all' ? true : filter === 'none' ? !p.groupId : p.groupId === filter))
      .filter((p) => !q || `${p.name} ${p.notes} ${p.proxy.host} ${p.ipStatus.ip ?? ''}`.toLowerCase().includes(q))
  }, [st.profiles, filter, query])

  // Pilihan yang tidak terlihat lagi (pindah grup/terhapus) dibuang.
  useEffect(() => {
    const ids = new Set(visible.map((p) => p.id))
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [visible])

  const selectedList = visible.filter((p) => selected.has(p.id))
  const targets = selectedList.length ? selectedList : []

  function clickRow(e: React.MouseEvent, id: string) {
    if (e.shiftKey && anchor.current) {
      const ids = visible.map((p) => p.id)
      const a = ids.indexOf(anchor.current)
      const b = ids.indexOf(id)
      if (a >= 0 && b >= 0) {
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
        setSelected((prev) => new Set([...(e.ctrlKey || e.metaKey ? prev : []), ...range]))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else {
      setSelected(new Set([id]))
    }
    anchor.current = id
  }

  function toggleCheck(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    anchor.current = id
  }

  const allChecked = visible.length > 0 && visible.every((p) => selected.has(p.id))

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setError('')
    try {
      return await fn()
    } catch (err) {
      setError(clean(err))
      return undefined
    }
  }

  async function open(list: BrowserProfile[]) {
    if (!list.length) return
    setInfo('')
    setBusy(true)
    const res = await run(() => window.api.profileOpen(list.map((p) => p.id)))
    setBusy(false)
    if (!res) return
    const failed = res.filter((r) => !r.ok)
    if (failed.length) setError(failed.map((r) => r.message).join('\n'))
    const ok = res.filter((r) => r.ok).length
    if (ok) setInfo(list.length === 1 ? res[0].message : `${ok} dari ${list.length} profil dibuka.`)
  }

  async function test(list: BrowserProfile[]) {
    if (!list.length) return
    await run(() => window.api.profileTest(list.map((p) => p.id)))
  }

  async function close(list: BrowserProfile[]) {
    await run(() => window.api.profileClose(list.filter((p) => running.has(p.id)).map((p) => p.id)))
  }

  async function remove(list: BrowserProfile[]) {
    if (!list.length) return
    if (list.some((p) => running.has(p.id))) {
      setError('Tutup dulu Chrome profil yang mau dihapus.')
      return
    }
    const names = list.length === 1 ? `"${list[0].name}"` : `${list.length} profil`
    if (!window.confirm(`Hapus ${names}?`)) return
    const deleteData = window.confirm(
      'Hapus juga data Chrome-nya (login, cookie, riwayat, ekstensi)?\n\nOK = hapus semuanya.\nBatal = data tetap disimpan di komputer.'
    )
    await run(() => window.api.profileRemove(list.map((p) => p.id), deleteData))
    setSelected(new Set())
  }

  async function duplicate(p: BrowserProfile) {
    const copy = await run(() => window.api.profileDuplicate(p.id))
    if (copy) setInfo(`"${copy.name}" dibuat. Login dan cookie tidak ikut disalin.`)
  }

  async function move(list: BrowserProfile[], groupId: string) {
    if (!list.length || !groupId) return
    await run(() => window.api.profileMove(list.map((p) => p.id), groupId === 'none' ? null : groupId))
  }

  async function saveProfile(input: ProfileInput) {
    await window.api.profileSave(input)
    setForm(null)
  }

  async function saveGroup() {
    if (!groupEdit) return
    const g = await run(() => window.api.profileGroupSave(groupEdit))
    if (g) {
      setGroupEdit(null)
      if (!groupEdit.id) setFilter(g.id)
    }
  }

  async function removeGroup(id: string) {
    const name = groupName.get(id) ?? ''
    if (!window.confirm(`Hapus grup "${name}"? Profil di dalamnya tidak ikut terhapus, hanya jadi "Tanpa grup".`)) return
    await run(() => window.api.profileGroupRemove(id))
    if (filter === id) setFilter('all')
  }

  async function saveSetting(patch: Partial<Settings>) {
    const s = await run(() => window.api.saveSettings(patch))
    if (s) {
      setSettings(s)
      await refresh()
    }
  }

  async function pickBrowser() {
    const p = await run(() => window.api.pickBrowser())
    if (p) {
      setSettings(await window.api.getSettings())
      await refresh()
    }
  }

  const sameIp = useMemo(() => {
    const seen = new Map<string, number>()
    for (const p of st.profiles) if (p.ipStatus.state === 'ok' && p.ipStatus.ip) seen.set(p.ipStatus.ip, (seen.get(p.ipStatus.ip) ?? 0) + 1)
    return new Set([...seen].filter(([, n]) => n > 1).map(([ip]) => ip))
  }, [st.profiles])

  const filterLabel = filter === 'all' ? 'Semua profil' : filter === 'none' ? 'Tanpa grup' : groupName.get(filter) ?? ''

  return (
    <div className="page pf-page">
      <header className="page-head">
        <div>
          <h1>Profil Browser</h1>
          <p className="muted">
            {st.profiles.length} profil · {running.size} terbuka · Chrome terpisah per profil (login & cookie sendiri)
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>
            ⚙ Pengaturan
          </button>
          <button className="btn primary" onClick={() => setForm({ mode: 'new' })}>
            + Profil baru
          </button>
        </div>
      </header>

      {!loading && !st.browserPath && (
        <div className="banner danger">
          Chrome tidak ditemukan di komputer ini.{' '}
          <button className="link" onClick={() => void pickBrowser()}>
            Pilih lokasi Chrome…
          </button>
        </div>
      )}

      {showSettings && settings && (
        <section className="pf-settings">
          <div className="pf-setting">
            <span className="muted small">Chrome</span>
            <code className="pf-path" title={st.browserPath ?? ''}>
              {st.browserPath ?? 'tidak ditemukan'}
            </code>
            <button className="btn small" onClick={() => void pickBrowser()}>
              Pilih…
            </button>
            {settings.browserPath && (
              <button className="btn small ghost" onClick={() => void saveSetting({ browserPath: '' })}>
                Cari otomatis
              </button>
            )}
          </div>
          <label className="pf-setting">
            <span className="muted small">Jeda saat buka banyak</span>
            <input
              type="number"
              min={0}
              max={30}
              value={settings.browserDelay}
              onChange={(e) => void saveSetting({ browserDelay: Number(e.target.value) })}
              className="pf-num"
            />
            <span className="muted small">detik</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.browserTestFirst} onChange={(e) => void saveSetting({ browserTestFirst: e.target.checked })} />
            Tes proxy dulu sebelum membuka (profil tidak dibuka kalau proxy gagal, supaya IP asli tidak terpakai)
          </label>
        </section>
      )}

      {info && (
        <div className="banner info" onClick={() => setInfo('')}>
          {info}
        </div>
      )}
      {error && (
        <div className="banner danger pf-pre" onClick={() => setError('')}>
          {error}
        </div>
      )}

      <div className="pf-layout">
        <aside className="pf-groups">
          <div className="pf-groups-head">
            <strong>Grup</strong>
            <button className="btn small" onClick={() => setGroupEdit({ name: '' })}>
              + Grup
            </button>
          </div>
          {groupEdit && (
            <form
              className="pf-group-form"
              onSubmit={(e) => {
                e.preventDefault()
                void saveGroup()
              }}
            >
              <input
                autoFocus
                value={groupEdit.name}
                onChange={(e) => setGroupEdit({ ...groupEdit, name: e.target.value })}
                placeholder="Nama grup"
                onKeyDown={(e) => e.key === 'Escape' && setGroupEdit(null)}
              />
              <button className="btn small primary" type="submit">
                Simpan
              </button>
            </form>
          )}
          <nav className="pf-group-list">
            <button className={`pf-group ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
              <span>Semua</span>
              <span className="count">{st.profiles.length}</span>
            </button>
            {st.groups.map((g) => (
              <div key={g.id} className={`pf-group ${filter === g.id ? 'active' : ''}`}>
                <button className="pf-group-name" onClick={() => setFilter(g.id)} onDoubleClick={() => setGroupEdit({ id: g.id, name: g.name })}>
                  {g.name}
                </button>
                <span className="count">{counts.get(g.id) ?? 0}</span>
                <button className="pf-icon" title="Ubah nama" onClick={() => setGroupEdit({ id: g.id, name: g.name })}>
                  ✎
                </button>
                <button className="pf-icon" title="Hapus grup" onClick={() => void removeGroup(g.id)}>
                  ✕
                </button>
              </div>
            ))}
            <button className={`pf-group ${filter === 'none' ? 'active' : ''}`} onClick={() => setFilter('none')}>
              <span>Tanpa grup</span>
              <span className="count">{counts.get('none') ?? 0}</span>
            </button>
          </nav>
        </aside>

        <section className="pf-main">
          <div className="pf-toolbar">
            <strong>{filterLabel}</strong>
            <input className="pf-search" placeholder="Cari nama, catatan, proxy, IP…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="spacer" />
            {targets.length > 0 ? (
              <>
                <span className="muted small">{targets.length} dipilih</span>
                <button className="btn small primary" disabled={busy || !st.browserPath} onClick={() => void open(targets)}>
                  ▶ Buka
                </button>
                <button className="btn small" onClick={() => void test(targets)}>
                  Tes IP
                </button>
                {targets.some((p) => running.has(p.id)) && (
                  <button className="btn small" onClick={() => void close(targets)}>
                    Tutup
                  </button>
                )}
                <select className="pf-move" value="" onChange={(e) => void move(targets, e.target.value)} title="Pindahkan ke grup">
                  <option value="">Pindah ke…</option>
                  {st.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                  <option value="none">Tanpa grup</option>
                </select>
                <button className="btn small ghost danger-text" onClick={() => void remove(targets)}>
                  Hapus
                </button>
              </>
            ) : (
              <>
                <button className="btn small" disabled={!visible.length} onClick={() => void test(visible)}>
                  Tes IP semua
                </button>
                <button className="btn small primary" disabled={busy || !visible.length || !st.browserPath} onClick={() => void open(visible)}>
                  ▶ Buka semua ({visible.length})
                </button>
              </>
            )}
          </div>

          {loading ? (
            <p className="muted">Memuat…</p>
          ) : st.profiles.length === 0 ? (
            <div className="empty">
              <h2>Belum ada profil</h2>
              <p>
                Satu profil = satu Chrome terpisah dengan login, cookie, dan proxy sendiri. Cocok untuk membuka dasbor beberapa
                akun kontributor sekaligus tanpa saling logout.
              </p>
              <button className="btn primary" onClick={() => setForm({ mode: 'new' })}>
                + Profil baru
              </button>
            </div>
          ) : visible.length === 0 ? (
            <p className="muted">Tidak ada profil di sini.</p>
          ) : (
            <div className="table-wrap">
              <table className="table pf-table">
                <thead>
                  <tr>
                    <th className="pf-check">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(visible.map((p) => p.id)))}
                        aria-label="Pilih semua"
                      />
                    </th>
                    <th className="num">No</th>
                    <th>Nama</th>
                    <th>Proxy</th>
                    <th>Status / IP keluar</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p, i) => {
                    const isRunning = running.has(p.id)
                    const dupIp = p.ipStatus.state === 'ok' && p.ipStatus.ip && sameIp.has(p.ipStatus.ip)
                    return (
                      <tr
                        key={p.id}
                        className={`${selected.has(p.id) ? 'pf-selected' : ''} ${isRunning ? 'pf-running' : ''}`}
                        onClick={(e) => clickRow(e, p.id)}
                        onDoubleClick={() => void open([p])}
                        title="Klik = pilih · Ctrl/Shift + klik = pilih banyak · Klik dua kali = buka"
                      >
                        <td className="pf-check" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleCheck(p.id)} aria-label={`Pilih ${p.name}`} />
                        </td>
                        <td className="num muted">{i + 1}</td>
                        <td>
                          <div className="pf-name">
                            <span className="dot inline" style={{ background: p.color }} />
                            <strong>{p.name}</strong>
                            {isRunning && <span className="pill pill-done">Terbuka</span>}
                          </div>
                          {(p.notes || (filter === 'all' && p.groupId)) && (
                            <div className="muted small pf-sub">
                              {filter === 'all' && p.groupId && <span className="pf-tag">{groupName.get(p.groupId)}</span>}
                              {p.notes}
                            </div>
                          )}
                        </td>
                        <td className="pf-proxy" title={maskProxy(p.proxy, p.hasProxyPassword)}>
                          <code>{maskProxy(p.proxy, p.hasProxyPassword)}</code>
                        </td>
                        <td>
                          <StatusCell s={p.ipStatus} testing={testing.has(p.id)} />
                          {dupIp && <div className="small danger-text">IP sama dengan profil lain</div>}
                        </td>
                        <td className="pf-actions" onClick={(e) => e.stopPropagation()}>
                          {isRunning ? (
                            <button className="btn small" onClick={() => void close([p])}>
                              Tutup
                            </button>
                          ) : (
                            <button className="btn small primary" disabled={busy || !st.browserPath} onClick={() => void open([p])}>
                              ▶ Buka
                            </button>
                          )}
                          <details className="pf-more">
                            <summary className="btn small ghost" aria-label="Aksi lain">
                              ⋯
                            </summary>
                            <div className="pf-menu" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
                              {isRunning && <button onClick={() => void open([p])}>Jendela baru</button>}
                              <button onClick={() => void test([p])} disabled={testing.has(p.id)}>
                                Tes IP
                              </button>
                              <button onClick={() => setForm({ mode: 'edit', profile: p })}>Ubah</button>
                              <button onClick={() => void duplicate(p)}>Duplikat (tanpa login)</button>
                              <button onClick={() => void window.api.profileShowFolder(p.id)}>Buka folder data</button>
                              <button className="danger-text" onClick={() => void remove([p])}>
                                Hapus
                              </button>
                            </div>
                          </details>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small pf-foot">
            Klik = pilih · Ctrl/Shift + klik = pilih banyak · Klik dua kali = buka. Password proxy disimpan terenkripsi dan tidak pernah
            ditampilkan.
          </p>
        </section>
      </div>

      {form && (
        <ProfileForm
          mode={form.mode}
          profile={form.mode === 'edit' ? form.profile : undefined}
          groups={st.groups}
          defaultGroupId={filter !== 'all' && filter !== 'none' ? filter : null}
          onCancel={() => setForm(null)}
          onSave={saveProfile}
        />
      )}
    </div>
  )
}
