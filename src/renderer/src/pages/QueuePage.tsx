import { useEffect, useMemo, useState } from 'react'
import type { QueueAction, QueueTask, Settings, TaskStatus } from '../../../shared/types'
import { formatBytes, formatDuration, formatSpeed, percent } from '../format'

type Props = { tasks: QueueTask[]; onGoUpload: () => void }
type Filter = 'all' | 'active' | 'failed' | 'done'

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'Menunggu',
  uploading: 'Mengupload',
  retrying: 'Coba ulang',
  paused: 'Dijeda',
  done: 'Selesai',
  failed: 'Gagal',
  canceled: 'Dibatalkan'
}
const ORDER: Record<TaskStatus, number> = { uploading: 0, retrying: 1, queued: 2, paused: 3, failed: 4, canceled: 5, done: 6 }
const RUNNING: TaskStatus[] = ['queued', 'uploading', 'retrying']

export default function QueuePage({ tasks, onGoUpload }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
  }, [])

  // Hitung mundur "coba lagi dalam …".
  const hasRetry = tasks.some((t) => t.status === 'retrying')
  useEffect(() => {
    if (!hasRetry) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [hasRetry])

  const count = (s: TaskStatus[]) => tasks.filter((t) => s.includes(t.status)).length
  const nUploading = count(['uploading'])
  const nWaiting = count(['queued', 'retrying'])
  const nPaused = count(['paused'])
  const nFailed = count(['failed'])
  const nCanceled = count(['canceled'])
  const nDone = count(['done'])

  const pending = tasks.filter((t) => [...RUNNING, 'paused'].includes(t.status))
  const pendSize = pending.reduce((s, t) => s + t.size, 0)
  const pendSent = pending.reduce((s, t) => s + t.sent, 0)
  // Progress keseluruhan: yang sudah selesai ikut dihitung (sampai dibersihkan), yang gagal/dibatalkan tidak.
  const batch = tasks.filter((t) => t.status === 'done' || [...RUNNING, 'paused'].includes(t.status))
  const allSize = batch.reduce((s, t) => s + t.size, 0)
  const allSent = batch.reduce((s, t) => s + (t.status === 'done' ? t.size : Math.min(t.sent, t.size)), 0)
  const speed = tasks.reduce((s, t) => s + (t.status === 'uploading' ? t.speed : 0), 0)

  const shown = useMemo(() => {
    const pick: Record<Filter, (t: QueueTask) => boolean> = {
      all: () => true,
      active: (t) => [...RUNNING, 'paused'].includes(t.status),
      failed: (t) => t.status === 'failed' || t.status === 'canceled',
      done: (t) => t.status === 'done'
    }
    return tasks
      .filter(pick[filter])
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === 'done' ? (b.finishedAt ?? 0) - (a.finishedAt ?? 0) : a.addedAt - b.addedAt))
  }, [tasks, filter])

  const act = (action: QueueAction, ids: string[]) => void window.api.queueAction(action, ids)

  async function changePerAccount(n: number) {
    setSettings(await window.api.saveSettings({ perAccount: n }))
  }

  if (!tasks.length) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Antrean</h1>
          </div>
        </header>
        <div className="empty">
          <h2>Antrean kosong</h2>
          <p>File yang kamu upload akan muncul di sini, lengkap dengan progress-nya.</p>
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
          <h1>Antrean</h1>
          <p className="muted">
            {nUploading} mengupload · {nWaiting} menunggu · {nPaused} dijeda · {nFailed} gagal · {nDone} selesai
          </p>
        </div>
        <div className="head-actions">
          {settings && (
            <label className="inline-field small">
              Bersamaan per akun
              <select value={settings.perAccount} onChange={(e) => void changePerAccount(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          {nUploading + nWaiting > 0 && (
            <button className="btn" onClick={() => void window.api.queuePauseAll(true)}>
              Jeda semua
            </button>
          )}
          {nPaused > 0 && (
            <button className="btn primary" onClick={() => void window.api.queuePauseAll(false)}>
              Lanjutkan semua
            </button>
          )}
        </div>
      </header>

      {pending.length > 0 && (
        <section className="panel overall">
          <div className="overall-top">
            <strong>{percent(allSent, allSize)}%</strong>
            <span className="muted small">
              {nDone} dari {batch.length} file selesai · {formatBytes(allSent)} dari {formatBytes(allSize)}
              {speed > 0 && ` · ${formatSpeed(speed)} · sisa ± ${formatDuration((pendSize - pendSent) / speed)}`}
            </span>
          </div>
          <div className="bar">
            <div style={{ width: `${percent(allSent, allSize)}%` }} />
          </div>
        </section>
      )}

      <div className="toolbar">
        <div className="tabs">
          {(
            [
              ['all', `Semua ${tasks.length}`],
              ['active', `Berjalan ${nUploading + nWaiting + nPaused}`],
              ['failed', `Gagal ${nFailed + nCanceled}`],
              ['done', `Selesai ${nDone}`]
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button key={k} className={`tab ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {nFailed + nCanceled > 0 && (
          <button className="btn small" onClick={() => act('retry', tasks.filter((t) => t.status === 'failed' || t.status === 'canceled').map((t) => t.id))}>
            Coba lagi yang gagal
          </button>
        )}
        {nDone > 0 && (
          <button className="btn ghost small" onClick={() => void window.api.queueClearDone()}>
            Bersihkan yang selesai
          </button>
        )}
      </div>

      <div className="tasks">
        {shown.map((t) => (
          <TaskRow key={t.id} t={t} act={act} />
        ))}
        {!shown.length && <p className="muted small">Tidak ada tugas di sini.</p>}
      </div>
    </div>
  )
}

function TaskRow({ t, act }: { t: QueueTask; act: (a: QueueAction, ids: string[]) => void }) {
  const pct = percent(t.sent, t.size)
  let info = ''
  if (t.status === 'uploading') {
    info = `${pct}% · ${formatBytes(t.sent)} dari ${formatBytes(t.size)}`
    if (t.speed > 0) info += ` · ${formatSpeed(t.speed)} · sisa ${formatDuration((t.size - t.sent) / t.speed)}`
  } else if (t.status === 'retrying') {
    const s = Math.max(0, Math.ceil(((t.nextRetryAt ?? 0) - Date.now()) / 1000))
    info = `Dicoba lagi dalam ${s} dtk (percobaan ${t.attempt + 1} dari ${t.maxAttempts})`
  } else if (t.status === 'queued') {
    info = t.sent > 0 ? `Menunggu giliran · lanjut dari ${formatBytes(t.sent)}` : `Menunggu giliran · ${formatBytes(t.size)}`
  } else if (t.status === 'paused') {
    info = `Dijeda di ${pct}% · ${formatBytes(t.sent)} dari ${formatBytes(t.size)}`
  } else if (t.status === 'done') {
    info = formatBytes(t.size)
    if (t.startedAt && t.finishedAt) info += ` · ${formatDuration((t.finishedAt - t.startedAt) / 1000)}`
    if (t.resumedFrom) info += ` · dilanjutkan dari ${formatBytes(t.resumedFrom)}`
  } else if (t.status === 'canceled') {
    info = 'Dibatalkan'
  } else if (t.status === 'failed') {
    info = `Gagal setelah ${t.attempt} percobaan`
  }

  return (
    <article className={`task st-${t.status}`}>
      <span className="dot" style={{ background: t.accountColor }} title={t.accountName} />
      <div className="task-main">
        <div className="task-top">
          <span className="file-name" title={t.filePath}>
            {t.fileName}
          </span>
          <span className="muted small task-acc">{t.accountName}</span>
          <span className={`pill pill-${t.status}`}>{STATUS_LABEL[t.status]}</span>
        </div>
        {(t.status === 'uploading' || t.status === 'paused' || (t.status === 'queued' && t.sent > 0)) && (
          <div className="bar thin">
            <div style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="muted small">{info}</div>
        {t.error && (t.status === 'failed' || t.status === 'retrying') && (
          <div className={`small ${t.status === 'failed' ? 'danger-text' : ''}`}>
            {t.error}
            {t.errorDetail && <div className="detail">{t.errorDetail}</div>}
          </div>
        )}
      </div>
      <div className="task-actions">
        {(t.status === 'uploading' || t.status === 'queued' || t.status === 'retrying') && (
          <button className="btn small" onClick={() => act('pause', [t.id])}>
            Jeda
          </button>
        )}
        {t.status === 'paused' && (
          <button className="btn small primary" onClick={() => act('resume', [t.id])}>
            Lanjut
          </button>
        )}
        {(t.status === 'failed' || t.status === 'canceled') && (
          <button className="btn small primary" onClick={() => act('retry', [t.id])}>
            Coba lagi
          </button>
        )}
        {t.status !== 'done' && t.status !== 'canceled' && t.status !== 'failed' && (
          <button className="btn small ghost" onClick={() => act('cancel', [t.id])}>
            Batal
          </button>
        )}
        {(t.status === 'done' || t.status === 'canceled' || t.status === 'failed') && (
          <button className="icon-btn" title="Hapus dari daftar" onClick={() => act('remove', [t.id])}>
            ×
          </button>
        )}
      </div>
    </article>
  )
}
