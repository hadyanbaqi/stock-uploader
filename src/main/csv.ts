import { ADOBE_CATEGORIES, type FileMeta } from '../shared/metadata.ts'

export type CsvItem = { name: string; ext: string; meta: FileMeta }

function cell(v: string, sep: string): string {
  return v.includes('"') || v.includes(sep) || /[\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function table(head: string[], rows: string[][], sep = ','): string {
  return [head, ...rows].map((r) => r.map((v) => cell(v, sep)).join(sep)).join('\r\n') + '\r\n'
}

const isVector = (ext: string) => ['eps', 'ai', 'svg'].includes(ext.toLowerCase())
const isVideo = (ext: string) => ['mp4', 'mov'].includes(ext.toLowerCase())

/**
 * CSV metadata per agensi, untuk diupload di halaman Submit agensi.
 * Adobe dan Shutterstock mengikuti contoh CSV resmi mereka; agensi lain memakai kolom inti
 * (nama file, judul, deskripsi, keyword).
 */
export function buildCsv(agency: string, items: CsvItem[]): string {
  const kw = (m: FileMeta) => m.keywords.join(', ')
  switch (agency) {
    case 'adobe':
      return table(
        ['Filename', 'Title', 'Keywords', 'Category', 'Releases'],
        items.map((i) => [i.name, i.meta.title, kw(i.meta), ADOBE_CATEGORIES[i.meta.adobeCategory] ? String(i.meta.adobeCategory) : '', ''])
      )
    case 'shutterstock':
      return table(
        ['Filename', 'Description', 'Keywords', 'Categories', 'Illustration', 'Mature Content', 'Editorial'],
        items.map((i) => [
          i.name,
          i.meta.description.length >= i.meta.title.length && i.meta.description.length <= 200 ? i.meta.description : i.meta.title,
          kw(i.meta),
          i.meta.ssCategories.join(','),
          isVector(i.ext) || (i.meta.aiGenerated && !isVideo(i.ext)) ? 'yes' : 'no',
          'no',
          'no'
        ])
      )
    case 'vecteezy':
      return table(
        ['Filename', 'Title', 'Description', 'Keywords'],
        items.map((i) => [i.name, i.meta.title, i.meta.description, kw(i.meta)])
      )
    case 'freepik':
      // Freepik memakai titik koma sebagai pemisah kolom.
      return table(
        ['Filename', 'Title', 'Keywords', 'Prompt', 'Model'],
        items.map((i) => [i.name, i.meta.title, kw(i.meta), i.meta.aiGenerated ? i.meta.description : '', '']),
        ';'
      )
    case 'pond5':
      return table(
        ['originalfilename', 'title', 'description', 'keywords'],
        items.map((i) => [i.name, i.meta.title, i.meta.description, kw(i.meta)])
      )
    case 'dreamstime':
      return table(
        ['Filename', 'Image Name', 'Description', 'keywords'],
        items.map((i) => [i.name, i.meta.title, i.meta.description, kw(i.meta)])
      )
    case '123rf':
      return table(
        ['oldfilename', '123rf_filename', 'description', 'keywords', 'country'],
        items.map((i) => [i.name, '', i.meta.title, kw(i.meta), ''])
      )
    default:
      throw new Error(`Format CSV untuk "${agency}" belum ada.`)
  }
}
