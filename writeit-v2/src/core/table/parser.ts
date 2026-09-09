import type {
  MarkdownTable,
  MarkdownTableScan,
  RejectedTableCandidate,
  TableAlignment,
  TableCell,
  TableRejectionReason,
} from './types'

interface LineRecord {
  readonly text: string
  readonly from: number
  readonly to: number
  readonly ending: '' | '\n' | '\r\n'
}

interface ParsedRow {
  readonly cells: readonly string[]
  readonly hasPipe: boolean
  readonly error?: 'unterminated-code-span'
}

const alignmentPattern = /^:?-{3,}:?$/u
const breakPattern = /^<br\s*\/?>/iu

function freezeCells(values: readonly string[]): readonly TableCell[] {
  return Object.freeze(values.map((value) => Object.freeze({ value })))
}

function lineRecords(source: string): readonly LineRecord[] {
  const records: LineRecord[] = []
  let from = 0
  while (from < source.length) {
    const newline = source.indexOf('\n', from)
    if (newline < 0) {
      records.push({ text: source.slice(from), from, to: source.length, ending: '' })
      break
    }
    const crlf = newline > from && source.charCodeAt(newline - 1) === 13
    records.push({
      text: source.slice(from, crlf ? newline - 1 : newline),
      from,
      to: newline + 1,
      ending: crlf ? '\r\n' : '\n',
    })
    from = newline + 1
  }
  if (source.length === 0) return Object.freeze([])
  return Object.freeze(records)
}

function countRun(value: string, offset: number, character: string): number {
  let length = 0
  while (value[offset + length] === character) length += 1
  return length
}

function decodeCellBreaks(value: string): string {
  let output = ''
  let offset = 0
  let codeDelimiter = 0
  while (offset < value.length) {
    if (value[offset] === '`') {
      const run = countRun(value, offset, '`')
      if (codeDelimiter === 0) codeDelimiter = run
      else if (run === codeDelimiter) codeDelimiter = 0
      output += value.slice(offset, offset + run)
      offset += run
      continue
    }
    if (codeDelimiter === 0 && value[offset] === '<') {
      const match = value.slice(offset).match(breakPattern)
      if (match) {
        output += '\n'
        offset += match[0].length
        continue
      }
    }
    output += value[offset]
    offset += 1
  }
  return output
}

function parseRow(line: string): ParsedRow {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return { cells: Object.freeze([]), hasPipe: false }

  const cells: string[] = []
  let current = ''
  let offset = 0
  let codeDelimiter = 0
  let hasPipe = false
  while (offset < trimmed.length) {
    const character = trimmed[offset]
    if (character === '\\' && offset + 1 < trimmed.length) {
      if (trimmed[offset + 1] === '|') {
        current += '|'
        offset += 2
        continue
      }
      current += character
      offset += 1
      continue
    }
    if (character === '`') {
      const run = countRun(trimmed, offset, '`')
      if (codeDelimiter === 0) codeDelimiter = run
      else if (run === codeDelimiter) codeDelimiter = 0
      current += trimmed.slice(offset, offset + run)
      offset += run
      continue
    }
    if (character === '|' && codeDelimiter === 0) {
      hasPipe = true
      cells.push(current.trim())
      current = ''
      offset += 1
      continue
    }
    current += character
    offset += 1
  }
  cells.push(current.trim())

  if (codeDelimiter !== 0) {
    return {
      cells: Object.freeze(cells),
      hasPipe,
      error: 'unterminated-code-span',
    }
  }
  if (trimmed.startsWith('|')) cells.shift()
  if (trimmed.endsWith('|')) cells.pop()
  return {
    cells: Object.freeze(cells.map(decodeCellBreaks)),
    hasPipe,
  }
}

function parseAlignment(value: string): TableAlignment | undefined {
  const cell = value.trim()
  if (!alignmentPattern.test(cell)) return undefined
  if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
  if (cell.startsWith(':')) return 'left'
  if (cell.endsWith(':')) return 'right'
  return null
}

function makeRange(lines: readonly LineRecord[], startLine: number, endLine: number) {
  return Object.freeze({
    from: lines[startLine].from,
    to: lines[endLine].to,
    startLine,
    endLine,
  })
}

function rejection(
  source: string,
  lines: readonly LineRecord[],
  startLine: number,
  endLine: number,
  reason: TableRejectionReason,
): RejectedTableCandidate {
  const range = makeRange(lines, startLine, endLine)
  return Object.freeze({ range, source: source.slice(range.from, range.to), reason })
}

/**
 * Scans conservative Markdown pipe tables without repairing rejected source.
 * Valid tables and explainable candidate rejections are returned separately.
 */
export function scanMarkdownTables(source: string): MarkdownTableScan {
  if (typeof source !== 'string') throw new TypeError('Markdown source must be a string')
  const lines = lineRecords(source)
  const tables: MarkdownTable[] = []
  const rejected: RejectedTableCandidate[] = []

  for (let index = 0; index + 1 < lines.length; index += 1) {
    const header = parseRow(lines[index].text)
    const separator = parseRow(lines[index + 1].text)
    if (!header.hasPipe || !separator.hasPipe) continue

    if (header.error || separator.error) {
      rejected.push(rejection(source, lines, index, index + 1, 'unterminated-code-span'))
      index += 1
      continue
    }

    const alignments = separator.cells.map(parseAlignment)
    if (
      header.cells.length === 0 ||
      separator.cells.length !== header.cells.length ||
      alignments.some((alignment) => alignment === undefined)
    ) {
      const looksLikeSeparator = separator.cells.some((cell) => /^:?-+/u.test(cell))
      if (looksLikeSeparator) {
        rejected.push(rejection(source, lines, index, index + 1, 'invalid-separator'))
        index += 1
      }
      continue
    }

    const rows: Array<readonly TableCell[]> = [freezeCells(header.cells)]
    let endLine = index + 1
    let rejectionReason: TableRejectionReason | undefined
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = parseRow(lines[rowIndex].text)
      if (!row.hasPipe) break
      if (row.error) {
        rejectionReason = 'unterminated-code-span'
        endLine = rowIndex
        break
      }
      if (row.cells.length !== header.cells.length) {
        rejectionReason = 'column-count-mismatch'
        endLine = rowIndex
        break
      }
      rows.push(freezeCells(row.cells))
      endLine = rowIndex
    }

    if (rejectionReason) {
      rejected.push(rejection(source, lines, index, endLine, rejectionReason))
      index = endLine
      continue
    }

    const range = makeRange(lines, index, endLine)
    const table: MarkdownTable = Object.freeze({
      rows: Object.freeze(rows),
      alignments: Object.freeze(alignments as TableAlignment[]),
      range,
      source: source.slice(range.from, range.to),
      lineEnding: lines.slice(index, endLine + 1).some((line) => line.ending === '\r\n')
        ? '\r\n'
        : '\n',
    })
    tables.push(table)
    index = endLine
  }

  return Object.freeze({
    tables: Object.freeze(tables),
    rejected: Object.freeze(rejected),
  })
}

export function parseMarkdownTables(source: string): readonly MarkdownTable[] {
  return scanMarkdownTables(source).tables
}

export function parseMarkdownTableAt(source: string, offset: number): MarkdownTable | null {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) {
    throw new RangeError(`Table offset must be between 0 and ${source.length}`)
  }
  return parseMarkdownTables(source).find((table) => offset >= table.range.from && offset < table.range.to) ?? null
}

