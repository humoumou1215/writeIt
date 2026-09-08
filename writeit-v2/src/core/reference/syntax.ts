/**
 * Markdown reference syntax understood by WriteIt v2.
 *
 * The parser is deliberately source-backed: it reports offsets and the exact
 * token text, but it never rewrites Markdown or serializes a parsed document.
 * Later projections (completion, navigation, embeds) can therefore consume
 * these facts without creating another source authority.
 */

export type ReferenceKind = 'link' | 'embed'

export const REFERENCE_READONLY_SUFFIX = '|ro'

export interface ParsedReference {
  /** `link` is `[[...]]`; `embed` is `![ [... ] ]` without the spaces. */
  readonly kind: ReferenceKind
  /** Path as written inside the token, before workspace resolution. */
  readonly path: string
  /** Heading/object fragment after `#`, when present. */
  readonly fragment: string | null
  /** `true` only for an embed using the `|ro` suffix. */
  readonly readonly: boolean
  /** Exact source token, including `!`, brackets and `|ro`. */
  readonly raw: string
  /** UTF-16 source offset of the first `[` or `!` for an embed. */
  readonly from: number
  /** Exclusive UTF-16 source offset of the complete token. */
  readonly to: number
}

export interface ReferenceSyntaxInput {
  readonly kind: ReferenceKind
  readonly path: string
  readonly fragment?: string | null
  readonly readonly?: boolean
}

export class ReferenceSyntaxError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceSyntaxError'
  }
}

function requireSource(source: string): void {
  if (typeof source !== 'string') {
    throw new TypeError('Reference source must be a string')
  }
}

function requireOffset(source: string, offset: number): number {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > source.length
  ) {
    throw new RangeError('Reference source offset must be inside the source')
  }
  return offset
}

function isEscaped(source: string, offset: number): boolean {
  let slashCount = 0
  for (let index = offset - 1; index >= 0 && source[index] === '\\'; index--) {
    slashCount++
  }
  return slashCount % 2 === 1
}

function isValidPart(value: string): boolean {
  if (value.length === 0 || value.trim().length === 0) return false
  if (/[\r\n\[\]]/u.test(value)) return false
  // `|` is reserved for the readonly embed suffix and is not part of either
  // a path or a fragment in the supported grammar.
  if (value.includes('|')) return false
  return true
}

function parseBody(
  body: string,
  kind: ReferenceKind,
): { readonly path: string; readonly fragment: string | null; readonly readonly: boolean } | undefined {
  if (/[\r\n\[\]]/u.test(body)) return undefined

  let value = body
  let readonly = false
  if (kind === 'embed' && value.endsWith(REFERENCE_READONLY_SUFFIX)) {
    readonly = true
    value = value.slice(0, -REFERENCE_READONLY_SUFFIX.length)
  }

  // A pipe is reserved for the readonly embed marker. Unsupported aliases or
  // display labels remain ordinary Markdown instead of being partially parsed.
  if (value.includes('|')) return undefined

  const separator = value.indexOf('#')
  const path = separator < 0 ? value : value.slice(0, separator)
  const fragment = separator < 0 ? null : value.slice(separator + 1)

  if (!isValidPart(path)) return undefined
  if (fragment !== null && !isValidPart(fragment)) return undefined

  return Object.freeze({ path, fragment, readonly })
}

/**
 * Parses one complete reference whose opener starts at `from`.
 *
 * Returns `undefined` for an incomplete, escaped or unsupported token. This
 * makes malformed/unknown Markdown safe to leave untouched in the source.
 */
export function parseReferenceAt(
  source: string,
  from: number,
): ParsedReference | undefined {
  requireSource(source)
  const offset = requireOffset(source, from)

  let kind: ReferenceKind
  let bodyStart: number
  if (source.startsWith('![[', offset)) {
    if (isEscaped(source, offset)) return undefined
    kind = 'embed'
    bodyStart = offset + 3
  } else if (source.startsWith('[[', offset)) {
    // The `[[` in `![[...]]` belongs to the longer embed token. The embed
    // marker itself may be escaped, but in either case this must not become a
    // second link reference.
    if (source[offset - 1] === '!') return undefined
    if (isEscaped(source, offset)) return undefined
    kind = 'link'
    bodyStart = offset + 2
  } else {
    return undefined
  }

  const close = source.indexOf(']]', bodyStart)
  if (close < 0) return undefined
  const parsed = parseBody(source.slice(bodyStart, close), kind)
  if (!parsed) return undefined

  return Object.freeze({
    kind,
    path: parsed.path,
    fragment: parsed.fragment,
    readonly: parsed.readonly,
    raw: source.slice(offset, close + 2),
    from: offset,
    to: close + 2,
  })
}

