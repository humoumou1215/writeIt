import type { MarkdownTable, SerializeTableOptions, TableAlignment } from './types'

function countRun(value: string, offset: number): number {
  let length = 0
  while (value[offset + length] === '`') length += 1
  return length
}

function encodeCell(value: string): string {
  let output = ''
  let offset = 0
  let codeDelimiter = 0
  while (offset < value.length) {
    const character = value[offset]
    if (character === '`') {
      const run = countRun(value, offset)
      if (codeDelimiter === 0) codeDelimiter = run
      else if (run === codeDelimiter) codeDelimiter = 0
      output += value.slice(offset, offset + run)
      offset += run
      continue
    }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && value[offset + 1] === '\n') offset += 1
      output += '<br>'
    } else if (character === '|' && codeDelimiter === 0) {
      output += '\\|'
    } else {
      output += character
    }
    offset += 1
  }
  return output
}

function alignmentSource(alignment: TableAlignment): string {
  if (alignment === 'left') return ':---'
  if (alignment === 'center') return ':---:'
  if (alignment === 'right') return '---:'
  return '---'
}

function requireTableShape(table: MarkdownTable): number {
  if (table.rows.length === 0) throw new RangeError('Table must contain a header row')
  const width = table.alignments.length
  if (width === 0) throw new RangeError('Table must contain at least one column')
  if (table.rows.some((row) => row.length !== width)) {
    throw new RangeError('Every table row must match the alignment column count')
  }
  return width
}

/** Canonicalizes an intentionally edited table, never the surrounding source. */
export function serializeMarkdownTable(
  table: MarkdownTable,
  options: SerializeTableOptions = {},
): string {
  requireTableShape(table)
  const lineEnding = options.lineEnding ?? table.lineEnding
  const rows = table.rows.map(
    (row) => `| ${row.map((cell) => encodeCell(cell.value)).join(' | ')} |`,
  )
  rows.splice(1, 0, `| ${table.alignments.map(alignmentSource).join(' | ')} |`)
  const trailingLineEnding = options.trailingLineEnding ?? /(?:\r?\n)$/u.test(table.source)
  return `${rows.join(lineEnding)}${trailingLineEnding ? lineEnding : ''}`
}

/** The no-edit round trip is the exact original slice, including line endings. */
export function untouchedTableSource(table: MarkdownTable): string {
  return table.source
}

export function replaceMarkdownTable(source: string, table: MarkdownTable): string {
  if (source.slice(table.range.from, table.range.to) !== table.source) {
    throw new Error('Table source range no longer matches the document source')
  }
  return `${source.slice(0, table.range.from)}${serializeMarkdownTable(table)}${source.slice(table.range.to)}`
}

