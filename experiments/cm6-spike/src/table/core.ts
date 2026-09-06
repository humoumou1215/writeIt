export type Alignment = 'left' | 'center' | 'right' | null

export interface TableCell {
  value: string
}

export interface TableSelection {
  anchorRow: number
  anchorColumn: number
  headRow: number
  headColumn: number
}

export interface TableModel {
  rows: TableCell[][]
  alignment: Alignment[]
  start: number
  end: number
  source: string
  lineStart: number
  lineEnd: number
}

export interface ClipboardMatrix {
  rows: string[][]
  source: 'tsv' | 'html'
}

export function parseTables(markdown: string): TableModel[] {
  const lines = lineRecords(markdown)
  const tables: TableModel[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    const header = splitTableRow(lines[i].text)
    const separator = splitTableRow(lines[i + 1].text)
    if (!header || !separator || !separator.every(isAlignmentCell)) continue
    const width = Math.max(header.length, separator.length)
    const rows = [padRow(header, width)]
    let lineEnd = i + 1
    for (let j = i + 2; j < lines.length; j++) {
      const row = splitTableRow(lines[j].text)
      if (!row) break
      rows.push(padRow(row, width))
      lineEnd = j
    }
    const alignment = separator.map(parseAlignment)
    while (alignment.length < width) alignment.push(null)
    tables.push({
      rows,
      alignment,
      start: lines[i].start,
      end: lines[lineEnd].end,
      source: markdown.slice(lines[i].start, lines[lineEnd].end),
      lineStart: i,
      lineEnd,
    })
    i = lineEnd
  }
  return tables
}

export function parseTableAt(markdown: string, offset = 0): TableModel | null {
  return parseTables(markdown).find((table) => offset >= table.start && offset < table.end) ?? null
}

export function serializeTable(model: TableModel): string {
  const width = model.alignment.length
  const rows = model.rows.map((row) => `| ${Array.from({ length: width }, (_, index) => escapeCell(row[index]?.value ?? '')).join(' | ')} |`)
  const separators = model.alignment.map((alignment) => {
    if (alignment === 'center') return ':---:'
    if (alignment === 'right') return '---:'
    if (alignment === 'left') return ':---'
    return '---'
  })
  rows.splice(1, 0, `| ${separators.join(' | ')} |`)
  return rows.join('\n')
}

/** Preserve the original Markdown byte-for-byte when the model was not edited. */
export function roundTripTable(model: TableModel): string {
  return model.source
}

export function replaceTable(markdown: string, model: TableModel): string {
  const lineEnding = model.source.endsWith('\r\n') ? '\r\n' : model.source.endsWith('\n') ? '\n' : ''
  return `${markdown.slice(0, model.start)}${serializeTable(model)}${lineEnding}${markdown.slice(model.end)}`
}

export function normalizeSelection(selection: TableSelection): { top: number; left: number; bottom: number; right: number } {
  return {
    top: Math.min(selection.anchorRow, selection.headRow),
    left: Math.min(selection.anchorColumn, selection.headColumn),
    bottom: Math.max(selection.anchorRow, selection.headRow),
    right: Math.max(selection.anchorColumn, selection.headColumn),
  }
}

export function isSelected(selection: TableSelection, row: number, column: number): boolean {
  const bounds = normalizeSelection(selection)
  return row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right
}

export function updateCell(model: TableModel, row: number, column: number, value: string): TableModel {
  const next = cloneTable(model)
  ensureCell(next, row, column)
  next.rows[row][column] = { value }
  return next
}

export function pasteMatrix(model: TableModel, selection: TableSelection, matrix: string[][]): TableModel {
  const next = cloneTable(model)
  const { top, left } = normalizeSelection(selection)
  matrix.forEach((row, rowOffset) => {
    row.forEach((value, columnOffset) => {
      ensureCell(next, top + rowOffset, left + columnOffset)
      next.rows[top + rowOffset][left + columnOffset] = { value }
    })
  })
  return next
}

export function addRow(model: TableModel, afterRow = model.rows.length - 1): TableModel {
  const next = cloneTable(model)
  const index = Math.max(1, Math.min(afterRow + 1, next.rows.length))
  next.rows.splice(index, 0, Array.from({ length: next.alignment.length }, () => ({ value: '' })))
  return next
}

