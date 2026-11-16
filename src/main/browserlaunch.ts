/**
 * Cari Chrome di komputer dan susun flag untuk membuka satu profil. Tanpa Electron, supaya bisa dites.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

/** Kandidat lokasi browser berbasis Chromium, urut dari yang paling disukai. */
export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean) as string[]
    const rel = [
      'Google\\Chrome\\Application\\chrome.exe',
      'Google\\Chrome Beta\\Application\\chrome.exe',
      'Chromium\\Application\\chrome.exe',
      'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'Microsoft\\Edge\\Application\\msedge.exe'
    ]
    return rel.flatMap((r) => roots.map((root) => path.win32.join(root, r)))
  }
  if (platform === 'darwin') {
    const apps = [
      'Google Chrome.app/Contents/MacOS/Google Chrome',
      'Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      'Chromium.app/Contents/MacOS/Chromium',
      'Brave Browser.app/Contents/MacOS/Brave Browser',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ]
    const roots = ['/Applications', env.HOME ? path.posix.join(env.HOME, 'Applications') : ''].filter(Boolean)
    return apps.flatMap((a) => roots.map((r) => path.posix.join(r, a)))
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/brave-browser', '/usr/bin/microsoft-edge']
}

/** Lokasi browser: pilihan manual kalau masih ada, kalau tidak cari otomatis. */
export function findBrowser(
  manual: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync
): string | null {
  if (manual && exists(manual)) return manual
  return browserCandidates(platform, env).find((p) => exists(p)) ?? null
}

export type LaunchOptions = {
  userDataDir: string
  /** Proxy lokal (perantara), mis. http://127.0.0.1:51234. null = tanpa proxy. */
  proxyUrl: string | null
  startUrls: string[]
}

/** Flag Chrome untuk satu profil. */
export function buildArgs(o: LaunchOptions): string[] {
  const args = [
    `--user-data-dir=${o.userDataDir}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    // Supaya WebRTC tidak membocorkan IP asli di luar proxy.
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'
  ]
  if (o.proxyUrl) {
    args.push(`--proxy-server=${o.proxyUrl}`)
  }
  return [...args, ...o.startUrls]
}
