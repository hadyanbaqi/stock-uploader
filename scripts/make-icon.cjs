// Membuat build/icon.png (1024x1024) dari SVG, memakai Electron. Jalankan: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#4338ca"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/>
  <rect x="232" y="640" width="560" height="64" rx="32" fill="#ffffff" opacity="0.55"/>
  <rect x="232" y="744" width="560" height="64" rx="32" fill="#ffffff" opacity="0.3"/>
  <path d="M512 204 L716 418 L588 418 L588 584 L436 584 L436 418 L308 418 Z" fill="#ffffff"/>
</svg>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`))
  await new Promise((r) => setTimeout(r, 500))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  const out = path.join(__dirname, '..', 'build', 'icon.png')
  fs.writeFileSync(out, img.resize({ width: 1024, height: 1024 }).toPNG())
  console.log('ikon dibuat:', out, img.getSize())
  app.quit()
})
