import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Settings } from '../../../shared/types'
import {
  UPSCALE_DEFAULTS,
  UPSCALE_FORMATS,
  UPSCALE_MODELS,
  type UpscaleFormat,
  type UpscaleModel,
  type UpscaleOptions,
  type UpscaleScale
} from '../../../shared/upscale'

const isMac = navigator.userAgent.includes('Mac')

/** Peringatan: upscale berjalan di komputer ini, bukan di server. */
function LocalWarning({ onOk, onCancel }: { onOk(): void; onCancel(): void }) {
  const [agree, setAgree] = useState(false)
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="alertdialog" aria-labelledby="up-warn-title">
        <header className="modal-head">
          <h2 id="up-warn-title">⚠️ Upscale berjalan di komputer ini</h2>
        </header>
        <div className="up-warn">
          <p>
            Upscale AI tidak dikirim ke internet. Semua dihitung oleh <strong>kartu grafis (GPU) komputer ini</strong>, jadi:
          </p>
          <ul>
            <li>
              <strong>Komputer bisa panas, kipas berbunyi, dan terasa lambat</strong> selama upscale. Aplikasi lain (Photoshop, game, video) ikut melambat.
            </li>
            <li>
              <strong>Butuh waktu:</strong> sekitar 5–60 detik per gambar, tergantung kartu grafis, ukuran gambar, dan model. Skala 4× dan model "Foto & umum" paling lama.
            </li>
            <li>
              {isMac ? (
                <>Mac M1/M2/M3/M4 didukung. Mac Intel lama bisa sangat lambat.</>
              ) : (
                <>
                  Perlu <strong>driver kartu grafis terbaru</strong> (NVIDIA, AMD, atau Intel yang mendukung Vulkan). Komputer tanpa kartu grafis bisa gagal atau sangat lambat.
                </>
              )}
            </li>
            <li>Laptop: sebaiknya colok charger. Satu gambar diproses sekali waktu.</li>
            <li>Kalau upscale gagal, gambar tetap disimpan seperti biasa (tanpa upscale AI) dan muncul pesan alasannya.</li>
          </ul>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            Saya mengerti, jalankan di komputer ini
          </label>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="btn ghost" onClick={onCancel}>
            Batal
          </button>
          <button className="btn primary" disabled={!agree} onClick={onOk}>
            Aktifkan upscale
          </button>
        </footer>
      </div>
    </div>
  )
}

export default function UpscalePanel({ settings, save }: { settings: Settings; save: (p: Partial<Settings>) => Promise<void> }) {
  const up: UpscaleOptions = { ...UPSCALE_DEFAULTS, ...(settings.genUpscale ?? {}) }
  const [avail, setAvail] = useState<{ ok: boolean; reason?: string } | null>(null)
  const [warn, setWarn] = useState(false)
  const model = UPSCALE_MODELS[up.model]

  useEffect(() => {
    void window.api.upscaleInfo().then(setAvail)
  }, [])

  const set = (patch: Partial<UpscaleOptions>) => void save({ genUpscale: { ...up, ...patch } })

  const toggle = (on: boolean) => {
    if (on && !settings.upscaleWarned) {
      setWarn(true)
      return
    }
    set({ enabled: on })
  }

  return (
    <div className="gen2-block up-panel">
      <label className="check up-toggle">
        <input type="checkbox" checked={up.enabled} disabled={avail?.ok === false} onChange={(e) => toggle(e.target.checked)} />
        <span>
          <strong>Upscale AI saat disimpan</strong>
          <span className="up-local">berjalan di komputer ini</span>
        </span>
      </label>
      {avail?.ok === false && <div className="small danger-text">{avail.reason}</div>}

      {up.enabled && (
        <>
          <label className="mfield">
            <span>Model</span>
            <select value={up.model} onChange={(e) => set({ model: e.target.value as UpscaleModel })}>
              {(Object.keys(UPSCALE_MODELS) as UpscaleModel[]).map((k) => (
                <option key={k} value={k}>
                  {UPSCALE_MODELS[k].label}
                </option>
              ))}
            </select>
            <span className="muted small">{model.hint}</span>
          </label>

          <div className="mfield">
            <span>Perbesar</span>
            <div className="seg">
              {([2, 3, 4] as UpscaleScale[]).map((s) => (
                <button key={s} className={up.scale === s ? 'on' : ''} onClick={() => set({ scale: s })}>
                  {s}×
                </button>
              ))}
            </div>
            {!model.scales.includes(up.scale) && (
              <span className="muted small">Model ini selalu 4×, lalu diperkecil ke {up.scale}× (tetap lebih tajam dari diperbesar biasa).</span>
            )}
          </div>

          <label className="mfield">
            <span>Simpan sebagai</span>
            <select value={up.format} onChange={(e) => set({ format: e.target.value as UpscaleFormat })}>
              {(Object.keys(UPSCALE_FORMATS) as UpscaleFormat[]).map((f) => (
                <option key={f} value={f}>
                  {UPSCALE_FORMATS[f]}
                </option>
              ))}
            </select>
          </label>

          <div className="up-note small">
            ⚠️ Memakai kartu grafis komputer ini: bisa panas dan lambat, ±5–60 detik per gambar.{' '}
            {up.scale === 2 && 'Gambar 1024 px jadi 2048 px; untuk Adobe Stock (min. 4 MP) pilih 3× atau 4× bila gambar asli kecil.'}
            {up.format !== 'jpg' && ' Adobe Stock dan Shutterstock menerima foto/ilustrasi dalam JPG.'}
          </div>
        </>
      )}

      {warn &&
        createPortal(
          <LocalWarning
            onCancel={() => setWarn(false)}
            onOk={() => {
              setWarn(false)
              void save({ upscaleWarned: true, genUpscale: { ...up, enabled: true } })
            }}
          />,
          document.body
        )}
    </div>
  )
}
