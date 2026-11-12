import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './queue.css'

// File yang dijatuhkan di luar area upload jangan sampai membuka file itu di jendela aplikasi.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
