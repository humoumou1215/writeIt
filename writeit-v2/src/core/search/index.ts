export * from './types'
import type { SearchFileResult, SearchMatch, SearchQuery } from './types'

function compileQuery(query: SearchQuery): RegExp {
  if (typeof query.text !== 'string' || query.text.length === 0) throw new TypeError('Search text must be non-empty')
  const flags = query.caseSensitive ? 'g' : 'gi'
  try {
    return new RegExp(query.useRegex ? query.text : query.text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), flags)
  } catch (error) {
    throw new TypeError(`Invalid search pattern: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function searchSource(path: string, source: string, query: SearchQuery): SearchFileResult {
  const matcher = compileQuery(query)
  const matches: SearchMatch[] = []
  let match: RegExpExecArray | null
  while ((match = matcher.exec(source)) !== null) {
    const from = match.index
    const to = from + match[0].length
    const lineStart = source.lastIndexOf('\n', from - 1) + 1
    const line = source.slice(0, from).split('\n').length
    matches.push(Object.freeze({ path, from, to, line, column: from - lineStart + 1, preview: source.slice(lineStart, source.indexOf('\n', from) < 0 ? source.length : source.indexOf('\n', from)).trim() }))
    if (match[0].length === 0) matcher.lastIndex += 1
  }
  return Object.freeze({ path, matches: Object.freeze(matches) })
}

export function searchSources(
  documents: readonly { readonly path: string; readonly markdown: string }[],
  query: SearchQuery,
): readonly SearchFileResult[] {
  return Object.freeze(documents.map((document) => searchSource(document.path, document.markdown, query)).filter((result) => result.matches.length > 0))
}
