import { useEffect, useState } from 'react'
import type { PickedFile, QueueTask, Settings } from '../../shared/types'
import AccountsPage from './pages/AccountsPage'
import HistoryPage from './pages/HistoryPage'
import MetadataPage from './pages/MetadataPage'
import QueuePage from './pages/QueuePage'
import SettingsPage from './pages/SettingsPage'
import UploadPage from './pages/UploadPage'

type PageKey = 'upload' | 'metadata' | 'queue' | 'history' | 'accounts' | 'settings'

const PAGES: { key: PageKey; label: string; icon: string }[] = [
  { key: 'upload', label: 'Upload', icon: '⇪' },
  { key: 'metadata', label: 'Metadata', icon: '✎' },
  { key: 'queue', label: 'Antrean', icon: '☰' },
  { key: 'history', label: 'Riwayat', icon: '⟲' },
  { key: 'accounts', label: 'Akun', icon: '◉' },
  { key: 'settings', label: 'Pengaturan', icon: '⚙' }
]

function pageFromHash(): PageKey {
  const h = location.hash.slice(1)
  return PAGES.some((p) => p.key === h) ? (h as PageKey) : 'upload'
}

export default function App() {
  const [page, setPage] = useState<PageKey>(pageFromHash)
  const [files, setFiles] = useState<PickedFile[]>([])
  const [tasks, setTasks] = useState<QueueTask[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [notice, setNotice] = useState('')

  // Pesan dari proses utama, mis. "12 file dipindah ke folder _sudah-upload".
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.api.onNotice((text) => {
      setNotice(text)
      clearTimeout(timer)
      timer = setTimeout(() => setNotice(''), 8000)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    void window.api.queueList().then(setTasks)
    void window.api.getSettings().then(setSettings)
    return window.api.onQueueChanged(setTasks)
  }, [])

  // Dipakai tes otomatis: tambahkan file ke daftar Upload tanpa seret-lepas.
  useEffect(() => {
    const onTest = (e: Event) => {
      void window.api.expandPaths((e as CustomEvent<string[]>).detail).then((r) => setFiles(r.files))
    }
    window.addEventListener('su-test-files', onTest)
    return () => window.removeEventListener('su-test-files', onTest)
  }, [])

  // Tema: ikuti sistem, atau paksa terang/gelap.
  useEffect(() => {
    const root = document.documentElement
    const theme = settings?.theme ?? 'dark'
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      if (theme === 'dark' || (theme === 'system' && mq.matches)) root.dataset.dark = ''
      else delete root.dataset.dark
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings])

  const running = tasks.filter((t) => t.status === 'uploading' || t.status === 'queued' || t.status === 'retrying').length
  const failed = tasks.filter((t) => t.status === 'failed').length

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 1024 1024" width="24" height="24">
              <path d="M512 204 L716 418 L588 418 L588 584 L436 584 L436 418 L308 418 Z" fill="#fff" />
              <rect x="232" y="640" width="560" height="64" rx="32" fill="#fff" opacity="0.7" />
              <rect x="232" y="744" width="560" height="64" rx="32" fill="#fff" opacity="0.45" />
            </svg>
          </span>
          <span>Stock Uploader</span>
        </div>
        <nav>
          {PAGES.map((p) => (
            <button
              key={p.key}
              className={`nav-item ${page === p.key ? 'active' : ''} ${p.key === 'settings' ? 'nav-bottom' : ''}`}
              onClick={() => setPage(p.key)}
            >
              <span className="nav-icon">{p.icon}</span>
              <span>{p.label}</span>
              {p.key === 'upload' && files.length > 0 && <span className="badge">{files.length}</span>}
              {p.key === 'queue' && running > 0 && <span className="badge run">{running}</span>}
              {p.key === 'queue' && !running && failed > 0 && <span className="badge fail">{failed}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">v{__APP_VERSION__}</div>
      </aside>

      <main className="content">
        {notice && (
          <div className="toast" role="status" onClick={() => setNotice('')}>
            {notice}
          </div>
        )}
        {page === 'upload' ? (
          <UploadPage
            files={files}
            setFiles={setFiles}
            onQueued={() => setPage('queue')}
            onGoAccounts={() => setPage('accounts')}
            onGoMetadata={() => setPage('metadata')}
          />
        ) : page === 'metadata' ? (
          <MetadataPage files={files} onGoUpload={() => setPage('upload')} onGoSettings={() => setPage('settings')} />
        ) : page === 'queue' ? (
          <QueuePage tasks={tasks} onGoUpload={() => setPage('upload')} />
        ) : page === 'history' ? (
          <HistoryPage />
        ) : page === 'accounts' ? (
          <AccountsPage />
        ) : (
          <SettingsPage settings={settings} onChange={setSettings} />
        )}
      </main>
    </div>
  )
}
