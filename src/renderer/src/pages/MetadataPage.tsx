import { useEffect, useMemo, useState } from 'react'
import type { PickedFile, Settings } from '../../../shared/types'
import {
  ADOBE_CATEGORIES,
  AGENCY_CSV,
  AI_MODES,
  SHUTTERSTOCK_CATEGORIES,
  canInject,
  type AiMode,
  type FileMeta,
  type MetaRecord
} from '../../../shared/metadata'

type Props = { files: PickedFile[]; onGoUpload: () => void; onGoSettings: () => void }

const AGENCY_KEY = 'su.csvAgencies'
const STATUS: Record<MetaRecord['status'], string> = {
  none: 'Belum ada',
  generating: 'Membuat…',
  ready: 'Siap',
  saved: 'Tertanam di file',
  error: 'Gagal'
}

function loadAgencies(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(AGENCY_KEY) ?? 'null') as string[] | null
    return new Set(v ?? ['adobe', 'shutterstock'])
  } catch {
    return new Set(['adobe', 'shutterstock'])
  }
}

export default function MetadataPage({ files, onGoUpload, onGoSettings }: Props) {
  const [records, setRecords] = useState<Map<string, MetaRecord>>(new Map())
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [agencies, setAgencies] = useState<Set<string>>(loadAgencies)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const paths = useMemo(() => files.map((f) => f.path), [files])

  useEffect(() => {
    void window.api.hasAiKey().then(setHasKey)
    void window.api.getSettings().then(setSettings)
    return window.api.onMetaRecord((r) => setRecords((m) => new Map(m).set(r.path, r)))
  }, [])

  useEffect(() => {
    let stop = false
    void (async () => {
      const list = await window.api.metaList(paths)
      if (stop) return
      setRecords(new Map(list.map((r) => [r.path, r])))
      // Metadata yang sudah ada di CSV (master atau CSV platform) langsung dipakai, gratis.
      if (!list.some((r) => r.status === 'none' || r.status === 'error')) return
      const r = await window.api.metaImportCsv(paths, false, false).catch(() => null)
      if (!stop && r?.filled) setNote(`${r.filled} file diisi dari CSV (${r.sources.join(', ')}), tanpa AI.`)
    })()
    return () => {
      stop = true
    }
  }, [paths])

  useEffect(() => {
    try {
      localStorage.setItem(AGENCY_KEY, JSON.stringify([...agencies]))
    } catch {
      // abaikan
    }
  }, [agencies])

  const list = files.map((f) => records.get(f.path)).filter((r): r is MetaRecord => Boolean(r))
  const count = (s: MetaRecord['status'][]) => list.filter((r) => s.includes(r.status)).length
  const todo = list.filter((r) => r.status === 'none' || r.status === 'error')
  const withMeta = list.filter((r) => r.title && r.keywords.length)
  const generating = count(['generating'])
  const mode = settings?.aiMode ?? 'hemat'
  const videoTodo = todo.filter((r) => /\.(mp4|mov)$/i.test(r.name)).length
  const cost = mode === 'gratis' ? 0 : mode === 'detail' ? videoTodo * 20 + (todo.length - videoTodo) * 3 : todo.length * 3

  async function run(fn: () => Promise<void>) {
    setError('')
    setNote('')
    try {
      await fn()
    } catch (err) {
      setError(String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const generate = (ps: string[], overwrite: boolean) =>
    run(async () => {
      const r = await window.api.metaGenerate(ps, overwrite)
      setNote(
        r.queued
          ? `${r.queued} file sedang dibuatkan metadata.${r.skipped ? ` ${r.skipped} dilewati karena sudah punya metadata.` : ''}`
          : 'Semua file sudah punya metadata. Pakai "Buat ulang" di tiap file kalau perlu.'
      )
    })

  const injectAll = () =>
    run(async () => {
      const r = await window.api.metaInject(withMeta.map((x) => x.path))
      setNote(
        [
          r.saved && `${r.saved} file ditanami metadata (file asli dicadangkan dulu).`,
          r.previews && `${r.previews} JPG pratinjau PSD dibuat dengan nama yang sama (wajib untuk Freepik).`,
          r.smallPreviews.length &&
            `Pratinjau di bawah 2.000 px, Freepik bisa menolak: ${r.smallPreviews.slice(0, 3).join(', ')}${r.smallPreviews.length > 3 ? ', …' : ''}.`,
          r.csvOnly && `${r.csvOnly} file (SVG/ZIP) hanya lewat CSV.`,
          r.failed && `${r.failed} gagal, lihat pesan di file tersebut.`
        ]
          .filter(Boolean)
          .join(' ') || 'Tidak ada yang ditanam.'
      )
    })

  const exportCsv = () =>
    run(async () => {
      const r = await window.api.metaExportCsv(
        withMeta.map((x) => x.path),
        [...agencies]
      )
      if (r) {
        setNote(`${r.files.length} file CSV disimpan (${r.rows} baris). Upload di halaman Submit tiap agensi.`)
        if (r.files[0]) void window.api.showInFolder(r.files[0])
      }
    })

  const importCsv = (pick: boolean) =>
    run(async () => {
      const r = await window.api.metaImportCsv(paths, pick, pick)
      if (!r) return
      const parts = [
        r.filled ? `${r.filled} file diisi dari CSV${r.sources.length ? ` (${r.sources.join(', ')})` : ''}.` : 'Tidak ada file yang cocok di CSV.',
        r.notFound && `${r.notFound} file tidak ada di CSV.`,
        r.skipped && `${r.skipped} file sudah punya metadata, tidak ditimpa.`
      ]
      setNote(parts.filter(Boolean).join(' '))
    })

  async function changeMode(m: AiMode) {
    setSettings(await window.api.saveSettings({ aiMode: m }))
  }

  if (!files.length) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Metadata</h1>
          </div>
        </header>
        <div className="empty">
          <h2>Belum ada file</h2>
          <p>Tambahkan file di halaman Upload dulu. Metadata dibuat untuk file yang ada di daftar itu, sebelum diupload.</p>
          <button className="btn primary" onClick={onGoUpload}>
            Ke halaman Upload
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Metadata</h1>
          <p className="muted">
            {list.length} file · {withMeta.length} punya metadata · {count(['saved'])} tertanam di file
            {generating > 0 && ` · ${generating} sedang dibuat`}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" disabled={!withMeta.length} onClick={() => void injectAll()} title="Tanam judul, deskripsi, dan keyword ke file (JPG, PNG, EPS, AI, MP4, MOV)">
            Simpan ke file
          </button>
        </div>
      </header>

      {hasKey === false && (
        <div className="banner danger">
          API key Ciora belum diisi.{' '}
          <button className="link" onClick={onGoSettings}>
            Isi di Pengaturan
          </button>
        </div>
      )}
      {error && <div className="banner danger">{error}</div>}
      {note && <div className="banner info">{note}</div>}

      <section className="panel meta-bar">
        <div className="meta-bar-row">
          <label className="inline-field">
            Mode AI
            <select value={mode} onChange={(e) => void changeMode(e.target.value as AiMode)}>
              {(Object.keys(AI_MODES) as AiMode[]).map((k) => (
                <option key={k} value={k}>
                  {AI_MODES[k].label}
                </option>
              ))}
            </select>
          </label>
          <span className="muted small grow">{AI_MODES[mode].hint}</span>
          {generating > 0 ? (
            <button className="btn" onClick={() => void window.api.metaCancel()}>
              Hentikan
            </button>
          ) : (
            <button className="btn primary" disabled={!todo.length || !hasKey} onClick={() => void generate(todo.map((r) => r.path), false)}>
              Buat metadata ({todo.length})
            </button>
          )}
        </div>
        {todo.length > 0 && !generating && (
          <div className="muted small">Perkiraan biaya: {cost ? `± Rp ${cost.toLocaleString('id-ID')}` : 'gratis'} untuk {todo.length} file.</div>
        )}
        <div className="meta-bar-row">
          <span className="small">Dari CSV:</span>
          <span className="muted small grow">
            Pakai judul dan keyword yang sudah ada di metadata-master.csv atau CSV platform (dicocokkan lewat nama file). Gratis, tanpa AI.
          </span>
          <button className="btn" disabled={generating > 0} onClick={() => void importCsv(false)} title="Cari CSV di folder file, folder di atasnya, dan _FILE-KERJA/metadata-master.csv">
            Ambil dari CSV
          </button>
          <button className="btn" disabled={generating > 0} onClick={() => void importCsv(true)} title="Pilih file CSV sendiri; isian yang ada ditimpa">
            Pilih CSV…
          </button>
        </div>
        <div className="meta-bar-row csv-row">
          <span className="small">CSV untuk:</span>
          {AGENCY_CSV.map((a) => (
            <label key={a.key} className="check small">
              <input
                type="checkbox"
                checked={agencies.has(a.key)}
                onChange={() => {
                  const n = new Set(agencies)
                  if (n.has(a.key)) n.delete(a.key)
                  else n.add(a.key)
                  setAgencies(n)
                }}
              />
              {a.name}
            </label>
          ))}
          <span className="spacer" />
          <button className="btn" disabled={!withMeta.length || !agencies.size} onClick={() => void exportCsv()}>
            Download CSV
          </button>
        </div>
      </section>

      <div className="meta-list">
        {list.map((r) => (
          <MetaCard key={r.path} r={r} onRegenerate={() => void generate([r.path], true)} canGenerate={Boolean(hasKey)} />
        ))}
      </div>
    </div>
  )
}

function MetaCard({ r, onRegenerate, canGenerate }: { r: MetaRecord; onRegenerate: () => void; canGenerate: boolean }) {
  const [title, setTitle] = useState(r.title)
  const [desc, setDesc] = useState(r.description)
  const [kw, setKw] = useState(r.keywords.join(', '))
  const [notes, setNotes] = useState(r.notes)

  // Hasil AI baru menimpa isian.
  useEffect(() => {
    setTitle(r.title)
    setDesc(r.description)
    setKw(r.keywords.join(', '))
    setNotes(r.notes)
  }, [r.generatedAt, r.path]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = (patch: Partial<FileMeta>) => void window.api.metaUpdate(r.path, patch)
  const kwList = kw.split(',').map((k) => k.trim()).filter(Boolean)
  const ext = r.name.split('.').pop() ?? ''
  const busy = r.status === 'generating'

  return (
    <article className={`meta-card ${busy ? 'busy' : ''}`}>
      <div className="meta-thumb">{r.thumb ? <img src={r.thumb} alt="" /> : <span className="ext">{ext.toUpperCase()}</span>}</div>
      <div className="meta-body">
        <div className="meta-top">
          <span className="file-name" title={r.path}>
            {r.name}
          </span>
          <span className={`pill pill-${r.status === 'saved' ? 'done' : r.status === 'error' ? 'failed' : r.status === 'generating' ? 'uploading' : r.status}`}>
            {STATUS[r.status]}
          </span>
          {!canInject(ext) && <span className="muted small">hanya CSV</span>}
          <span className="spacer" />
          <button className="btn small" disabled={busy || !canGenerate} onClick={onRegenerate}>
            {r.title ? 'Buat ulang' : 'Buat'}
          </button>
        </div>
        {(r.tech || r.model) && (
          <div className="muted small">
            {r.tech}
            {r.model && ` · ${r.model.startsWith('CSV') ? r.model : `AI: ${r.model}`}`}
          </div>
        )}
        {r.error && <div className="small danger-text">{r.error}</div>}

        <label className="mfield">
          <span>
            Judul <em className={title.length > 70 ? 'danger-text' : ''}>{title.length}/70</em>
          </span>
          <input value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== r.title && save({ title: title.trim() })} />
        </label>
        <label className="mfield">
          <span>
            Deskripsi <em className={desc.length > 200 ? 'danger-text' : ''}>{desc.length}/200</em>
          </span>
          <textarea rows={2} value={desc} disabled={busy} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== r.description && save({ description: desc.trim() })} />
        </label>
        <label className="mfield">
          <span>
            Keyword <em className={kwList.length < 7 || kwList.length > 49 ? 'danger-text' : ''}>{kwList.length}</em>
            <em className="muted"> · 10 pertama paling penting</em>
          </span>
          <textarea
            rows={3}
            value={kw}
            disabled={busy}
            onChange={(e) => setKw(e.target.value)}
            onBlur={() => kwList.join(', ') !== r.keywords.join(', ') && save({ keywords: kwList })}
          />
        </label>
        <div className="meta-row">
          <label className="mfield">
            <span>Kategori Adobe</span>
            <select value={r.adobeCategory} disabled={busy} onChange={(e) => save({ adobeCategory: Number(e.target.value) })}>
              {Object.entries(ADOBE_CATEGORIES).map(([n, name]) => (
                <option key={n} value={n}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {[0, 1].map((i) => (
            <label key={i} className="mfield">
              <span>Kategori Shutterstock {i + 1}</span>
              <select
                value={r.ssCategories[i] ?? ''}
                disabled={busy}
                onChange={(e) => {
                  const next = [...r.ssCategories]
                  next[i] = e.target.value
                  save({ ssCategories: next.filter(Boolean) })
                }}
              >
                <option value="">—</option>
                {SHUTTERSTOCK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="meta-row">
          <label className="mfield grow">
            <span>Catatan untuk AI (opsional)</span>
            <input
              placeholder="mis. dibuat dengan AI, seamless loop, green screen"
              value={notes}
              disabled={busy}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== r.notes && save({ notes: notes.trim() })}
            />
          </label>
          <label className="check small ai-check">
            <input type="checkbox" checked={r.aiGenerated} disabled={busy} onChange={(e) => save({ aiGenerated: e.target.checked })} />
            Dibuat dengan AI generatif
          </label>
        </div>
      </div>
    </article>
  )
}
