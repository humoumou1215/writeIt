import type { WorkspacePath } from '../workspace'

/** A source location that can be used as a reference fragment target. */
export type ReferenceFragmentKind = 'heading' | 'object'

export interface ReferenceFragmentCandidate {
  readonly kind: ReferenceFragmentKind
  /** Stable object id or the visible heading text. */
  readonly id: string
  readonly label: string
  /** Text used after `#` in a Markdown reference. */
  readonly fragment: string
  /** UTF-16 source range of the target when it is source-backed. */
  readonly from?: number
  readonly to?: number
  readonly line?: number
  readonly level?: number
}

export type ReferenceFragmentResolutionStatus =
  | 'resolved'
  | 'missing'
  | 'ambiguous'
  | 'invalid'

export interface ReferenceFragmentResolution {
  readonly requestedFragment: string
  readonly status: ReferenceFragmentResolutionStatus
  readonly candidates: readonly ReferenceFragmentCandidate[]
  readonly target?: ReferenceFragmentCandidate
  readonly reason?: 'not-found' | 'ambiguous-fragment' | 'invalid-fragment'
}

interface SourceLine {
  readonly text: string
  readonly from: number
  readonly to: number
  readonly line: number
}

interface FenceState {
  readonly character: '`' | '~'
  readonly length: number
}

function requireMarkdown(source: string): string {
  if (typeof source !== 'string') {
    throw new TypeError('Reference fragment source must be a string')
  }
  return source
}

function sourceLines(source: string): readonly SourceLine[] {
  const lines: SourceLine[] = []
  let from = 0
  let line = 1

  while (from <= source.length) {
    const lineFeed = source.indexOf('\n', from)
    const carriageReturn = source.indexOf('\r', from)
    let to = source.length

    if (lineFeed >= 0 && carriageReturn >= 0) {
      to = Math.min(lineFeed, carriageReturn)
    } else if (lineFeed >= 0) {
      to = lineFeed
    } else if (carriageReturn >= 0) {
      to = carriageReturn
    }

    lines.push(Object.freeze({
      text: source.slice(from, to),
      from,
      to,
      line,
    }))
    if (to >= source.length) break

    const separatorLength =
      source[to] === '\r' && source[to + 1] === '\n' ? 2 : 1
    from = to + separatorLength
    line += 1
  }

  return Object.freeze(lines)
}

function fenceMarker(
  line: string,
): { readonly character: '`' | '~'; readonly length: number; readonly rest: string } | undefined {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/u.exec(line)
  if (!match) return undefined
  return Object.freeze({
    character: match[2][0] as '`' | '~',
    length: match[2].length,
    rest: match[3],
  })
}

function atxHeading(line: string): { readonly level: number; readonly text: string } | undefined {
  const match = /^( {0,3})(#{1,6})(?:[ \t]+|$)(.*?)\s*$/u.exec(line)
  if (!match) return undefined

  const text = match[3]
    .replace(/[ \t]+#+[ \t]*$/u, '')
    .trim()
  if (text.length === 0) return undefined
  return Object.freeze({ level: match[2].length, text })
}

function isSetextUnderline(line: string): boolean {
  return /^( {0,3})(?:={2,}|-{2,})[ \t]*$/u.test(line)
}

function isUsableFragment(value: string): boolean {
  return value.length > 0 && !/[\r\n\[\]|]/u.test(value)
}

function normalizeFragmentText(value: string): string {
  return value.normalize('NFKC').trim().replace(/[ \t\r\n]+/gu, ' ')
}

/**
 * Produces a conservative heading slug for references that use the rendered
 * Markdown anchor spelling instead of the literal heading text.
 */
export function slugifyReferenceFragment(value: string): string {
  return normalizeFragmentText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number} _-]/gu, '')
    .replace(/[ _]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
}

/**
 * Extracts ATX and setext headings while skipping fenced code. The returned
 * ranges point into the original source and are therefore safe for navigation
 * projections; no Markdown is serialized or normalized.
 */
export function extractReferenceHeadings(
  source: string,
): readonly ReferenceFragmentCandidate[] {
  const markdown = requireMarkdown(source)
  const lines = sourceLines(markdown)
  const headings: ReferenceFragmentCandidate[] = []
  let fence: FenceState | undefined

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index] as SourceLine
    const marker = fenceMarker(current.text)

    if (fence) {
      if (
        marker &&
        marker.character === fence.character &&
        marker.length >= fence.length &&
        /^\s*$/u.test(marker.rest)
      ) {
        fence = undefined
      }
      continue
    }

    if (marker) {
      fence = { character: marker.character, length: marker.length }
      continue
    }

    const atx = atxHeading(current.text)
    if (atx) {
      headings.push(Object.freeze({
        kind: 'heading',
        id: atx.text,
        label: atx.text,
        fragment: atx.text,
        from: current.from,
        to: current.to,
        line: current.line,
        level: atx.level,
      }))
      continue
    }

    const next = lines[index + 1]
    if (
      next &&
      current.text.trim().length > 0 &&
      isSetextUnderline(next.text) &&
      !current.text.trim().startsWith('|')
    ) {
      const text = current.text.trim()
      if (isUsableFragment(text)) {
        headings.push(Object.freeze({
          kind: 'heading',
          id: text,
          label: text,
          fragment: text,
          from: current.from,
          to: next.to,
          line: current.line,
          level: next.text.trim().startsWith('=') ? 1 : 2,
        }))
      }
      index += 1
    }
  }

  return Object.freeze(headings)
}

