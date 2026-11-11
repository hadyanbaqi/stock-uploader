import { useState } from 'react'
import AccountsPage from './pages/AccountsPage'

type PageKey = 'upload' | 'queue' | 'accounts' | 'history'

const PAGES: { key: PageKey; label: string; icon: string; ready: boolean }[] = [
  { key: 'upload', label: 'Upload', icon: '⇪', ready: false },
  { key: 'queue', label: 'Antrean', icon: '☰', ready: false },
  { key: 'accounts', label: 'Akun', icon: '◉', ready: true },
  { key: 'history', label: 'Riwayat', icon: '⟲', ready: false }
]

export default function App() {
  const [page, setPage] = useState<PageKey>('accounts')

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">SU</span>
          <span>Stock Uploader</span>
        </div>
        <nav>
          {PAGES.map((p) => (
            <button
              key={p.key}
              className={`nav-item ${page === p.key ? 'active' : ''}`}
              onClick={() => setPage(p.key)}
            >
              <span className="nav-icon">{p.icon}</span>
              <span>{p.label}</span>
              {!p.ready && <span className="soon">segera</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">v0.1 · Tahap 1</div>
      </aside>

      <main className="content">
        {page === 'accounts' ? (
          <AccountsPage />
        ) : (
          <div className="placeholder">
            <h1>{PAGES.find((p) => p.key === page)?.label}</h1>
            <p>Halaman ini dibuat di tahap berikutnya. Untuk sekarang, siapkan dulu akun-akunmu di halaman Akun.</p>
          </div>
        )}
      </main>
    </div>
  )
}
