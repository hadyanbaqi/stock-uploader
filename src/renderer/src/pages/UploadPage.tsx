import { useEffect, useMemo, useState, type DragEvent } from 'react'
import type { Account, AccountGroup, AddResult, PickedFile, PickResult } from '../../../shared/types'
import { AGENCY_PRESETS, NO_AI_AGENCIES, presetByKey } from '../../../shared/presets'
import { formatBytes } from '../format'
import { agencyFromPath } from '../../../shared/agencyFolder'

type Props = {
  files: PickedFile[]
  setFiles: (f: PickedFile[]) => void
  onQueued: () => void
  onGoAccounts: () => void
  onGoMetadata: () => void
}

const SELECTED_KEY = 'su.selectedAccounts'
const BYFOLDER_KEY = 'su.byFolder'

function loadSelected(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SELECTED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export default function UploadPage({ files, setFiles, onQueued, onGoAccounts, onGoMetadata }: Props) {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [groups, setGroups] = useState<AccountGroup[]>([])
  const [selected, setSelected] = useState<Set<string>>(loadSelected)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [groupName, setGroupName] = useState<string | null>(null)
  const [sent, setSent] = useState<Map<string, string[]>>(new Map())
  const [force, setForce] = useState(false)
  const [aiFiles, setAiFiles] = useState<Set<string>>(new Set())
  const [byFolder, setByFolder] = useState(() => {
    try {
      return localStorage.getItem(BYFOLDER_KEY) !== '0'
    } catch {
      return true
    }
  })

  useEffect(() => {
    void window.api.listAccounts().then(setAccounts)
    void window.api.listGroups().then(setGroups)
  }, [])

  const active = useMemo(() => (accounts ?? []).filter((a) => a.enabled), [accounts])
  const activeIds = useMemo(() => new Set(active.map((a) => a.id)), [active])
  const chosen = useMemo(() => [...selected].filter((id) => activeIds.has(id)), [selected, activeIds])

  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_KEY, JSON.stringify([...selected]))
    } catch {
      // abaikan
    }
  }, [selected])

  const byAgency = useMemo(() => {
    const order = AGENCY_PRESETS.map((p) => p.key)
    const map = new Map<string, Account[]>()
    for (const a of active) map.set(a.agency, [...(map.get(a.agency) ?? []), a])
    return [...map.entries()]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([key, list]) => ({ key, name: presetByKey(key).name, list: list.sort((x, y) => x.name.localeCompare(y.name)) }))
  }, [active])

  const totalSize = files.reduce((s, f) => s + f.size, 0)

  // Tandai file yang sudah pernah berhasil dikirim ke akun yang dicentang.
  const chosenKey = chosen.join(',')
  useEffect(() => {
    let stop = false
    const timer = setTimeout(async () => {
      if (!files.length || !chosen.length) return setSent(new Map())
      const r = await window.api.historyCheck(
        files.map((f) => f.path),
        chosen
      )
      if (!stop) setSent(new Map(r.map((x) => [x.path, x.accountIds])))
    }, 200)
    return () => {
      stop = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, chosenKey])

  const nameOf = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.name])), [accounts])

  // Mode "sesuai nama folder": file di folder ADOBE-STOCK hanya ke akun Adobe Stock, dst.
  const fileAgency = useMemo(() => new Map(files.map((f) => [f.path, agencyFromPath(f.path)])), [files])
  const detected = useMemo(() => {
    const m = new Map<string, { folders: Set<string>; count: number }>()
    for (const fa of fileAgency.values()) {
      if (!fa) continue
      const e = m.get(fa.agency) ?? { folders: new Set<string>(), count: 0 }
      e.folders.add(fa.folderName)
      e.count++
      m.set(fa.agency, e)
    }
    return m
  }, [fileAgency])
  const folderMode = byFolder && detected.size > 0
  const agencyOf = useMemo(() => new Map(active.map((a) => [a.id, a.agency])), [active])
  // Gambar AI generatif tidak dikirim ke agensi yang menolaknya (Shutterstock, Vecteezy, Alamy, iStock).
  useEffect(() => {
    let stop = false
    void window.api.metaAiFlags(files.map((f) => f.path)).then((list) => !stop && setAiFiles(new Set(list)))
    return () => {
      stop = true
    }
  }, [files])
  const targetsFor = (p: string): string[] => {
    let ids = chosen
    if (folderMode) {
      const a = fileAgency.get(p)?.agency
      ids = a ? chosen.filter((id) => agencyOf.get(id) === a) : []
    }
    if (aiFiles.has(p)) ids = ids.filter((id) => !NO_AI_AGENCIES.includes(agencyOf.get(id) ?? ''))
    return ids
  }
  const aiBlocked = files.filter((f) => aiFiles.has(f.path)).length > 0 && chosen.some((id) => NO_AI_AGENCIES.includes(agencyOf.get(id) ?? ''))
  let totalPairs = 0
  let sentPairs = 0
  let unrouted = 0
  for (const f of files) {
    const t = targetsFor(f.path)
    if (!t.length) unrouted++
    totalPairs += t.length
    sentPairs += (sent.get(f.path) ?? []).filter((id) => t.includes(id)).length
  }
  const totalUploads = totalPairs - (force ? 0 : sentPairs)

  function chooseByFolder() {
    const next = new Set(selected)
    for (const a of active) if (detected.has(a.agency)) next.add(a.id)
    setSelected(next)
  }

  function setMode(v: boolean) {
    setByFolder(v)
    try {
      localStorage.setItem(BYFOLDER_KEY, v ? '1' : '0')
    } catch {
      // abaikan
    }
  }

  function merge(r: PickResult) {
    const known = new Set(files.map((f) => f.path))
    const fresh = r.files.filter((f) => !known.has(f.path))
    setFiles([...files, ...fresh])
    const parts: string[] = []
    if (fresh.length) parts.push(`${fresh.length} file ditambahkan`)
    if (r.files.length - fresh.length) parts.push(`${r.files.length - fresh.length} sudah ada di daftar`)
    if (r.skipped) parts.push(`${r.skipped} file dilewati karena jenisnya tidak didukung`)
    setNote(parts.join(' · '))
    setError('')
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
    if (paths.length) merge(await window.api.expandPaths(paths))
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleGroup(g: AccountGroup) {
    const ids = g.accountIds.filter((id) => activeIds.has(id))
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id))
    const next = new Set(selected)
    for (const id of ids) {
      if (allOn) next.delete(id)
      else next.add(id)
    }
    setSelected(next)
  }

  async function saveGroup() {
    try {
      const g = await window.api.saveGroup({ name: groupName ?? '', accountIds: chosen })
      setGroups([...groups, g])
      setGroupName(null)
      setError('')
    } catch (err) {
      setError(cleanError(err))
    }
  }

  async function removeGroup(g: AccountGroup) {
    if (!window.confirm(`Hapus grup "${g.name}"? Akunnya tidak ikut terhapus.`)) return
    await window.api.deleteGroup(g.id)
    setGroups(groups.filter((x) => x.id !== g.id))
  }

  async function upload() {
    setBusy(true)
    setError('')
    try {
      // Kelompokkan file yang tujuannya sama, lalu masukkan ke antrean per kelompok.
      const groupsByTarget = new Map<string, { paths: string[]; ids: string[] }>()
      for (const f of files) {
        const ids = targetsFor(f.path)
        if (!ids.length) continue
        const k = ids.join(',')
        const g = groupsByTarget.get(k) ?? { paths: [], ids }
        g.paths.push(f.path)
        groupsByTarget.set(k, g)
      }
      const r: AddResult = { added: 0, duplicates: 0, sameName: 0, missing: 0, alreadySent: 0, wrongType: 0 }
      for (const g of groupsByTarget.values()) {
        const x = await window.api.queueAdd(g.paths, g.ids, force)
        r.added += x.added
        r.duplicates += x.duplicates
        r.sameName += x.sameName
        r.missing += x.missing
        r.alreadySent += x.alreadySent
        r.wrongType += x.wrongType
        r.wrongTypeNote ??= x.wrongTypeNote
        r.previewSkipped = (r.previewSkipped ?? 0) + (x.previewSkipped ?? 0)
      }
      const skipped = [
        r.alreadySent && `${r.alreadySent} sudah pernah dikirim ke akun itu`,
        r.duplicates && `${r.duplicates} sudah ada di antrean`,
        r.sameName && `${r.sameName} punya nama sama dengan file lain ke akun yang sama`,
        r.missing && `${r.missing} filenya tidak ditemukan`,
        r.wrongType && `${r.wrongType} jenis filenya tidak diterima (${r.wrongTypeNote})`,
        r.previewSkipped && `${r.previewSkipped} JPG pratinjau vektor tidak dikirim ke Adobe (Adobe membuat pratinjau sendiri dari EPS/AI/SVG)`
      ].filter(Boolean)
      if (!r.added) {
        setError(`Tidak ada yang ditambahkan: ${skipped.join(', ')}.`)
        return
      }
      if (skipped.length) window.alert(`${r.added} upload masuk antrean.\nDilewati: ${skipped.join(', ')}.`)
      setFiles([])
      setNote('')
      setForce(false)
      onQueued()
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  if (accounts && active.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Upload</h1>
          </div>
        </header>
        <div className="empty">
          <h2>Belum ada akun aktif</h2>
          <p>Tambahkan atau aktifkan akun agensi dulu, baru file bisa diupload.</p>
          <button className="btn primary" onClick={onGoAccounts}>
            Ke halaman Akun
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page upload-page">
      <header className="page-head">
        <div>
          <h1>Upload</h1>
          <p className="muted">Seret file, centang akun tujuan, lalu klik Upload.</p>
        </div>
      </header>

      {error && <div className="banner danger">{error}</div>}

      <section
        className={`dropzone ${dragging ? 'over' : ''} ${files.length ? 'compact' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => void onDrop(e)}
      >
        <div className="drop-title">Seret file atau folder ke sini</div>
        <div className="muted small">MP4, MOV, JPG, PNG, EPS, AI, SVG, ZIP · isi folder ikut dibaca</div>
        <div className="drop-actions">
          <button className="btn" onClick={async () => merge(await window.api.pickFiles())}>
            Pilih file
          </button>
          <button className="btn" onClick={async () => merge(await window.api.pickFolder())}>
            Pilih folder
          </button>
        </div>
        {note && <div className="small drop-note">{note}</div>}
      </section>

      {files.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <strong>
              {files.length} file · {formatBytes(totalSize)}
            </strong>
            <span className="spacer" />
            <button className="btn small" onClick={onGoMetadata} title="Buat judul, deskripsi, dan keyword dengan AI sebelum upload">
              ✎ Buat metadata
            </button>
            <button className="btn ghost small" onClick={() => (setFiles([]), setNote(''))}>
              Kosongkan
            </button>
          </div>
          <div className="file-list">
            {files.map((f) => (
              <div className="file-row" key={f.path}>
                <span className={`ext ext-${f.kind}`}>{f.ext.toUpperCase()}</span>
                <span className="file-name" title={f.path}>
                  {f.name}
                </span>
                {sent.get(f.path) && (
                  <span className="sent-tag" title={`Sudah pernah dikirim ke: ${sent.get(f.path)!.map((id) => nameOf.get(id) ?? id).join(', ')}`}>
                    sudah ke {sent.get(f.path)!.length} akun
                  </span>
                )}
                <span className="muted small">{formatBytes(f.size)}</span>
                <button className="icon-btn" title="Hapus dari daftar" onClick={() => setFiles(files.filter((x) => x.path !== f.path))}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {detected.size > 0 && (
        <section className="panel">
          <div className="panel-head">
            <strong>Tujuan</strong>
            <span className="spacer" />
            <div className="seg">
              <button className={byFolder ? 'on' : ''} onClick={() => setMode(true)} title="File di folder ADOBE-STOCK hanya ke akun Adobe Stock, dan seterusnya">
                Sesuai nama folder
              </button>
              <button className={!byFolder ? 'on' : ''} onClick={() => setMode(false)} title="Semua file ke semua akun yang dicentang">
                Semua akun yang dicentang
              </button>
            </div>
          </div>
          {folderMode && (
            <>
              <div className="route-list">
                {[...detected.entries()].map(([agency, d]) => {
                  const ids = chosen.filter((id) => agencyOf.get(id) === agency)
                  return (
                    <div key={agency} className={`route ${ids.length ? '' : 'warn'}`}>
                      <span className="folder">{[...d.folders].join(', ')}</span>
                      <span className="muted">{d.count} file →</span>
                      {ids.length ? (
                        <span>{ids.map((id) => nameOf.get(id)).join(', ')}</span>
                      ) : (
                        <span>
                          belum ada akun {presetByKey(agency).name} yang dicentang
                          {!active.some((a) => a.agency === agency) && ' (tambahkan dulu di halaman Akun)'}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="field-row" style={{ marginTop: 10 }}>
                <button className="btn small" onClick={chooseByFolder}>
                  Centang akun sesuai folder
                </button>
                {unrouted > 0 && <span className="muted small">{unrouted} file tidak terkirim: folder agensinya tidak dikenali atau akunnya belum dicentang.</span>}
              </div>
            </>
          )}
        </section>
      )}

      {aiBlocked && (
        <div className="banner info">
          {aiFiles.size} file ditandai buatan AI generatif. File itu tidak dikirim ke Shutterstock, Vecteezy, Alamy, dan iStock karena
          mereka menolak konten AI; ke Adobe tetap jalan (tandai AI saat submit).
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <strong>Akun tujuan</strong>
          <span className="muted small">
            {chosen.length} dari {active.length} dipilih
          </span>
          <span className="spacer" />
          <button className="btn ghost small" onClick={() => setSelected(new Set(activeIds))}>
            Pilih semua
          </button>
          <button className="btn ghost small" onClick={() => setSelected(new Set())}>
            Kosongkan
          </button>
        </div>

        <div className="chips">
          {groups.map((g) => {
            const ids = g.accountIds.filter((id) => activeIds.has(id))
            const on = ids.length > 0 && ids.every((id) => selected.has(id))
            return (
              <span key={g.id} className={`chip ${on ? 'on' : ''}`}>
                <button className="chip-main" onClick={() => toggleGroup(g)} title="Centang semua akun di grup ini">
                  {g.name} <span className="muted">{ids.length}</span>
                </button>
                <button className="chip-x" title="Hapus grup" onClick={() => void removeGroup(g)}>
                  ×
                </button>
              </span>
            )
          })}
          {groupName === null ? (
            <button className="btn ghost small" disabled={!chosen.length} onClick={() => setGroupName('')}>
              + Simpan pilihan jadi grup
            </button>
          ) : (
            <span className="group-new">
              <input
                autoFocus
                placeholder="Nama grup, mis. Video"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveGroup()
                  if (e.key === 'Escape') setGroupName(null)
                }}
              />
              <button className="btn small primary" onClick={() => void saveGroup()}>
                Simpan
              </button>
              <button className="btn ghost small" onClick={() => setGroupName(null)}>
                Batal
              </button>
            </span>
          )}
        </div>

        {byAgency.map((g) => (
          <div key={g.key} className="pick-group">
            <div className="pick-agency muted small">{g.name}</div>
            <div className="pick-list">
              {g.list.map((a) => (
                <label key={a.id} className={`pick ${selected.has(a.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                  <span className="dot" style={{ background: a.color }} />
                  <span className="pick-name">{a.name}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
        {accounts && accounts.length > active.length && (
          <p className="muted small">{accounts.length - active.length} akun nonaktif tidak ditampilkan.</p>
        )}
      </section>

      <footer className="upload-bar">
        <span>
          {folderMode ? `${files.length} file sesuai folder` : `${files.length} file × ${chosen.length} akun`} ={' '}
          <strong>{Math.max(0, totalUploads)} upload</strong>
          {sentPairs > 0 && !force && <span className="muted small"> · {sentPairs} dilewati karena sudah pernah dikirim</span>}
        </span>
        <span className="spacer" />
        {sentPairs > 0 && (
          <label className="check">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Kirim ulang yang sudah pernah
          </label>
        )}
        <button className="btn primary big" disabled={busy || !files.length || !chosen.length || totalUploads <= 0} onClick={() => void upload()}>
          {busy ? 'Menambahkan…' : 'Upload'}
        </button>
      </footer>
    </div>
  )
}

function cleanError(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
