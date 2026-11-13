import { useEffect, useMemo, useState } from 'react'
import type { GenAction, GenBatch, GenJob, Settings } from '../../../shared/types'
import { DARK_FX_PROMPTS, GEN_TEMPLATES, VFX_PROMPTS } from '../../../shared/genTemplates'

type Props = {
  settings: Settings | null
  onSettings: (s: Settings) => void
  onToMetadata: (paths: string[]) => void
  onToAlpha: (paths: string[]) => void
  onGoSettings: () => void
}

const ASPECTS = ['16:9', '3:2', '4:3', '1:1', '2:3', '9:16']
const STATUS: Record<GenJob['status'], string> = {
  queued: 'Menunggu',
  running: 'Membuat…',
  ready: 'Siap',
  saved: 'Tersimpan',
  discarded: 'Dibuang',
  failed: 'Gagal',
  rejected: 'Ditolak',
  canceled: 'Dibatalkan'
}
const DRAFT_KEY = 'su.genDraft'

function cleanError(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export default function GeneratePage({ settings, onSettings, onToMetadata, onToAlpha, onGoSettings }: Props) {
  const [tab, setTab] = useState<'make' | 'history'>('make')
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [template, setTemplate] = useState('none')
  const [variants, setVariants] = useState(1)
  const [ref, setRef] = useState<{ path: string; thumb: string } | null>(null)
  const [models, setModels] = useState<string[] | null>(null)
  const [modelError, setModelError] = useState('')
  const [defaultDir, setDefaultDir] = useState('')
  const [jobs, setJobs] = useState<GenJob[]>([])
  const [batches, setBatches] = useState<GenBatch[]>([])
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [big, setBig] = useState<{ job: GenJob; url: string | null } | null>(null)
  const [shownBatches, setShownBatches] = useState(5)
  const [showIdeas, setShowIdeas] = useState(false)

  function addPrompts(list: string[], tpl: string) {
    const have = new Set(text.split(/\r?\n/).map((l) => l.trim()))
    const fresh = list.filter((p) => !have.has(p))
    setText([text.trim(), ...fresh].filter(Boolean).join('\n'))
    setTemplate(tpl)
  }

  const prompts = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length >= 3),
    [text]
  )

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, text)
    } catch {
      // abaikan
    }
  }, [text])

  async function loadModels() {
    setModelError('')
    try {
      const list = await window.api.genModels()
      setModels(list)
    } catch (err) {
      setModels([])
      setModelError(cleanError(err))
    }
  }

  // Model tersimpan tidak ada di daftar (atau belum dipilih): pakai yang pertama (termurah di urutan).
  useEffect(() => {
    if (settings && models?.length && !models.includes(settings.genModel)) {
      void window.api.saveSettings({ genModel: models[0] }).then(onSettings)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, settings?.genModel])

  async function refresh() {
    const r = await window.api.genList()
    setJobs(r.jobs)
    setBatches(r.batches)
  }

  useEffect(() => {
    void window.api.hasAiKey().then((k) => {
      setHasKey(k)
      if (k) void loadModels()
    })
    void window.api.genDefaultDir().then(setDefaultDir)
    void refresh()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.api.onGenChanged(() => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 150)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const byBatch = useMemo(() => {
    const m = new Map<string, GenJob[]>()
    for (const j of jobs) m.set(j.batchId, [...(m.get(j.batchId) ?? []), j])
    return m
  }, [jobs])
  const visibleBatches = useMemo(
    () => [...batches].sort((a, b) => b.createdAt - a.createdAt).filter((b) => byBatch.has(b.id)).slice(0, shownBatches),
    [batches, byBatch, shownBatches]
  )

  // Ambil gambar kecil yang belum ada untuk kelompok yang terlihat.
  useEffect(() => {
    const need = visibleBatches
      .flatMap((b) => byBatch.get(b.id) ?? [])
      .filter((j) => (j.status === 'ready' || j.status === 'saved') && !thumbs.has(j.id))
      .map((j) => j.id)
    if (!need.length) return
    void window.api.genThumbs(need).then((r) => {
      if (!Object.keys(r).length) return
      setThumbs((m) => {
        const n = new Map(m)
        for (const [k, v] of Object.entries(r)) n.set(k, v)
        return n
      })
    })
  }, [visibleBatches, byBatch, thumbs])

  async function start() {
    if (!settings) return
    setBusy(true)
    setError('')
    setNote('')
    try {
      const r = await window.api.genStart({
        prompts,
        variants,
        template,
        model: settings.genModel,
        aspect: settings.genAspect,
        refPath: ref?.path,
        autoZip: settings.genAutoZip
      })
      setNote(`${r.queued} gambar masuk antrean.${settings.genAutoZip ? ' Setelah semua selesai, hasilnya otomatis disimpan dan di-ZIP.' : ''}`)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  const act = (a: GenAction, ids: string[]) => {
    if (!ids.length) return
    void window.api.genAction(a, ids).catch((err) => setError(cleanError(err)))
  }

  async function zip(batchId: string) {
    setError('')
    try {
      const r = await window.api.genZip(batchId)
      setNote(`${r.count} gambar di-ZIP.`)
    } catch (err) {
      setError(cleanError(err))
    }
  }

  async function open(job: GenJob) {
    setBig({ job, url: null })
    setBig({ job, url: await window.api.genFull(job.id) })
  }

  const save = async (patch: Partial<Settings>) => onSettings(await window.api.saveSettings(patch))
  const total = prompts.length * variants
  const tpl = GEN_TEMPLATES.find((t) => t.key === template)

  return (
    <div className="page gen-page">
      <header className="page-head">
        <div>
          <h1>Buat Gambar</h1>
          <p className="muted">Prompt → gambar AI lewat Ciora → simpan JPG siap stok → metadata → upload.</p>
        </div>
        <div className="seg">
          <button className={tab === 'make' ? 'on' : ''} onClick={() => setTab('make')}>
            Buat
          </button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
            Riwayat
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

      {tab === 'history' ? (
        <History jobs={jobs} onOpen={(j) => void open(j)} />
      ) : (
        <>
          <section className="panel gen-form">
            <div className="panel-head">
              <strong>1. Prompt</strong>
              <span className="muted small">Satu prompt per baris · {prompts.length} prompt</span>
              <span className="spacer" />
              <button className="btn small" onClick={() => setShowIdeas(!showIdeas)}>
                {showIdeas ? 'Tutup contoh VFX' : '✦ Contoh prompt VFX'}
              </button>
              {text && (
                <button className="btn ghost small" onClick={() => setText('')}>
                  Kosongkan
                </button>
              )}
            </div>
            {showIdeas && (
              <div className="gen-ideas">
                <div className="muted small">
                  Klik kelompok untuk menambahkan promptnya. Template otomatis jadi "VFX latar hitam" — hasilnya nanti dikirim ke halaman Transparan.
                </div>
                <div className="chips">
                  {VFX_PROMPTS.map((g) => (
                    <button key={g.group} className="chip-btn" onClick={() => addPrompts(g.prompts, 'vfx-black')} title={g.prompts.join('\n')}>
                      + {g.group} ({g.prompts.length})
                    </button>
                  ))}
                  <button className="chip-btn" onClick={() => addPrompts(VFX_PROMPTS.flatMap((g) => g.prompts), 'vfx-black')}>
                    + Semua ({VFX_PROMPTS.reduce((n, g) => n + g.prompts.length, 0)})
                  </button>
                  <button className="chip-btn" onClick={() => addPrompts(DARK_FX_PROMPTS, 'vfx-white')} title={DARK_FX_PROMPTS.join('\n')}>
                    + Asap/tinta gelap ({DARK_FX_PROMPTS.length})
                  </button>
                </div>
              </div>
            )}
            <textarea
              className="gen-prompts"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Tempel satu atau banyak prompt, satu per baris.\nContoh:\nGolden autumn forest with soft morning fog\nMinimal flat lay of coffee beans on beige background'}
              spellCheck={false}
            />
            <div className="gen-row">
              <span className="small">Gaya:</span>
              <div className="chips">
                {GEN_TEMPLATES.map((t) => (
                  <button key={t.key} className={`chip-btn ${template === t.key ? 'on' : ''}`} onClick={() => setTemplate(t.key)} title={t.hint}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {tpl && <div className="muted small">{tpl.hint}</div>}
            <div className="gen-row">
              <label className="inline-field small">
                Variasi per prompt
                <select value={variants} onChange={(e) => setVariants(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <span className="spacer" />
              {ref ? (
                <span className="gen-ref">
                  <img src={ref.thumb} alt="" />
                  <span className="small">Referensi: {ref.path.split(/[\\/]/).pop()}</span>
                  <button className="icon-btn" title="Hapus referensi" onClick={() => setRef(null)}>
                    ×
                  </button>
                </span>
              ) : (
                <button className="btn small" onClick={async () => setRef(await window.api.genPickRef())} title="Gambar contoh untuk diubah atau ditiru gayanya">
                  + Gambar referensi
                </button>
              )}
            </div>
          </section>

          {settings && (
            <section className="panel">
              <div className="panel-head">
                <strong>2. Pengaturan</strong>
              </div>
              <div className="gen-settings">
                <label className="mfield">
                  <span>Model</span>
                  <div className="field-row">
                    <select className="grow" value={settings.genModel} onChange={(e) => void save({ genModel: e.target.value })} disabled={!models?.length}>
                      {!models && <option value={settings.genModel}>Memuat daftar model…</option>}
                      {models?.length === 0 && <option value="">Tidak ada model gambar</option>}
                      {models?.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <button className="btn small" onClick={() => void loadModels()} title="Ambil ulang daftar model dari Ciora">
                      ↻
                    </button>
                  </div>
                </label>
                <div className="mfield">
                  <span>Rasio</span>
                  <div className="seg">
                    {ASPECTS.map((a) => (
                      <button key={a} className={settings.genAspect === a ? 'on' : ''} onClick={() => void save({ genAspect: a })}>
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mfield">
                  <span>Folder simpan</span>
                  <div className="field-row">
                    <span className="gen-path small" title={settings.genDir || defaultDir}>
                      {settings.genDir || defaultDir}
                    </span>
                    <button
                      className="btn small"
                      onClick={async () => {
                        const d = await window.api.genPickDir()
                        if (d) onSettings(await window.api.getSettings())
                      }}
                    >
                      Ganti
                    </button>
                  </div>
                </div>
              </div>
              {modelError && <div className="small danger-text">{modelError}</div>}
              {models?.length === 0 && !modelError && (
                <div className="small danger-text">Akun Ciora ini tidak menyediakan model pembuat gambar.</div>
              )}
              <label className="check" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={settings.genAutoZip} onChange={(e) => void save({ genAutoZip: e.target.checked })} />
                Setelah semua selesai: simpan semua hasil sebagai JPG lalu buat ZIP otomatis
              </label>
              <div className="muted small" style={{ marginTop: 4 }}>
                Gambar di bawah 4 MP diperbesar otomatis ke ±6 MP (syarat minimal Adobe), JPG kualitas 95, dan ditandai "AI generatif".
              </div>
            </section>
          )}

          <div className="gen-go">
            <button className="btn primary big" disabled={busy || !total || !hasKey || !settings?.genModel} onClick={() => void start()}>
              {busy ? 'Menambahkan…' : `Buat ${total || ''} gambar`}
            </button>
          </div>

          {visibleBatches.map((b) => (
            <BatchView
              key={b.id}
              batch={b}
              jobs={byBatch.get(b.id) ?? []}
              thumbs={thumbs}
              act={act}
              zip={zip}
              open={open}
              onToMetadata={onToMetadata}
              onToAlpha={onToAlpha}
            />
          ))}
          {batches.length > shownBatches && (
            <button className="btn ghost" onClick={() => setShownBatches((n) => n + 5)}>
              Tampilkan kelompok sebelumnya
            </button>
          )}
        </>
      )}

      {big && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setBig(null)}>
          <div className="modal gen-big">
            <header className="modal-head">
              <h2 className="small">{big.job.prompt}</h2>
              <button className="btn ghost" onClick={() => setBig(null)}>
                ✕
              </button>
            </header>
            {big.url ? <img src={big.url} alt="" /> : <div className="muted">{big.job.status === 'discarded' ? 'Gambar sudah dibuang.' : 'Memuat…'}</div>}
            <div className="muted small">
              {big.job.model} · {big.job.aspect}
              {big.job.width ? ` · ${big.job.width}×${big.job.height}` : ''}
              {big.job.savedPath ? ` · ${big.job.savedPath}` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BatchView({
  batch,
  jobs,
  thumbs,
  act,
  zip,
  open,
  onToMetadata,
  onToAlpha
}: {
  batch: GenBatch
  jobs: GenJob[]
  thumbs: Map<string, string>
  act: (a: GenAction, ids: string[]) => void
  zip: (id: string) => Promise<void>
  open: (j: GenJob) => Promise<void>
  onToMetadata: (paths: string[]) => void
  onToAlpha: (paths: string[]) => void
}) {
  const isFx = jobs.some((j) => j.template.startsWith('vfx'))
  const n = (s: GenJob['status'][]) => jobs.filter((j) => s.includes(j.status))
  const pending = n(['queued', 'running'])
  const ready = n(['ready'])
  const saved = n(['saved'])
  const failed = n(['failed', 'rejected', 'canceled'])
  const done = jobs.length - pending.length
  const pct = jobs.length ? Math.floor((done / jobs.length) * 100) : 0
  const when = new Date(batch.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <section className="panel gen-batch">
      <div className="panel-head">
        <strong>{batch.folder}</strong>
        <span className="muted small">
          {when} · {jobs.length} gambar · {saved.length} tersimpan
          {ready.length > 0 && ` · ${ready.length} menunggu dipilih`}
          {failed.length > 0 && ` · ${failed.length} gagal`}
        </span>
        <span className="spacer" />
        {pending.length > 0 && (
          <button className="btn small ghost" onClick={() => act('cancel', pending.map((j) => j.id))}>
            Hentikan
          </button>
        )}
        {failed.length > 0 && (
          <button className="btn small" onClick={() => act('retry', failed.map((j) => j.id))}>
            Coba lagi yang gagal
          </button>
        )}
        {ready.length > 0 && (
          <button className="btn small" onClick={() => act('keep', ready.map((j) => j.id))}>
            Simpan semua ({ready.length})
          </button>
        )}
        {saved.length > 0 && (
          <>
            <button className="btn small" onClick={() => void zip(batch.id)} title={batch.zipPath ?? 'Buat ZIP dari semua gambar tersimpan'}>
              {batch.zipPath ? 'ZIP ulang' : 'Simpan jadi ZIP'}
            </button>
            <button
              className={`btn small ${isFx ? 'primary' : ''}`}
              onClick={() => onToAlpha(saved.map((j) => j.savedPath!).filter(Boolean))}
              title="Kirim ke halaman Transparan: PNG transparan + JPG preview + PSD"
            >
              Jadikan transparan ({saved.length})
            </button>
            <button className={`btn small ${isFx ? '' : 'primary'}`} onClick={() => onToMetadata(saved.map((j) => j.savedPath!).filter(Boolean))}>
              Buat metadata ({saved.length})
            </button>
          </>
        )}
      </div>
      {pending.length > 0 && (
        <div className="overall-top" style={{ marginBottom: 10 }}>
          <div className="bar grow">
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="muted small">
            {done} dari {jobs.length} selesai
          </span>
        </div>
      )}
      {batch.zipPath && (
        <div className="muted small" style={{ marginBottom: 8 }}>
          ZIP: {batch.zipPath}
        </div>
      )}
      <div className="gen-grid">
        {jobs.map((j) => (
          <article key={j.id} className={`gen-card g-${j.status}`}>
            <button className="gen-img" style={{ aspectRatio: j.aspect.replace(':', ' / ') }} onClick={() => void open(j)} disabled={!thumbs.get(j.id)}>
              {thumbs.get(j.id) ? (
                <img src={thumbs.get(j.id)} alt="" />
              ) : (
                <span className={`gen-state ${j.status === 'running' ? 'spin' : ''}`}>{STATUS[j.status]}</span>
              )}
              {j.status === 'saved' && <span className="gen-badge">✓ Tersimpan</span>}
            </button>
            <div className="gen-prompt small" title={j.prompt}>
              {j.prompt}
            </div>
            {j.error && j.status !== 'saved' && <div className="small danger-text">{j.error}</div>}
            <div className="gen-actions">
              {j.status === 'ready' && (
                <>
                  <button className="btn small primary" onClick={() => act('keep', [j.id])}>
                    ✓ Simpan
                  </button>
                  <button className="btn small" onClick={() => act('discard', [j.id])}>
                    ✕ Buang
                  </button>
                </>
              )}
              {(j.status === 'failed' || j.status === 'rejected' || j.status === 'canceled') && (
                <button className="btn small" onClick={() => act('retry', [j.id])}>
                  Coba lagi
                </button>
              )}
              {j.status === 'queued' && (
                <button className="btn small ghost" onClick={() => act('cancel', [j.id])}>
                  Batal
                </button>
              )}
              <span className="spacer" />
              <button className="icon-btn" title="Buat lagi dengan prompt yang sama" onClick={() => act('again', [j.id])}>
                ↻
              </button>
              <button className="icon-btn" title="Salin prompt" onClick={() => void navigator.clipboard.writeText(j.prompt)}>
                ⧉
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function History({ jobs, onOpen }: { jobs: GenJob[]; onOpen: (j: GenJob) => void }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return [...jobs].sort((a, b) => b.createdAt - a.createdAt).filter((j) => !s || j.prompt.toLowerCase().includes(s))
  }, [jobs, q])
  const savedCount = jobs.filter((j) => j.status === 'saved').length
  return (
    <section className="panel">
      <div className="panel-head">
        <strong>Riwayat</strong>
        <span className="muted small">
          {jobs.length} gambar diminta · {savedCount} tersimpan
        </span>
        <span className="spacer" />
        <input className="text-input" placeholder="Cari prompt…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Prompt</th>
              <th>Model</th>
              <th>Status</th>
              <th>File</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 500).map((j) => (
              <tr key={j.id}>
                <td className="nowrap small">{new Date(j.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td className="cell-file small" title={j.prompt}>
                  {j.prompt}
                </td>
                <td className="small nowrap">{j.model}</td>
                <td>
                  <span className={`pill pill-${j.status === 'saved' ? 'done' : j.status === 'failed' || j.status === 'rejected' ? 'failed' : j.status === 'running' ? 'uploading' : ''}`}>
                    {STATUS[j.status]}
                  </span>
                </td>
                <td className="small">
                  {j.savedPath ? (
                    <button className="link" onClick={() => void window.api.showInFolder(j.savedPath!)}>
                      {j.savedPath.split(/[\\/]/).pop()}
                    </button>
                  ) : j.status === 'ready' ? (
                    <button className="link" onClick={() => onOpen(j)}>
                      Lihat
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
