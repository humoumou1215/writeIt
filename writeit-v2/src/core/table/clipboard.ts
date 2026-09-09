export interface TableClipboardMatrix {
  readonly rows: readonly (readonly string[])[]
  readonly source: 'html' | 'tsv'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

function decodeHtml(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|amp|lt|gt|quot|apos|nbsp);/giu, (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10))
    if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16))
    const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': '\u00a0' }
    return named[entity.toLowerCase()] ?? entity
  })
}

function encodeTsvField(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n')
  return /[\t\n"]/u.test(normalized) ? `"${normalized.replace(/"/gu, '""')}"` : normalized
}

export function serializeTableTsv(matrix: readonly (readonly string[])[]): string {
  return matrix.map((row) => row.map(encodeTsvField).join('\t')).join('\n')
}

export function parseTableTsv(text: string): TableClipboardMatrix {
  if (typeof text !== 'string') throw new TypeError('TSV clipboard text must be a string')
  const rows: string[][] = [[]]
  let field = ''
  let quoted = false
  let offset = 0
  const commitField = () => {
    rows[rows.length - 1].push(field)
    field = ''
  }
  while (offset < text.length) {
    const character = text[offset]
    if (quoted) {
      if (character === '"' && text[offset + 1] === '"') {
        field += '"'
        offset += 2
      } else if (character === '"') {
        quoted = false
        offset += 1
      } else {
        field += character === '\r' && text[offset + 1] === '\n' ? '\n' : character
        offset += character === '\r' && text[offset + 1] === '\n' ? 2 : 1
      }
      continue
    }
    if (character === '"' && field.length === 0) {
      quoted = true
      offset += 1
    } else if (character === '\t') {
      commitField()
      offset += 1
    } else if (character === '\n' || character === '\r') {
      commitField()
      rows.push([])
      offset += character === '\r' && text[offset + 1] === '\n' ? 2 : 1
    } else {
      field += character
      offset += 1
    }
  }
  if (quoted) throw new Error('TSV clipboard contains an unterminated quoted field')
  commitField()
  if (rows.length > 1 && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === '') rows.pop()
  return Object.freeze({ source: 'tsv', rows: Object.freeze(rows.map((row) => Object.freeze(row))) })
}

export function serializeTableHtml(matrix: readonly (readonly string[])[]): string {
  const body = matrix.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value).replace(/\r\n?|\n/gu, '<br>')}</td>`).join('')}</tr>`).join('')
  return `<table><tbody>${body}</tbody></table>`
}

export function parseTableHtml(html: string): TableClipboardMatrix | null {
  if (typeof html !== 'string') throw new TypeError('HTML clipboard text must be a string')
  const table = html.match(/<table\b[^>]*>([\s\S]*?)<\/table>/iu)
  if (!table) return null
  const safe = table[1].replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu, '')
  const rows = [...safe.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map((row) =>
    [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/giu)].map((cell) =>
      decodeHtml(cell[1].replace(/<br\s*\/?>/giu, '\n').replace(/<[^>]*>/gu, '')),
    ),
  ).filter((row) => row.length > 0)
  return rows.length === 0
    ? null
    : Object.freeze({ source: 'html', rows: Object.freeze(rows.map((row) => Object.freeze(row))) })
}

export function parseTableClipboard(input: { readonly html?: string; readonly text: string }): TableClipboardMatrix {
  const html = input.html ? parseTableHtml(input.html) : null
  return html ?? parseTableTsv(input.text)
}

