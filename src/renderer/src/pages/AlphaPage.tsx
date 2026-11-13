import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { AlphaInfo, AlphaOptions, AlphaProgress, AlphaResult } from '../../../shared/types'

type Props = {
  /** File yang dikirim dari Buat Gambar. */
  incoming: string[]
  onConsumed: () => void
  onToMetadata: (paths: string[]) => void
}

const OPTS_KEY = 'su.alphaOpts'
const DEFAULTS: AlphaOptions = {
  bg: 'auto',
  color: '#00b140',
  floor: 0.04,
  glow: 1,
  minMp: true,
  jpg: true,
  jpgStyle: 'split',
  jpgColor: '#1e2a78',
  jpgText: '',
  psd: false,
  naming: 'original',
  prefix: 'vfx',
  outDir: '',
  zip: true
}
const BG_LABEL = { black: 'Hitam', white: 'Putih', color: 'Warna' }
type View = 'checker' | 'black' | 'white' | 'color'

function loadOpts(): AlphaOptions {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') as Partial<AlphaOptions>) }
  } catch {
    return DEFAULTS
  }
}

function cleanError(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export default function AlphaPage({ incoming, onConsumed, onToMetadata }: Props) {
  const [items, setItems] = useState<AlphaInfo[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [o, setO] = useState<AlphaOptions>(loadOpts)
  const [pv, setPv] = useState<{ before: string; after: string; bg: string; color: string } | null>(null)
  const [pvBusy, setPvBusy] = useState(false)
  const [split, setSplit] = useState(50)
  const [view, setView] = useState<View>('checker')
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<AlphaProgress | null>(null)
  const [result, setResult] = useState<AlphaResult | null>(null)
  const [error, setError] = useState('')
  const pvTimer = useRef<ReturnType<typeof setTimeout>>()

  const set = <K extends keyof AlphaOptions>(k: K, v: AlphaOptions[K]) => setO((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify({ ...o, outDir: '' }))
    } catch {
      // abaikan
    }
  }, [o])

  useEffect(() => window.api.onAlphaProgress(setProgress), [])

  async function add(paths: string[]) {
    if (!paths.length) return
    setLoading(true)
    setError('')
    try {
      const known = new Set(items.map((i) => i.path))
      const info = await window.api.alphaInspect(paths.filter((p) => !known.has(p)))
      setItems((prev) => {
        const next = [...prev, ...info.filter((i) => !prev.some((x) => x.path === i.path))]
        if (!sel && next[0]) setSel(next[0].path)
        return next
      })
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  // File dari Buat Gambar.
  useEffect(() => {
    if (!incoming.length) return
    void add(incoming).then(onConsumed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming])

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
    if (paths.length) await add(await window.api.alphaExpand(paths))
  }

  // Pratinjau diperbarui sebentar setelah pengaturan berubah.
  useEffect(() => {
    if (!sel) return setPv(null)
    clearTimeout(pvTimer.current)
    pvTimer.current = setTimeout(async () => {
      setPvBusy(true)
      try {
        setPv(await window.api.alphaPreview(sel, o))
      } catch (err) {
        setError(cleanError(err))
      } finally {
        setPvBusy(false)
      }
    }, 250)
    return () => clearTimeout(pvTimer.current)
  }, [sel, o.bg, o.color, o.floor, o.glow]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    setError('')
    setResult(null)
    setProgress({ done: 0, total: items.length, current: '', errors: 0 })
    try {
      setResult(await window.api.alphaRun(items.map((i) => i.path), o))
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setProgress(null)
    }
  }

  const current = items.find((i) => i.path === sel)
  const counts = useMemo(() => {
    const c = { black: 0, white: 0, color: 0 }
    for (const i of items) c[i.bg]++
    return c
  }, [items])
  const viewBg = view === 'black' ? '#000' : view === 'white' ? '#fff' : view === 'color' ? o.jpgColor : undefined

  return (
    <div className="page alpha-page">
      <header className="page-head">
        <div>
          <h1>Transparan</h1>
          <p className="muted">Efek/VFX di latar hitam, putih, atau hijau → PNG transparan + JPG preview + PSD. Glow dan asap tetap halus, tanpa internet.</p>
        </div>
      </header>

      {error && <div className="banner danger">{error}</div>}

      <section
        className={`dropzone ${dragging ? 'over' : ''} ${items.length ? 'compact' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => void onDrop(e)}
      >
        <div className="drop-title">Seret gambar atau folder render ke sini</div>
        <div className="muted small">JPG, PNG · atau kirim dari Buat Gambar ("Jadikan transparan")</div>
        <div className="drop-actions">
          <button className="btn" onClick={async () => add(await window.api.alphaPickFiles())}>
            Pilih gambar
          </button>
          <button className="btn" onClick={async () => add(await window.api.alphaPickFolder())}>
            Pilih folder
          </button>
        </div>
        {loading && <div className="small drop-note">Membaca gambar…</div>}
      </section>

      {items.length > 0 && (
        <>
          <section className="panel">
            <div className="panel-head">
              <strong>{items.length} gambar</strong>
              <span className="muted small">
                latar terdeteksi: {counts.black} hitam · {counts.white} putih · {counts.color} warna
              </span>
              <span className="spacer" />
              <button
                className="btn ghost small"
                onClick={() => {
                  setItems([])
                  setSel(null)
                  setResult(null)
                }}
              >
                Kosongkan
              </button>
            </div>
            <div className="alpha-strip">
              {items.map((i) => (
                <div key={i.path} className={`alpha-item ${sel === i.path ? 'on' : ''}`}>
                  <button className="alpha-thumb" onClick={() => setSel(i.path)} title={`${i.name} · ${i.width}×${i.height}`}>
                    <img src={i.thumb} alt="" />
                    <span className="alpha-bg" style={{ background: i.color }} title={`Latar ${BG_LABEL[i.bg]}`} />
                  </button>
                  <button
                    className="icon-btn alpha-x"
                    title="Hapus dari daftar"
                    onClick={() => {
                      setItems((p) => p.filter((x) => x.path !== i.path))
                      if (sel === i.path) setSel(null)
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>

          <div className="alpha-grid">
            <section className="panel">
              <div className="panel-head">
                <strong>Pratinjau</strong>
                <span className="muted small grow-ellipsis">
                  {current?.name}
                  {pv && ` · latar ${BG_LABEL[pv.bg as keyof typeof BG_LABEL] ?? pv.bg}`}
                  {pvBusy && ' · menghitung…'}
                </span>
                <span className="spacer" />
                <div className="seg small-seg">
                  {(['checker', 'black', 'white', 'color'] as View[]).map((v) => (
                    <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                      {v === 'checker' ? 'Petak' : v === 'black' ? 'Hitam' : v === 'white' ? 'Putih' : 'Warna'}
                    </button>
                  ))}
                </div>
              </div>
              {pv ? (
                <div className="ba">
                  <div className={`ba-after ${view === 'checker' ? 'checker' : ''}`} style={viewBg ? { background: viewBg } : undefined}>
                    <img src={pv.after} alt="" />
                  </div>
                  <div className="ba-before" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
                    <img src={pv.before} alt="" />
                  </div>
                  <div className="ba-line" style={{ left: `${split}%` }} />
                  <span className="ba-tag l">Sebelum</span>
                  <span className="ba-tag r">Sesudah</span>
                  <input className="ba-range" type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Geser sebelum/sesudah" />
                </div>
              ) : (
                <div className="empty small">{sel ? 'Menghitung pratinjau…' : 'Klik salah satu gambar untuk melihat pratinjau.'}</div>
              )}
            </section>

            <section className="panel alpha-settings">
              <div className="panel-head">
                <strong>Pengaturan</strong>
              </div>
              <div className="mfield">
                <span>Latar asli</span>
                <div className="seg">
                  {(['auto', 'black', 'white', 'color'] as const).map((b) => (
                    <button key={b} className={o.bg === b ? 'on' : ''} onClick={() => set('bg', b)}>
                      {b === 'auto' ? 'Otomatis' : BG_LABEL[b]}
                    </button>
                  ))}
                </div>
                {o.bg === 'color' && (
                  <label className="inline-field small" style={{ marginTop: 6 }}>
                    Warna latar <input type="color" value={o.color} onChange={(e) => set('color', e.target.value)} />
                  </label>
                )}
              </div>
              <label className="mfield">
                <span>
                  Bersihkan noise <em>{Math.round(o.floor * 100)}%</em>
                </span>
                <input type="range" min={0} max={0.3} step={0.01} value={o.floor} onChange={(e) => set('floor', Number(e.target.value))} />
              </label>
              <label className="mfield">
                <span>
                  Kekuatan glow <em>{o.glow.toFixed(2)}×</em>
                </span>
                <input type="range" min={0.5} max={2} step={0.05} value={o.glow} onChange={(e) => set('glow', Number(e.target.value))} />
              </label>
              <label className="check small">
                <input type="checkbox" checked={o.minMp} onChange={(e) => set('minMp', e.target.checked)} />
                Perbesar ke ±6 MP kalau di bawah 4 MP (syarat Adobe)
              </label>

              <div className="alpha-out">
                <strong className="small">Keluaran</strong>
                <label className="check small">
                  <input type="checkbox" checked disabled /> PNG transparan
                </label>
                <label className="check small">
                  <input type="checkbox" checked={o.jpg} onChange={(e) => set('jpg', e.target.checked)} /> JPG preview
                </label>
                {o.jpg && (
                  <div className="alpha-sub">
                    <select value={o.jpgStyle} onChange={(e) => set('jpgStyle', e.target.value as AlphaOptions['jpgStyle'])}>
                      <option value="split">Belah hitam | putih</option>
                      <option value="black">Latar hitam</option>
                      <option value="white">Latar putih</option>
                      <option value="checker">Petak transparan</option>
                      <option value="color">Warna</option>
                    </select>
                    {o.jpgStyle === 'color' && <input type="color" value={o.jpgColor} onChange={(e) => set('jpgColor', e.target.value)} />}
                    <input className="text-input" placeholder="Teks (opsional), mis. PNG" value={o.jpgText} maxLength={40} onChange={(e) => set('jpgText', e.target.value)} />
                  </div>
                )}
                <label className="check small">
                  <input type="checkbox" checked={o.psd} onChange={(e) => set('psd', e.target.checked)} /> PSD berlapis (efek + latar)
                </label>
                <div className="mfield">
                  <span>Nama file</span>
                  <div className="field-row">
                    <div className="seg">
                      <button className={o.naming === 'original' ? 'on' : ''} onClick={() => set('naming', 'original')}>
                        Nama asli
                      </button>
                      <button className={o.naming === 'sequence' ? 'on' : ''} onClick={() => set('naming', 'sequence')}>
                        Berurutan
                      </button>
                    </div>
                    {o.naming === 'sequence' && (
                      <input className="text-input grow" value={o.prefix} onChange={(e) => set('prefix', e.target.value)} placeholder="mis. fire-burst" />
                    )}
                  </div>
                  {o.naming === 'sequence' && <span className="muted small">Contoh: {(o.prefix || 'vfx').toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-001.png</span>}
                </div>
                <div className="mfield">
                  <span>Folder hasil</span>
                  <div className="field-row">
                    <span className="gen-path small">{o.outDir || 'Otomatis: folder "transparan-<waktu>" di sebelah gambar'}</span>
                    <button className="btn small" onClick={async () => set('outDir', (await window.api.alphaPickOut()) ?? o.outDir)}>
                      Ganti
                    </button>
                    {o.outDir && (
                      <button className="btn ghost small" onClick={() => set('outDir', '')}>
                        Otomatis
                      </button>
                    )}
                  </div>
                </div>
                <label className="check small">
                  <input type="checkbox" checked={o.zip} onChange={(e) => set('zip', e.target.checked)} /> Buat ZIP setelah selesai
                </label>
              </div>
            </section>
          </div>

          {progress ? (
            <section className="panel overall">
              <div className="overall-top">
                <strong>{progress.total ? Math.floor((progress.done / progress.total) * 100) : 0}%</strong>
                <span className="muted small">
                  {progress.done} dari {progress.total} gambar {progress.current && `· ${progress.current}`}
                  {progress.errors > 0 && ` · ${progress.errors} gagal`}
                </span>
                <span className="spacer" />
                <button className="btn small" onClick={() => void window.api.alphaCancel()}>
                  Batal
                </button>
              </div>
              <div className="bar">
                <div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
            </section>
          ) : (
            <div className="gen-go">
              <button className="btn primary big" onClick={() => void run()}>
                Proses {items.length} gambar
              </button>
            </div>
          )}

          {result && (
            <section className="panel">
              <div className="panel-head">
                <strong>{result.canceled ? 'Dihentikan' : 'Selesai'}</strong>
                <span className="muted small">
                  {result.pngs.length} PNG · {result.files} file total
                  {result.errors.length > 0 && ` · ${result.errors.length} gagal`}
                </span>
                <span className="spacer" />
                {result.pngs[0] && (
                  <button className="btn small" onClick={() => void window.api.showInFolder(result.zipPath ?? result.pngs[0])}>
                    Buka folder
                  </button>
                )}
                {result.pngs.length > 0 && (
                  <button className="btn small primary" onClick={() => onToMetadata(result.pngs)}>
                    Buat metadata ({result.pngs.length} PNG)
                  </button>
                )}
              </div>
              <div className="muted small">
                {result.outDir}
                {result.zipPath && ` · ZIP: ${result.zipPath}`}
              </div>
              {result.errors.map((e) => (
                <div key={e.path} className="small danger-text">
                  {e.path.split(/[\\/]/).pop()}: {e.error}
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
