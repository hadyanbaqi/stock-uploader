import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Account, HistoryEntry } from '../../../shared/types'
import { presetByKey } from '../../../shared/presets'
import { formatBytes, formatDuration } from '../format'

const PAGE = 300
const dateFmt = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' })

function dayStart(s: string): number {
  return s ? new Date(`${s}T00:00:00`).getTime() : -Infinity
}
function dayEnd(s: string): number {
  return s ? new Date(`${s}T23:59:59.999`).getTime() : Infinity
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [q, setQ] = useState('')
  const [account, setAccount] = useState('')
  const [status, setStatus] = useState<'' | 'done' | 'failed'>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [note, setNote] = useState('')

  const refresh = useCallback(async () => setEntries(await window.api.historyList()), [])

  useEffect(() => {
    void refresh()
    void window.api.listAccounts().then(setAccounts)
    return window.api.onHistoryChanged(() => void refresh())
  }, [refresh])

  const colors = useMemo(() => new Map(accounts.map((a) => [a.id, a.color])), [accounts])

  const accountOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of entries) m.set(e.accountId, e.accountName)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [entries])

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase()
    const lo = dayStart(from)
    const hi = dayEnd(to)
    return entries
      .filter(
        (e) =>
          (!text || e.fileName.toLowerCase().includes(text)) &&
          (!account || e.accountId === account) &&
          (!status || e.status === status) &&
          e.at >= lo &&
          e.at <= hi
      )
      .sort((a, b) => b.at - a.at)
  }, [entries, q, account, status, from, to])

  const ok = filtered.filter((e) => e.status === 'done')
  const okSize = ok.reduce((s, e) => s + e.size, 0)
  const anyFilter = q || account || status || from || to

  async function exportCsv() {
    const saved = await window.api.historyExport(filtered.map((e) => e.id))
    setNote(saved ? `${filtered.length} baris disimpan ke CSV.` : '')
  }

  async function remove(e: HistoryEntry) {
    const msg =
      e.status === 'done'
        ? `Hapus catatan "${e.fileName}" ke ${e.accountName}?\nSetelah dihapus, file ini tidak lagi ditandai "sudah pernah dikirim" ke akun itu.`
        : `Hapus catatan gagal "${e.fileName}"?`
    if (!window.confirm(msg)) return
    await window.api.historyRemove([e.id])
    await refresh()
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Riwayat</h1>
          <p className="muted">
            {filtered.length} catatan · {ok.length} berhasil ({formatBytes(okSize)}) · {filtered.length - ok.length} gagal
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" disabled={!filtered.length} onClick={() => void exportCsv()}>
            Ekspor CSV
          </button>
        </div>
      </header>

      {note && <div className="banner info">{note}</div>}

      <section className="filters">
        <input className="search" placeholder="Cari nama file…" value={q} onChange={(e) => (setQ(e.target.value), setLimit(PAGE))} />
        <select value={account} onChange={(e) => (setAccount(e.target.value), setLimit(PAGE))}>
          <option value="">Semua akun</option>
          {accountOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => (setStatus(e.target.value as '' | 'done' | 'failed'), setLimit(PAGE))}>
          <option value="">Semua hasil</option>
          <option value="done">Berhasil</option>
          <option value="failed">Gagal</option>
        </select>
        <label className="inline-field small">
          Dari
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="inline-field small">
          sampai
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {anyFilter && (
          <button
            className="btn ghost small"
            onClick={() => {
              setQ('')
              setAccount('')
              setStatus('')
              setFrom('')
              setTo('')
            }}
          >
            Reset
          </button>
        )}
      </section>

      {!entries.length ? (
        <div className="empty">
          <h2>Belum ada riwayat</h2>
          <p>Setiap upload yang selesai atau gagal akan dicatat di sini. File yang sudah berhasil dikirim ke sebuah akun tidak akan dikirim dua kali.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>File</th>
                <th>Akun</th>
                <th className="num">Ukuran</th>
                <th>Hasil</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((e) => (
                <tr key={e.id}>
                  <td className="nowrap muted">{dateFmt.format(e.at)}</td>
                  <td className="cell-file" title={e.filePath}>
                    {e.fileName}
                  </td>
                  <td className="nowrap">
                    <span className="dot inline" style={{ background: colors.get(e.accountId) ?? 'var(--border)' }} />
                    {e.accountName}
                    <span className="muted small"> · {presetByKey(e.agency).name}</span>
                  </td>
                  <td className="num nowrap">{formatBytes(e.size)}</td>
                  <td>
                    {e.status === 'done' ? (
                      <span className="pill pill-done" title={e.ms ? `Lama upload ${formatDuration(e.ms / 1000)}` : undefined}>
                        Berhasil
                      </span>
                    ) : (
                      <span className="pill pill-failed" title={e.error}>
                        Gagal
                      </span>
                    )}
                    {e.status === 'failed' && e.error && <div className="small danger-text">{e.error}</div>}
                  </td>
                  <td>
                    <button className="icon-btn" title="Hapus dari riwayat" onClick={() => void remove(e)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > limit && (
            <div className="more">
              <button className="btn" onClick={() => setLimit(limit + PAGE)}>
                Tampilkan {Math.min(PAGE, filtered.length - limit)} lagi
              </button>
            </div>
          )}
          {!filtered.length && <p className="muted small more">Tidak ada yang cocok dengan filter.</p>}
        </div>
      )}
    </div>
  )
}