function candidateMatches(
  candidate: ReferenceFragmentCandidate,
  requested: string,
): boolean {
  const normalizedCandidate = normalizeFragmentText(candidate.fragment)
  const normalizedRequested = normalizeFragmentText(requested)
  return (
    normalizedCandidate === normalizedRequested ||
    slugifyReferenceFragment(normalizedCandidate) ===
      slugifyReferenceFragment(normalizedRequested)
  )
}

function freezeResolution(
  input: ReferenceFragmentResolution,
): ReferenceFragmentResolution {
  return Object.freeze({
    ...input,
    candidates: Object.freeze([...input.candidates]),
  })
}

/** Resolves one fragment against source-backed headings and object facts. */
export function resolveReferenceFragment(
  source: string,
  requestedFragment: string,
  objects: readonly ReferenceFragmentCandidate[] = [],
): ReferenceFragmentResolution {
  requireMarkdown(source)
  if (typeof requestedFragment !== 'string' || requestedFragment.trim().length === 0) {
    return freezeResolution({
      requestedFragment,
      status: 'invalid',
      candidates: [],
      reason: 'invalid-fragment',
    })
  }
  if (!isUsableFragment(requestedFragment)) {
    return freezeResolution({
      requestedFragment,
      status: 'invalid',
      candidates: [],
      reason: 'invalid-fragment',
    })
  }

  const normalizedObjects = objects.filter(
    (candidate) =>
      candidate.kind === 'object' &&
      typeof candidate.fragment === 'string' &&
      isUsableFragment(candidate.fragment),
  )
  const objectMatches = normalizedObjects.filter((candidate) =>
    candidateMatches(candidate, requestedFragment),
  )
  if (objectMatches.length === 1) {
    return freezeResolution({
      requestedFragment,
      status: 'resolved',
      candidates: objectMatches,
      target: objectMatches[0],
    })
  }
  if (objectMatches.length > 1) {
    return freezeResolution({
      requestedFragment,
      status: 'ambiguous',
      candidates: objectMatches,
      reason: 'ambiguous-fragment',
    })
  }

  const headingMatches = extractReferenceHeadings(source).filter((candidate) =>
    candidateMatches(candidate, requestedFragment),
  )
  if (headingMatches.length === 1) {
    return freezeResolution({
      requestedFragment,
      status: 'resolved',
      candidates: headingMatches,
      target: headingMatches[0],
    })
  }
  if (headingMatches.length > 1) {
    return freezeResolution({
      requestedFragment,
      status: 'ambiguous',
      candidates: headingMatches,
      reason: 'ambiguous-fragment',
    })
  }

  return freezeResolution({
    requestedFragment,
    status: 'missing',
    candidates: [],
    reason: 'not-found',
  })
}

/** Returns the first source position that should receive a navigation jump. */
export function findReferenceFragmentPosition(
  source: string,
  requestedFragment: string,
): number | undefined {
  const resolution = resolveReferenceFragment(source, requestedFragment)
  if (resolution.status === 'resolved') return resolution.target?.from

  // Object fragments may not have a source range. A conservative textual
  // fallback still gives application shells a useful jump without inventing a
  // second source model.
  if (typeof requestedFragment !== 'string') return undefined
  const exact = source.indexOf(requestedFragment)
  return exact < 0 ? undefined : exact
}

/** Creates an object candidate for a provider that only knows an id/label. */
export function createReferenceObjectCandidate(input: {
  readonly id: string
  readonly label: string
  readonly fragment?: string | null
  readonly from?: number
  readonly to?: number
}): ReferenceFragmentCandidate {
  if (
    input === null ||
    typeof input !== 'object' ||
    typeof input.id !== 'string' ||
    input.id.trim().length === 0 ||
    typeof input.label !== 'string' ||
    input.label.trim().length === 0
  ) {
    throw new TypeError('Reference object candidate must have an id and label')
  }
  const fragment = input.fragment ?? input.id
  if (typeof fragment !== 'string' || !isUsableFragment(fragment)) {
    throw new TypeError('Reference object candidate fragment must be valid')
  }
  return Object.freeze({
    kind: 'object',
    id: input.id.trim(),
    label: input.label.trim(),
    fragment: fragment.trim(),
    ...(input.from === undefined ? {} : { from: input.from }),
    ...(input.to === undefined ? {} : { to: input.to }),
  })
}

/** Keeps the type useful to callers that carry a source path with a target. */
export interface ReferenceFragmentTarget extends ReferenceFragmentCandidate {
  readonly path?: WorkspacePath
}
