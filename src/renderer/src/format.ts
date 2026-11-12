const num = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 })

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = b / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${num.format(v)} ${units[i]}`
}

export function formatSpeed(bps: number): string {
  return bps > 0 ? `${formatBytes(Math.round(bps))}/dtk` : ''
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return ''
  sec = Math.round(sec)
  if (sec < 60) return `${sec} dtk`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m} mnt ${sec % 60} dtk`
  const h = Math.floor(m / 60)
  return `${h} jam ${m % 60} mnt`
}

export function percent(sent: number, size: number): number {
  if (size <= 0) return sent > 0 ? 100 : 0
  return Math.min(100, Math.floor((sent / size) * 100))
}
