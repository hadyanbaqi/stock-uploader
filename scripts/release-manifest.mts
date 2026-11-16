/**
 * Susun latest.json untuk pembaruan otomatis dari installer hasil build.
 * Pakai: node scripts/release-manifest.mts <versi> <folder-installer> <file-catatan> <keluaran>
 * Folder dicari sampai ke subfolder: *.exe = Windows, *.dmg = Mac.
 */
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else out.push(p)
  }
  return out
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

/** Buang baris atribusi (Co-Authored-By, Claude-Session) dari catatan rilis. */
function cleanNotes(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^(Co-Authored-By|Claude-Session|Signed-off-by):/i.test(l.trim()))
    .join('\n')
    .trim()
}

const [version, dir, notesFile, out] = process.argv.slice(2)
if (!version || !dir || !out) {
  console.error('Pakai: node scripts/release-manifest.mts <versi> <folder> <catatan> <keluaran>')
  process.exit(2)
}
const v = version.replace(/^v/, '')
const files = await walk(dir)
const pick = async (ext: string) => {
  const found = files.filter((f) => f.toLowerCase().endsWith(ext) && path.basename(f).includes(v))
  if (found.length !== 1) throw new Error(`Harus ada tepat satu ${ext} untuk versi ${v}, ketemu ${found.length}: ${found.join(', ')}`)
  const f = found[0]
  return { name: path.basename(f), sha256: await sha256(f), size: (await fs.stat(f)).size, path: f }
}
const win = await pick('.exe')
const mac = await pick('.dmg')
const notes = notesFile ? cleanNotes(await fs.readFile(notesFile, 'utf8').catch(() => '')) : ''
const manifest = {
  version: v,
  date: new Date().toISOString(),
  notes,
  files: {
    win: { name: win.name, sha256: win.sha256, size: win.size },
    mac: { name: mac.name, sha256: mac.sha256, size: mac.size }
  }
}
await fs.writeFile(out, JSON.stringify(manifest, null, 2))
console.log(`latest.json: ${v}\n  ${win.name} ${win.size} ${win.sha256}\n  ${mac.name} ${mac.size} ${mac.sha256}`)
console.log(`ASSETS=${JSON.stringify([win.path, mac.path])}`)
