import type { ChangeSet } from '@codemirror/state'
import {
  applySourceChangeSet,
  createSourceChangeSetFromChanges,
  type SourceChangeSet,
} from '../../../core/document/source-change'

/**
 * The source text that CM6 edits and the authoritative Markdown are allowed to
 * use different newline encodings. CM6's default Text parser folds CRLF/CR
 * into LF, so the projection keeps an explicit boundary map back to the
 * source instead of treating `Text.toString()` as the persistent payload.
 */
export interface MarkdownSourceProjection {
  readonly source: string
  readonly projected: string
  /** For every projected boundary, the corresponding source boundary. */
  readonly projectedToSource: readonly number[]
}

function requirePosition(position: number, length: number, name: string): void {
  if (!Number.isSafeInteger(position) || position < 0 || position > length) {
    throw new RangeError(`${name} must be between 0 and ${length}`)
  }
}

/**
 * Builds the LF-normalized CM6 text and an explicit offset map for CRLF, CR,
 * LF, and mixed-line-ending source. Positions are UTF-16 offsets, matching
 * CodeMirror and JavaScript string offsets.
 */
export function projectMarkdownSource(
  source: string,
): MarkdownSourceProjection {
  if (typeof source !== 'string') {
    throw new TypeError('Markdown source must be a string')
  }

  const projectedParts: string[] = []
  const projectedToSource = [0]
  let sourceOffset = 0

  while (sourceOffset < source.length) {
    const character = source[sourceOffset]
    if (character === '\r') {
      sourceOffset += source[sourceOffset + 1] === '\n' ? 2 : 1
      projectedParts.push('\n')
      projectedToSource.push(sourceOffset)
      continue
    }

    sourceOffset += 1
    projectedParts.push(character)
    projectedToSource.push(sourceOffset)
  }

  return Object.freeze({
    source,
    projected: projectedParts.join(''),
    projectedToSource: Object.freeze(projectedToSource),
  })
}

export function sourceOffsetForProjectedPosition(
  projection: MarkdownSourceProjection,
  position: number,
): number {
  requirePosition(position, projection.projected.length, 'Projected position')
  return projection.projectedToSource[position] as number
}

function projectedPositionForSourceOffset(
  projection: MarkdownSourceProjection,
  position: number,
): number | undefined {
  requirePosition(position, projection.source.length, 'Source position')
  let low = 0
  let high = projection.projectedToSource.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const sourcePosition = projection.projectedToSource[middle] as number
    if (sourcePosition === position) return middle
    if (sourcePosition < position) low = middle + 1
    else high = middle - 1
  }
  // Positions inside a CRLF boundary have no one-to-one CM6 boundary. The
  // caller can fall back to a projected diff, which becomes a no-op when only
  // the source line-ending encoding changed.
  return undefined
}

/**
 * Maps an authoritative source delta to normalized projection coordinates.
 * It returns undefined when a source edit crosses a collapsed line-ending
 * boundary or otherwise cannot be represented without guessing.
 */
export function projectSourceChangeToProjection(
  previous: MarkdownSourceProjection,
  next: MarkdownSourceProjection,
  change: SourceChangeSet,
): SourceChangeSet | undefined {
  if (
    change.sourceLength !== previous.source.length ||
    change.targetLength !== next.source.length
  ) {
    return undefined
  }

  const projectedChanges: Array<{
    readonly from: number
    readonly to: number
    readonly insert: string
  }> = []
  for (const sourceChange of change.changes) {
    const from = projectedPositionForSourceOffset(previous, sourceChange.from)
    const to = projectedPositionForSourceOffset(previous, sourceChange.to)
    if (from === undefined || to === undefined) return undefined
    projectedChanges.push({
      from,
      to,
      insert: projectMarkdownSource(sourceChange.inserted).projected,
    })
  }

  try {
    const projectedChange = createSourceChangeSetFromChanges(
      previous.projected,
      projectedChanges,
    )
    return applySourceChangeSet(previous.projected, projectedChange) ===
      next.projected
      ? projectedChange
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Applies a CM6 ChangeSet to authoritative source without rewriting any
 * untouched source region. Change positions are in the old projected text;
 * replacement text is already CM6-normalized and is intentionally inserted as
 * such. Existing separators outside the edited ranges remain byte-for-byte
 * unchanged.
 */
export function projectedChangesToSourceChangeSet(
  projection: MarkdownSourceProjection,
  changes: ChangeSet,
): SourceChangeSet {
  if (changes.length !== projection.projected.length) {
    throw new Error(
      `Projected ChangeSet length ${changes.length} does not match projection length ${projection.projected.length}`,
    )
  }

  const sourceChanges: Array<{
    readonly from: number
    readonly to: number
    readonly insert: string
  }> = []
  let previousSourceTo = 0

  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const sourceFrom = sourceOffsetForProjectedPosition(projection, fromA)
    const sourceTo = sourceOffsetForProjectedPosition(projection, toA)
    if (sourceFrom < previousSourceTo || sourceTo < sourceFrom) {
      throw new Error('Projected changes are not ordered or overlap')
    }

    sourceChanges.push({
      from: sourceFrom,
      to: sourceTo,
      insert: inserted.toString(),
    })
    previousSourceTo = sourceTo
  })

  return createSourceChangeSetFromChanges(projection.source, sourceChanges)
}

export function applyProjectedChangesToSource(
  projection: MarkdownSourceProjection,
  changes: ChangeSet,
): string {
  return applySourceChangeSet(
    projection.source,
    projectedChangesToSourceChangeSet(projection, changes),
  )
}

/**
 * Maps a full projected-source replacement to authoritative source. Popup
 * providers currently submit a complete projected document, so use its one
 * changed span to retain all source separators outside that span.
 */
export function applyProjectedMarkdownToSource(
  projection: MarkdownSourceProjection,
  projectedMarkdown: string,
): string {
  if (typeof projectedMarkdown !== 'string') {
    throw new TypeError('Projected Markdown must be a string')
  }
  if (projectedMarkdown === projection.projected) return projection.source

  let prefix = 0
  const commonPrefixLength = Math.min(
    projection.projected.length,
    projectedMarkdown.length,
  )
  while (
    prefix < commonPrefixLength &&
    projection.projected.charCodeAt(prefix) ===
      projectedMarkdown.charCodeAt(prefix)
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < projection.projected.length - prefix &&
    suffix < projectedMarkdown.length - prefix &&
    projection.projected.charCodeAt(projection.projected.length - suffix - 1) ===
      projectedMarkdown.charCodeAt(projectedMarkdown.length - suffix - 1)
  ) {
    suffix += 1
  }

  const sourceFrom = sourceOffsetForProjectedPosition(projection, prefix)
  const sourceTo = sourceOffsetForProjectedPosition(
    projection,
    projection.projected.length - suffix,
  )
  const replacement = projectedMarkdown.slice(
    prefix,
    projectedMarkdown.length - suffix,
  )

  return (
    projection.source.slice(0, sourceFrom) +
    replacement +
    projection.source.slice(sourceTo)
  )
}