interface FenceState {
  readonly character: '`' | '~'
  readonly length: number
}

interface FenceMarker {
  readonly character: '`' | '~'
  readonly length: number
  readonly closing: boolean
}

function lineEnd(source: string, from: number): number {
  const lineFeed = source.indexOf('\n', from)
  const carriageReturn = source.indexOf('\r', from)
  if (lineFeed < 0) return carriageReturn < 0 ? source.length : carriageReturn
  if (carriageReturn < 0) return lineFeed
  return Math.min(lineFeed, carriageReturn)
}

function fenceMarkerAt(
  source: string,
  from: number,
  current: FenceState | undefined,
): FenceMarker | undefined {
  const end = lineEnd(source, from)
  const line = source.slice(from, end)
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/u.exec(line)
  if (!match) return undefined

  const marker = match[2]
  const character = marker[0] as '`' | '~'
  if (current && character !== current.character) return undefined

  const closing = current !== undefined
  if (closing && !/^\s*$/u.test(match[3])) return undefined
  return { character, length: marker.length, closing }
}

function skipLine(source: string, from: number): number {
  const end = lineEnd(source, from)
  if (end >= source.length) return end
  if (source[end] === '\r' && source[end + 1] === '\n') return end + 2
  return end + 1
}

function skipInlineCode(source: string, from: number): number {
  let length = 1
  while (source[from + length] === '`') length++
  const marker = '`'.repeat(length)
  const close = source.indexOf(marker, from + length)
  return close < 0 ? source.length : close + length
}

/**
 * Finds all supported references outside fenced and inline code.
 *
 * This is intentionally a small Markdown lexical boundary, not a Markdown
 * parser. It prevents the common false positives in code examples while
 * leaving every unrecognised construct byte-for-byte untouched.
 */
export function parseReferences(source: string): readonly ParsedReference[] {
  requireSource(source)
  const references: ParsedReference[] = []
  let index = 0
  let fence: FenceState | undefined

  while (index < source.length) {
    const atLineStart =
      index === 0 || source[index - 1] === '\n' || source[index - 1] === '\r'
    if (atLineStart) {
      const marker = fenceMarkerAt(source, index, fence)
      if (fence) {
        if (
          marker &&
          marker.closing &&
          marker.character === fence.character &&
          marker.length >= fence.length
        ) {
          fence = undefined
        }
        index = skipLine(source, index)
        continue
      }
      if (marker && !marker.closing) {
        fence = { character: marker.character, length: marker.length }
        index = skipLine(source, index)
        continue
      }
    }

    if (source[index] === '`') {
      index = skipInlineCode(source, index)
      continue
    }

    const candidate =
      source[index] === '!' || source[index] === '['
        ? parseReferenceAt(source, index)
        : undefined
    if (candidate) {
      references.push(candidate)
      index = candidate.to
    } else {
      index++
    }
  }

  return Object.freeze(references)
}

function validateStringPart(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    !isValidPart(value) ||
    (name === 'Reference path' && value.includes('#'))
  ) {
    throw new ReferenceSyntaxError(`${name} must be non-empty and valid`)
  }
  return value
}

/** Formats a newly-created reference without parsing or normalizing source. */
export function stringifyReference(input: ReferenceSyntaxInput): string {
  if (input === null || typeof input !== 'object') {
    throw new ReferenceSyntaxError('Reference syntax input must be an object')
  }
  if (input.kind !== 'link' && input.kind !== 'embed') {
    throw new ReferenceSyntaxError('Reference kind must be link or embed')
  }

  const path = validateStringPart(input.path, 'Reference path')
  const fragment = input.fragment ?? null
  if (fragment !== null) validateStringPart(fragment, 'Reference fragment')

  if (input.readonly !== undefined && typeof input.readonly !== 'boolean') {
    throw new ReferenceSyntaxError('Reference readonly must be a boolean')
  }
  const readonly = input.readonly ?? false
  if (typeof readonly !== 'boolean') {
    throw new ReferenceSyntaxError('Reference readonly must be a boolean')
  }
  if (input.kind === 'link' && readonly) {
    throw new ReferenceSyntaxError('Only an embed reference can be readonly')
  }

  const target = `${path}${fragment === null ? '' : `#${fragment}`}`
  return input.kind === 'embed'
    ? `![[${target}${readonly ? REFERENCE_READONLY_SUFFIX : ''}]]`
    : `[[${target}]]`
}

/** Compatibility-oriented descriptive alias for callers that prefer “format”. */
export const formatReference = stringifyReference