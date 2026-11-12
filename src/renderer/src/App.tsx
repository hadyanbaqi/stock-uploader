import { useEffect, useState } from 'react'
import type { PickedFile, QueueTask } from '../../shared/types'
import AccountsPage from './pages/AccountsPage'
import HistoryPage from './pages/HistoryPage'
import QueuePage from './pages/QueuePage'
import UploadPage from './pages/UploadPage'

type PageKey = 'upload' | 'queue' | 'accounts' | 'history'

const PAGES: { key: PageKey; label: string; icon: string; ready: boolean }[] = [
  { key: 'upload', label: 'Upload', icon: '⇪', ready: true },
  { key: 'queue', label: 'Antrean', icon: '☰', ready: true },
  { key: 'accounts', label: 'Akun', icon: '◉', ready: true },
  { key: 'history', label: 'Riwayat', icon: '⟲', ready: true }
]

function pageFromHash(): PageKey {
  const h = location.hash.slice(1)
  return PAGES.some((p) => p.key === h) ? (h as PageKey) : 'upload'
}

export default function App() {
  const [page, setPage] = useState<PageKey>(pageFromHash)
  const [files, setFiles] = useState<PickedFile[]>([])
  const [tasks, setTasks] = useState<QueueTask[]>([])

  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    void window.api.queueList().then(setTasks)
    return window.api.onQueueChanged(setTasks)
  }, [])

  const running = tasks.filter((t) => t.status === 'uploading' || t.status === 'queued' || t.status === 'retrying').length
  const failed = tasks.filter((t) => t.status === 'failed').length

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
              {p.key === 'upload' && files.length > 0 && <span className="badge">{files.length}</span>}
              {p.key === 'queue' && running > 0 && <span className="badge run">{running}</span>}
              {p.key === 'queue' && !running && failed > 0 && <span className="badge fail">{failed}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">v0.3 · Tahap 3</div>
      </aside>

      <main className="content">
        {page === 'upload' ? (
          <UploadPage
            files={files}
            setFiles={setFiles}
            onQueued={() => setPage('queue')}
            onGoAccounts={() => setPage('accounts')}
          />
        ) : page === 'queue' ? (
          <QueuePage tasks={tasks} onGoUpload={() => setPage('upload')} />
        ) : page === 'accounts' ? (
          <AccountsPage />
        ) : (
          <HistoryPage />
        )}
      </main>
    </div>
  )
}
