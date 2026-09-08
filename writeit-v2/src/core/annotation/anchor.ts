import type {
  AnchorResolution,
  RangeAnchor,
} from './types'

const CONTEXT_LENGTH = 48

function requireSource(source: string): void {
  if (typeof source !== 'string') throw new TypeError('Annotation source must be a string')
}

function requirePosition(value: number, length: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > length) {
    throw new RangeError(`${name} must be between 0 and ${length}`)
  }
}

function codeBlockIdentityAt(source: string, offset: number): string | undefined {
  const lines = source.split(/\r?\n/u)
  let cursor = 0
  let open: { marker: string; info: string; line: number } | undefined
  for (let line = 0; line < lines.length; line += 1) {
    const value = lines[line]
    const fence = value.match(/^\s*(`{3,}|~{3,})([^\n]*)$/u)
    const lineEnd = cursor + value.length
    if (fence) {
      if (!open) open = { marker: fence[1][0], info: fence[2].trim().toLowerCase(), line }
      else if (fence[1][0] === open.marker) open = undefined
    } else if (open && offset >= cursor && offset <= lineEnd) {
      return `${open.marker}:${open.info}:${open.line}`
    }
    cursor = lineEnd + 1
  }
  return undefined
}

export function createRangeAnchor(
  source: string,
  documentPath: string,
  from: number,
  to: number,
): RangeAnchor {
  requireSource(source)
  if (typeof documentPath !== 'string' || documentPath.trim() === '') throw new TypeError('Annotation documentPath is required')
  requirePosition(from, source.length, 'Annotation anchor.from')
  requirePosition(to, source.length, 'Annotation anchor.to')
  if (to <= from) throw new RangeError('Annotation anchor must contain text')
  const selectedText = source.slice(from, to)
  return Object.freeze({
    documentPath,
    from,
    to,
    selectedText,
    beforeContext: source.slice(Math.max(0, from - CONTEXT_LENGTH), from),
    afterContext: source.slice(to, Math.min(source.length, to + CONTEXT_LENGTH)),
    ...(codeBlockIdentityAt(source, from) === codeBlockIdentityAt(source, to - 1)
      && codeBlockIdentityAt(source, from) !== undefined
      ? { codeBlockIdentity: codeBlockIdentityAt(source, from) }
      : {}),
  })
}

function occurrenceOffsets(source: string, needle: string): number[] {
  const offsets: number[] = []
  if (needle.length === 0) return offsets
  let offset = 0
  while (offset <= source.length - needle.length) {
    const found = source.indexOf(needle, offset)
    if (found < 0) break
    offsets.push(found)
    offset = found + 1
  }
  return offsets
}

export function resolveRangeAnchor(anchor: RangeAnchor, source: string): AnchorResolution {
  requireSource(source)
  if (
    !Number.isSafeInteger(anchor.from) ||
    !Number.isSafeInteger(anchor.to) ||
    anchor.from < 0 || anchor.to <= anchor.from
  ) return Object.freeze({ status: 'unresolved', reason: 'invalid-range' })

  const matches = occurrenceOffsets(source, anchor.selectedText)
  if (matches.length === 1) {
    const from = matches[0]
    if (anchor.codeBlockIdentity !== undefined && codeBlockIdentityAt(source, from) !== anchor.codeBlockIdentity) {
      return Object.freeze({ status: 'unresolved', reason: 'code-block-changed' })
    }
    return Object.freeze({ status: 'resolved', from, to: from + anchor.selectedText.length, text: anchor.selectedText })
  }
  const contextual = matches.filter((from) => {
    const to = from + anchor.selectedText.length
    if (anchor.codeBlockIdentity !== undefined && codeBlockIdentityAt(source, from) !== anchor.codeBlockIdentity) return false
    const before = source.slice(Math.max(0, from - anchor.beforeContext.length), from)
    const after = source.slice(to, Math.min(source.length, to + anchor.afterContext.length))
    return (
      (anchor.beforeContext.length === 0 || before.endsWith(anchor.beforeContext)) &&
      (anchor.afterContext.length === 0 || after.startsWith(anchor.afterContext))
    )
  })
  if (contextual.length === 1) {
    const from = contextual[0]
    return Object.freeze({ status: 'resolved', from, to: from + anchor.selectedText.length, text: anchor.selectedText })
  }
  if (matches.length === 0) return Object.freeze({ status: 'unresolved', reason: 'deleted' })
  if (contextual.length > 1 || matches.length > 1) return Object.freeze({ status: 'unresolved', reason: 'ambiguous' })
  if (anchor.codeBlockIdentity !== undefined) return Object.freeze({ status: 'unresolved', reason: 'code-block-changed' })
  return Object.freeze({ status: 'unresolved', reason: 'context-mismatch' })
}

export function mapRangeAnchorThroughChange(
  anchor: RangeAnchor,
  nextSource: string,
  changes: readonly { from: number; to: number; inserted: string }[],
): AnchorResolution {
  let from = anchor.from
  let to = anchor.to
  let overlapped = false
  let delta = 0
  for (const change of changes) {
    const removed = change.to - change.from
    if (change.to <= from) {
      delta += change.inserted.length - removed
      continue
    }
    if (change.from >= to) break
    overlapped = true
  }
  if (!overlapped) {
    from += delta
    to += delta
    const shifted = { ...anchor, from, to }
    return resolveRangeAnchor(shifted, nextSource)
  }
  return resolveRangeAnchor(anchor, nextSource)
}