export function deleteRow(model: TableModel, row = model.rows.length - 1): TableModel {
  if (model.rows.length <= 2) return cloneTable(model)
  const next = cloneTable(model)
  const index = Math.max(1, Math.min(row, next.rows.length - 1))
  next.rows.splice(index, 1)
  return next
}

export function addColumn(model: TableModel, afterColumn = model.alignment.length - 1): TableModel {
  const next = cloneTable(model)
  const index = Math.max(0, Math.min(afterColumn + 1, next.alignment.length))
  next.alignment.splice(index, 0, null)
  next.rows.forEach((row) => row.splice(index, 0, { value: '' }))
  return next
}

export function deleteColumn(model: TableModel, column = model.alignment.length - 1): TableModel {
  if (model.alignment.length <= 1) return cloneTable(model)
  const next = cloneTable(model)
  const index = Math.max(0, Math.min(column, next.alignment.length - 1))
  next.alignment.splice(index, 1)
  next.rows.forEach((row) => row.splice(index, 1))
  return next
}

export function matrixFromSelection(model: TableModel, selection: TableSelection): string[][] {
  const { top, left, bottom, right } = normalizeSelection(selection)
  return model.rows.slice(top, bottom + 1).map((row) => row.slice(left, right + 1).map((cell) => cell.value))
}

export function serializeSelectionTsv(model: TableModel, selection: TableSelection): string {
  return matrixFromSelection(model, selection).map((row) => row.join('\t')).join('\n')
}

export function serializeSelectionHtml(model: TableModel, selection: TableSelection): string {
  const body = matrixFromSelection(model, selection)
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')
  return `<table><tbody>${body}</tbody></table>`
}

export function parseClipboardTsv(text: string): ClipboardMatrix {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  return { source: 'tsv', rows: normalized ? normalized.split('\n').map((line) => line.split('\t')) : [[]] }
}

export function parseClipboardHtml(html: string): ClipboardMatrix {
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(html, 'text/html')
    const rows = [...document.querySelectorAll('tr')].map((row) =>
      [...row.querySelectorAll('th,td')].map((cell) => cell.textContent ?? ''),
    )
    if (rows.length > 0) return { source: 'html', rows }
  }
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) =>
    [...match[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((cell) =>
      decodeHtml(cell[1].replace(/<[^>]+>/g, '')),
    ),
  )
  return { source: 'html', rows }
}

function lineRecords(markdown: string): Array<{ text: string; start: number; end: number }> {
  const records: Array<{ text: string; start: number; end: number }> = []
  const pattern = /.*(?:\n|$)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(markdown))) {
    if (match[0] === '') break
    const full = match[0]
    const text = full.endsWith('\n') ? full.slice(0, -1).replace(/\r$/, '') : full
    const start = match.index
    const end = start + full.length
    records.push({ text, start, end })
  }
  return records
}

function splitTableRow(line: string): string[] | null {
  if (!line.includes('|')) return null
  const cells: string[] = []
  let current = ''
  let escaped = false
  let inCode = false
  for (const char of line) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      current += char
      escaped = true
      continue
    }
    if (char === '`') inCode = !inCode
    if (char === '|' && !inCode) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  if (cells[0] === '') cells.shift()
  if (cells.at(-1) === '') cells.pop()
  return cells.length > 0 ? cells.map(unescapeCell) : null
}

function isAlignmentCell(cell: string): boolean {
  return /^:?-{1,}:?$/.test(cell.trim())
}

function parseAlignment(cell: string): Alignment {
  const value = cell.trim()
  if (value.startsWith(':') && value.endsWith(':')) return 'center'
  if (value.endsWith(':')) return 'right'
  if (value.startsWith(':')) return 'left'
  return null
}

function padRow(row: string[], width: number): TableCell[] {
  return Array.from({ length: width }, (_, index) => ({ value: row[index] ?? '' }))
}

function cloneTable(model: TableModel): TableModel {
  return { ...model, rows: model.rows.map((row) => row.map((cell) => ({ ...cell }))), alignment: [...model.alignment] }
}

function ensureCell(model: TableModel, row: number, column: number): void {
  while (model.rows.length <= row) model.rows.push(Array.from({ length: model.alignment.length }, () => ({ value: '' })))
  while (model.alignment.length <= column) model.alignment.push(null)
  model.rows.forEach((cells) => {
    while (cells.length <= column) cells.push({ value: '' })
  })
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

function unescapeCell(value: string): string {
  return value.replace(/\\\|/g, '|')
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
