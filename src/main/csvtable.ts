/** Baca dan tulis CSV apa adanya (kolom berkutip, koma/titik koma, baris CRLF atau LF). */

export type CsvTable = {
  rows: string[][]
  sep: string
  eol: string
  bom: boolean
}

/** Pisah kolom: koma, kecuali baris judul jelas memakai titik koma (mis. CSV Freepik). */
function guessSep(text: string): string {
  const end = text.search(/\r?\n/)
  const head = end < 0 ? text : text.slice(0, end)
  const count = (c: string) => head.split(c).length - 1
  return count(';') > count(',') ? ';' : ','
}

export function parseCsv(input: string): CsvTable {
  const bom = input.charCodeAt(0) === 0xfeff
  const text = bom ? input.slice(1) : input
  const sep = guessSep(text)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"' && cell === '') quoted = true
    else if (c === sep) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return { rows: rows.filter((r) => r.some((v) => v !== '')), sep, eol, bom }
}

/** Kutip hanya kalau perlu, sama seperti modul csv Python (QUOTE_MINIMAL). */
export function formatCsv(t: CsvTable): string {
  const cell = (v: string) => (v.includes('"') || v.includes(t.sep) || /[\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return (t.bom ? '﻿' : '') + t.rows.map((r) => r.map(cell).join(t.sep)).join(t.eol) + t.eol
}
