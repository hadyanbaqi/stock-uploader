import { useEffect, useMemo, useState } from 'react'
import type { GenAction, GenBatch, GenJob, Settings } from '../../../shared/types'
import { DARK_FX_PROMPTS, GEN_TEMPLATES, VFX_PROMPTS } from '../../../shared/genTemplates'
import UpscalePanel from '../components/UpscalePanel'

type Props = {
  settings: Settings | null
  onSettings: (s: Settings) => void
  onToMetadata: (paths: string[]) => void
  onToAlpha: (paths: string[]) => void
  onGoSettings: () => void
}

const ASPECTS = ['16:9', '3:2', '4:3', '1:1', '2:3', '9:16']
const DRAFT_KEY = 'su.genDraft'
const TPL_KEY = 'su.genTemplate'
const PENDING: GenJob['status'][] = ['queued', 'running']

function cleanError(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
function read(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function write(key: string, v: string): void {
  try {
    localStorage.setItem(key, v)
  } catch {
    // abaikan
  }
}

export default function GeneratePage({ settings, onSettings, onToMetadata, onToAlpha, onGoSettings }: Props) {
  const [text, setText] = useState(() => read(DRAFT_KEY, ''))
  const [template, setTemplate] = useState(() => read(TPL_KEY, 'none'))
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
  const [showIdeas, setShowIdeas] = useState(false)
  const [more, setMore] = useState(false)
  const [tab, setTab] = useState<'gallery' | 'history'>('gallery')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [, tick] = useState(0)

  const prompts = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length >= 3),
    [text]
  )

  useEffect(() => write(DRAFT_KEY, text), [text])
  useEffect(() => write(TPL_KEY, template), [template])

  async function loadModels() {
    setModelError('')
    try {
      setModels(await window.api.genModels())
    } catch (err) {
      setModels([])
      setModelError(cleanError(err))
    }
  }

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

  // Model tersimpan tidak ada di daftar (atau belum dipilih): pakai yang pertama (termurah di urutan).
  useEffect(() => {
    if (settings && models?.length && !models.includes(settings.genModel)) {
      void window.api.saveSettings({ genModel: models[0] }).then(onSettings)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, settings?.genModel])

  // Galeri: kelompok yang tidak disembunyikan, terbaru di atas; di dalamnya urut sesuai urutan prompt.
  const shownBatches = useMemo(() => batches.filter((b) => !b.hidden).sort((a, b) => b.createdAt - a.createdAt), [batches])
  const byBatch = useMemo(() => {
    const m = new Map<string, GenJob[]>()
    for (const j of jobs) m.set(j.batchId, [...(m.get(j.batchId) ?? []), j])
    return m
  }, [jobs])
  const visible = useMemo(() => shownBatches.flatMap((b) => byBatch.get(b.id) ?? []), [shownBatches, byBatch])
  const pending = visible.filter((j) => PENDING.includes(j.status))
  const ready = visible.filter((j) => j.status === 'ready')
  const saved = visible.filter((j) => j.status === 'saved')
  const failed = visible.filter((j) => j.status === 'failed' || j.status === 'rejected')
  const done = visible.filter((j) => !PENDING.includes(j.status)).length

  // Detik berjalan untuk gambar yang sedang dibuat.
  useEffect(() => {
    if (!pending.length) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [pending.length])

  // Ambil gambar kecil yang belum ada.
  useEffect(() => {
    const need = visible.filter((j) => (j.status === 'ready' || j.status === 'saved') && !thumbs.has(j.id)).map((j) => j.id)
    if (!need.length) return
    void window.api.genThumbs(need).then((r) => {
      if (!Object.keys(r).length) return
      setThumbs((m) => {
        const n = new Map(m)
        for (const [k, v] of Object.entries(r)) n.set(k, v)
        return n
      })
    })
  }, [visible, thumbs])

  // Pilihan yang sudah tidak terlihat dibuang.
  useEffect(() => {
    const ids = new Set(visible.map((j) => j.id))
    setPicked((p) => {
      const n = new Set([...p].filter((id) => ids.has(id)))
      return n.size === p.size ? p : n
    })
  }, [visible])

  function addPrompts(list: string[], tpl: string) {
    const have = new Set(text.split(/\r?\n/).map((l) => l.trim()))
    setText([text.trim(), ...list.filter((p) => !have.has(p))].filter(Boolean).join('\n'))
    setTemplate(tpl)
  }

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
        autoZip: settings.genAutoZip,
        clearPrevious: settings.genClearOnStart
      })
      setPicked(new Set())
      setTab('gallery')
      setNote(`${r.queued} gambar sedang dibuat, berurutan dari prompt pertama.`)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  async function act(a: GenAction, ids: string[]) {
    if (!ids.length) return
    try {
      await window.api.genAction(a, ids)
    } catch (err) {
      setError(cleanError(err))
    }
  }

  /** Simpan dulu yang belum tersimpan, lalu kirim path-nya ke halaman lain. */
  async function sendTo(ids: string[], to: (paths: string[]) => void) {
    const sel = visible.filter((j) => ids.includes(j.id))
    const toKeep = sel.filter((j) => j.status === 'ready').map((j) => j.id)
    if (toKeep.length) await act('keep', toKeep)
    const r = await window.api.genList()
    const paths = r.jobs.filter((j) => ids.includes(j.id) && j.savedPath).map((j) => j.savedPath!)
    if (paths.length) to(paths)
    else setError('Belum ada gambar yang selesai di pilihan ini.')
  }

  async function clearGallery() {
    const unsaved = ready.length + pending.length
    if (unsaved && !window.confirm(`Kosongkan galeri?\n${ready.length} gambar belum disimpan akan dibuang${pending.length ? ` dan ${pending.length} yang masih antre dihentikan` : ''}.\nGambar yang sudah tersimpan tetap ada di folder dan Riwayat.`)) return
    await window.api.genClear(true)
    setThumbs(new Map())
    setPicked(new Set())
    setNote('')
  }

  async function open(job: GenJob) {
    setBig({ job, url: null })
    setBig({ job, url: await window.api.genFull(job.id) })
  }

  function togglePick(id: string) {
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const save = async (patch: Partial<Settings>) => onSettings(await window.api.saveSettings(patch))
  const total = prompts.length * variants
  const tpl = GEN_TEMPLATES.find((t) => t.key === template)
  const pickedIds = [...picked]
  const pickedJobs = visible.filter((j) => picked.has(j.id))
  const pct = visible.length ? Math.floor((done / visible.length) * 100) : 0

  return (
    <div className="page page-wide gen2">
      {/* ---------- Kiri: panel buat gambar ---------- */}
      <aside className="gen2-left panel">
        <div className="gen2-title">
          <h1>Buat Gambar</h1>
          <span className="muted small">lewat Ciora</span>
        </div>

        {hasKey === false && (
          <div className="banner danger small">
            API key Ciora belum diisi.{' '}
            <button className="link" onClick={onGoSettings}>
              Isi di Pengaturan
            </button>
          </div>
        )}

        <div className="gen2-block">
          <div className="gen2-label">
            <span>Prompt</span>
            <span className="muted small">{prompts.length} prompt · satu per baris</span>
          </div>
          <textarea
            className="gen-prompts"
            rows={9}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Tempel satu atau banyak prompt, satu per baris.'}
            spellCheck={false}
          />
          <div className="gen2-row">
            <button className="btn small" onClick={() => setShowIdeas(!showIdeas)}>
              {showIdeas ? 'Tutup contoh' : '✦ Contoh prompt VFX'}
            </button>
            <span className="spacer" />
            {text && (
              <button className="btn ghost small" onClick={() => setText('')}>
                Hapus prompt
              </button>
            )}
          </div>
          {showIdeas && (
            <div className="chips gen2-ideas">
              {VFX_PROMPTS.map((g) => (
                <button key={g.group} className="chip-btn" onClick={() => addPrompts(g.prompts, 'vfx-black')} title={g.prompts.join('\n')}>
                  + {g.group}
                </button>
              ))}
              <button className="chip-btn" onClick={() => addPrompts(VFX_PROMPTS.flatMap((g) => g.prompts), 'vfx-black')}>
                + Semua VFX
              </button>
              <button className="chip-btn" onClick={() => addPrompts(DARK_FX_PROMPTS, 'vfx-white')} title={DARK_FX_PROMPTS.join('\n')}>
                + Asap/tinta gelap
              </button>
            </div>
          )}
        </div>

        <div className="gen2-block">
          <label className="gen2-label" htmlFor="gen-tpl">
            <span>Gaya</span>
          </label>
          <select id="gen-tpl" value={template} onChange={(e) => setTemplate(e.target.value)}>
            {GEN_TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          {tpl?.hint && <div className="muted small">{tpl.hint}</div>}
        </div>

        {settings && (
          <div className="gen2-block">
            <span className="gen2-label">
              <span>Rasio</span>
            </span>
            <div className="seg gen2-aspect">
              {ASPECTS.map((a) => (
                <button key={a} className={settings.genAspect === a ? 'on' : ''} onClick={() => void save({ genAspect: a })}>
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="gen2-block gen2-two">
          <label className="mfield">
            <span>Variasi</span>
            <select value={variants} onChange={(e) => setVariants(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} per prompt
                </option>
              ))}
            </select>
          </label>
          <div className="mfield">
            <span>Referensi</span>
            {ref ? (
              <span className="gen-ref">
                <img src={ref.thumb} alt="" />
                <button className="icon-btn" title="Hapus referensi" onClick={() => setRef(null)}>
                  ×
                </button>
              </span>
            ) : (
              <button className="btn small" onClick={async () => setRef(await window.api.genPickRef())}>
                + Gambar
              </button>
            )}
          </div>
        </div>

        {settings && (
          <>
            <button className="gen2-more link" onClick={() => setMore(!more)}>
              {more ? '▾' : '▸'} Model, folder & opsi
            </button>
            {more && (
              <div className="gen2-block">
                <label className="mfield">
                  <span>Model</span>
                  <div className="field-row">
                    <select className="grow" value={settings.genModel} onChange={(e) => void save({ genModel: e.target.value })} disabled={!models?.length}>
                      {!models && <option value={settings.genModel}>Memuat…</option>}
                      {models?.length === 0 && <option value="">Tidak ada model gambar</option>}
                      {models?.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <button className="btn small" onClick={() => void loadModels()} title="Ambil ulang daftar model">
                      ↻
                    </button>
                  </div>
                </label>
                <div className="mfield">
                  <span>Folder simpan</span>
                  <div className="field-row">
                    <span className="gen-path small" title={settings.genDir || defaultDir}>
                      {settings.genDir || defaultDir}
                    </span>
                    <button
                      className="btn small"
                      onClick={async () => {
                        if (await window.api.genPickDir()) onSettings(await window.api.getSettings())
                      }}
                    >
                      Ganti
                    </button>
                  </div>
                </div>
                <label className="check small">
                  <input type="checkbox" checked={settings.genAutoZip} onChange={(e) => void save({ genAutoZip: e.target.checked })} />
                  Simpan semua + ZIP otomatis setelah selesai
                </label>
                <label className="check small">
                  <input type="checkbox" checked={settings.genClearOnStart} onChange={(e) => void save({ genClearOnStart: e.target.checked })} />
                  Kosongkan galeri tiap mulai baru (tidak menumpuk)
                </label>
              </div>
            )}
            {!more && <div className="muted small gen2-model">{settings.genModel || 'Model belum dipilih'}</div>}
          </>
        )}
        {settings && <UpscalePanel settings={settings} save={save} />}
        {modelError && <div className="small danger-text">{modelError}</div>}
        {models?.length === 0 && !modelError && <div className="small danger-text">Akun Ciora ini tidak menyediakan model pembuat gambar.</div>}

        <div className="gen2-go">
          <button className="btn primary big" disabled={busy || !total || !hasKey || !settings?.genModel} onClick={() => void start()}>
            {busy ? 'Menambahkan…' : total ? `Buat ${total} gambar` : 'Tulis prompt dulu'}
          </button>
        </div>
      </aside>

      {/* ---------- Kanan: hasil ---------- */}
      <section className="gen2-right">
        <div className="gen2-head">
          <div className="seg">
            <button className={tab === 'gallery' ? 'on' : ''} onClick={() => setTab('gallery')}>
              Galeri {visible.length ? visible.length : ''}
            </button>
            <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
              Riwayat
            </button>
          </div>
          {tab === 'gallery' && visible.length > 0 && (
            <span className="muted small">
              {saved.length} tersimpan · {ready.length} belum disimpan{failed.length > 0 && ` · ${failed.length} gagal`}
            </span>
          )}
          <span className="spacer" />
          {tab === 'gallery' && visible.length > 0 && (
            <button className="btn small ghost danger-text" onClick={() => void clearGallery()}>
              Kosongkan
            </button>
          )}
        </div>

        {error && <div className="banner danger">{error}</div>}
        {note && <div className="banner info">{note}</div>}

        {tab === 'history' ? (
          <History jobs={jobs} onOpen={(j) => void open(j)} />
        ) : !visible.length ? (
          <div className="gen2-empty">
            <div className="gen2-empty-art">✦</div>
            <h2>Belum ada gambar</h2>
            <p className="muted">Tulis prompt di kiri (atau pakai contoh prompt VFX), lalu klik Buat. Gambar muncul di sini satu per satu sesuai urutan.</p>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <div className="panel overall gen2-progress">
                <div className="overall-top">
                  <strong>{pct}%</strong>
                  <span className="muted small">
                    {done} dari {visible.length} gambar selesai · {pending.filter((j) => j.status === 'running').length} sedang dibuat
                  </span>
                  <span className="spacer" />
                  <button className="btn small" onClick={() => void act('cancel', pending.map((j) => j.id))}>
                    Hentikan
                  </button>
                </div>
                <div className="bar">
                  <div style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}

            <div className="gen2-bulk">
              <label className="check small">
                <input
                  type="checkbox"
                  checked={picked.size > 0 && picked.size === visible.length}
                  ref={(el) => {
                    if (el) el.indeterminate = picked.size > 0 && picked.size < visible.length
                  }}
                  onChange={(e) => setPicked(e.target.checked ? new Set(visible.map((j) => j.id)) : new Set())}
                />
                {picked.size ? `${picked.size} dipilih` : 'Pilih semua'}
              </label>
              <span className="spacer" />
              {picked.size > 0 ? (
                <>
                  <button className="btn small" onClick={() => void act('keep', pickedIds)} disabled={!pickedJobs.some((j) => j.status === 'ready')}>
                    ✓ Simpan
                  </button>
                  <button className="btn small" onClick={() => void act('discard', pickedIds)} disabled={!pickedJobs.some((j) => j.status === 'ready')}>
                    ✕ Buang
                  </button>
                  <button className="btn small" onClick={() => void act('again', pickedIds)}>
                    ↻ Buat lagi
                  </button>
                  <button className="btn small" onClick={() => void sendTo(pickedIds, onToAlpha)}>
                    ◐ Transparan
                  </button>
                  <button className="btn small primary" onClick={() => void sendTo(pickedIds, onToMetadata)}>
                    ✎ Metadata
                  </button>
                </>
              ) : (
                <>
                  {failed.length > 0 && (
                    <button className="btn small" onClick={() => void act('retry', failed.map((j) => j.id))}>
                      Coba lagi yang gagal
                    </button>
                  )}
                  {ready.length > 0 && (
                    <button className="btn small" onClick={() => void act('keep', ready.map((j) => j.id))}>
                      ✓ Simpan semua ({ready.length})
                    </button>
                  )}
                  {saved.length > 0 &&
                    shownBatches.map((b) =>
                      (byBatch.get(b.id) ?? []).some((j) => j.status === 'saved') ? (
                        <button
                          key={b.id}
                          className="btn small"
                          title={b.zipPath ?? 'ZIP dari semua gambar tersimpan di kelompok ini'}
                          onClick={async () => {
                            try {
                              const r = await window.api.genZip(b.id)
                              setNote(`${r.count} gambar di-ZIP: ${r.zipPath}`)
                            } catch (err) {
                              setError(cleanError(err))
                            }
                          }}
                        >
                          ZIP{shownBatches.length > 1 ? ` ${b.folder.slice(-4)}` : ''}
                        </button>
                      ) : null
                    )}
                </>
              )}
            </div>

            {shownBatches.map((b) => {
              const list = byBatch.get(b.id) ?? []
              if (!list.length) return null
              return (
                <div key={b.id} className="gen2-batch">
                  {shownBatches.length > 1 && (
                    <div className="muted small gen2-batch-head">
                      {b.folder} · {new Date(b.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · {list.length} gambar
                      {b.zipPath && ' · ZIP ✓'}
                    </div>
                  )}
                  <div className="gen2-grid">
                    {list.map((j, i) => (
                      <Card
                        key={j.id}
                        job={j}
                        n={i + 1}
                        thumb={thumbs.get(j.id)}
                        picked={picked.has(j.id)}
                        onPick={() => togglePick(j.id)}
                        onOpen={() => void open(j)}
                        act={(a) => void act(a, [j.id])}
                        onAlpha={() => void sendTo([j.id], onToAlpha)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </section>

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
            <div className="field-row">
              <span className="muted small grow">
                {big.job.model} · {big.job.aspect}
                {big.job.width ? ` · ${big.job.width}×${big.job.height}` : ''}
                {big.job.savedPath ? ` · ${big.job.savedPath}` : ''}
              </span>
              {big.job.status === 'ready' && (
                <>
                  <button className="btn small primary" onClick={() => void act('keep', [big.job.id]).then(() => setBig(null))}>
                    ✓ Simpan
                  </button>
                  <button className="btn small" onClick={() => void act('discard', [big.job.id]).then(() => setBig(null))}>
                    ✕ Buang
                  </button>
                </>
              )}
              {big.job.savedPath && (
                <button className="btn small" onClick={() => void window.api.showInFolder(big.job.savedPath!)}>
                  Buka folder
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Card({
  job: j,
  n,
  thumb,
  picked,
  onPick,
  onOpen,
  act,
  onAlpha
}: {
  job: GenJob
  n: number
  thumb?: string
  picked: boolean
  onPick: () => void
  onOpen: () => void
  act: (a: GenAction) => void
  onAlpha: () => void
}) {
  const secs = j.status === 'running' && j.startedAt ? Math.max(0, Math.round((Date.now() - j.startedAt) / 1000)) : 0
  const hasImg = (j.status === 'ready' || j.status === 'saved') && thumb
  return (
    <article className={`gc g-${j.status} ${picked ? 'picked' : ''}`}>
      <div className="gc-img" style={{ aspectRatio: j.aspect.replace(':', ' / ') }}>
        {hasImg ? (
          <img src={thumb} alt="" onClick={onOpen} />
        ) : j.status === 'running' ? (
          <div className="gc-load">
            <span className="gc-spin" />
            <span>Membuat… {secs}s</span>
          </div>
        ) : j.status === 'queued' ? (
          <div className="gc-load wait">
            <span>Antre</span>
          </div>
        ) : (j.status === 'ready' || j.status === 'saved') && !thumb ? (
          <div className="gc-load">
            <span className="gc-spin" />
          </div>
        ) : (
          <div className={`gc-load ${j.status === 'failed' || j.status === 'rejected' ? 'bad' : 'wait'}`}>
            <span>{j.status === 'failed' ? 'Gagal' : j.status === 'rejected' ? 'Ditolak' : j.status === 'discarded' ? 'Dibuang' : 'Dibatalkan'}</span>
            {j.error && <span className="gc-err">{j.error}</span>}
          </div>
        )}
        <label className="gc-check" title="Pilih">
          <input type="checkbox" checked={picked} onChange={onPick} />
        </label>
        <span className="gc-num">#{n}</span>
        {j.upscale !== undefined && (
          <div className="gc-up">
            <span className="gc-spin" />
            <span>Upscale AI {Math.round(j.upscale * 100)}%</span>
          </div>
        )}
        {j.status === 'saved' && <span className="gen-badge gc-saved">✓</span>}
        {j.status === 'saved' && j.upscaled && (
          <span className="gen-badge gc-up-badge" title="Sudah di-upscale AI">
            {j.upscaled}
          </span>
        )}
        <div className="gc-actions">
          {j.status === 'ready' && (
            <>
              <button title="Simpan" onClick={() => act('keep')}>
                ✓
              </button>
              <button title="Buang" onClick={() => act('discard')}>
                ✕
              </button>
            </>
          )}
          {(j.status === 'ready' || j.status === 'saved') && (
            <>
              <button title="Jadikan transparan" onClick={onAlpha}>
                ◐
              </button>
              <button title="Lihat besar" onClick={onOpen}>
                ⤢
              </button>
            </>
          )}
          {(j.status === 'failed' || j.status === 'rejected' || j.status === 'canceled') && (
            <button title="Coba lagi" onClick={() => act('retry')}>
              ↻
            </button>
          )}
          {j.status === 'queued' && (
            <button title="Batal" onClick={() => act('cancel')}>
              ✕
            </button>
          )}
          {!['queued', 'running'].includes(j.status) && (
            <button title="Buat lagi dengan prompt yang sama" onClick={() => act('again')}>
              ↻+
            </button>
          )}
        </div>
      </div>
      <div className="gc-cap" title={j.prompt}>
        {j.prompt}
      </div>
    </article>
  )
}

function History({ jobs, onOpen }: { jobs: GenJob[]; onOpen: (j: GenJob) => void }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return [...jobs].sort((a, b) => b.createdAt - a.createdAt).filter((j) => !s || j.prompt.toLowerCase().includes(s))
  }, [jobs, q])
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
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="muted small">
          {jobs.length} gambar diminta · {jobs.filter((j) => j.status === 'saved').length} tersimpan
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
