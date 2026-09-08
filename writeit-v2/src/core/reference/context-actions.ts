import type { ParsedReference } from './syntax'
import { stringifyReference } from './syntax'

/**
 * The three reference forms that can be selected from a context menu.
 * `embed-readonly` is the descriptive application spelling; `embed-ro` is
 * accepted as an input alias for clipboard/editor adapters.
 */
export type ReferenceContextActionMode =
  | 'link'
  | 'embed'
  | 'embed-readonly'

export type ReferenceContextActionModeInput =
  | ReferenceContextActionMode
  | 'embed-ro'

export interface ReferenceContextOpenRequest {
  readonly action: 'open'
  /** The exact source token that was hit. */
  readonly raw: string
  /** Resolved target path when an application resolver supplied one. */
  readonly path: string
  readonly fragment: string | null
  readonly kind: ParsedReference['kind']
  readonly readonly: boolean
  readonly reference: ParsedReference
}

export interface ReferenceContextModeEdit {
  readonly action: 'set-mode'
  readonly mode: ReferenceContextActionMode
  readonly from: number
  readonly to: number
  readonly insert: string
  readonly cursorOffset: number
  readonly reference: ParsedReference
}

export interface ReferenceContextEditOptions {
  /** The LF-normalized source currently displayed by CM6. */
  readonly source: string
  readonly reference: ParsedReference
  readonly mode: ReferenceContextActionModeInput
  /** Optional explicit range for callers that keep a separate hit-test fact. */
  readonly from?: number
  readonly to?: number
}

function requireReference(reference: unknown): ParsedReference {
  if (reference === null || typeof reference !== 'object') {
    throw new TypeError('Reference context action requires a parsed reference')
  }
  const candidate = reference as Partial<ParsedReference>
  const from = candidate.from
  const to = candidate.to
  if (
    (candidate.kind !== 'link' && candidate.kind !== 'embed') ||
    typeof candidate.path !== 'string' ||
    typeof candidate.raw !== 'string' ||
    typeof from !== 'number' ||
    typeof to !== 'number' ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from
  ) {
    throw new TypeError('Reference context action received an invalid reference')
  }
  return reference as ParsedReference
}

function requireSource(source: unknown): string {
  if (typeof source !== 'string') {
    throw new TypeError('Reference context action source must be a string')
  }
  return source
}

/** Converts the compatibility `embed-ro` spelling to the canonical mode. */
export function normalizeReferenceContextMode(
  mode: ReferenceContextActionModeInput,
): ReferenceContextActionMode {
  if (mode === 'embed-ro') return 'embed-readonly'
  if (mode === 'link' || mode === 'embed' || mode === 'embed-readonly') {
    return mode
  }
  throw new TypeError(`Unknown reference context mode: ${String(mode)}`)
}

/** Returns the menu mode represented by an existing source token. */
export function referenceContextModeFor(
  reference: ParsedReference,
): ReferenceContextActionMode {
  const normalized = requireReference(reference)
  if (normalized.kind === 'link') return 'link'
  return normalized.readonly ? 'embed-readonly' : 'embed'
}

/** Compatibility alias for callers that use the shorter “mode” wording. */
export const referenceModeFor = referenceContextModeFor

/**
 * Returns the exact syntax to put on the text clipboard. Keeping `raw`
 * preserves fragments, embed kind, readonly mode, and the user's spelling;
 * this action never normalizes or reparses the surrounding Markdown.
 */
export function referenceContextSyntax(
  reference: ParsedReference,
): string {
  const normalized = requireReference(reference)
  return normalized.raw
}

export const copyReferenceSyntax = referenceContextSyntax

/** Builds an open request without changing the source token. */
export function createReferenceContextOpenRequest(
  reference: ParsedReference,
  targetPath?: string,
): ReferenceContextOpenRequest {
  const normalized = requireReference(reference)
  if (targetPath !== undefined && typeof targetPath !== 'string') {
    throw new TypeError('Reference context target path must be a string')
  }
  const path = targetPath ?? normalized.path
  if (path.length === 0) {
    throw new TypeError('Reference context target path must be non-empty')
  }
  return Object.freeze({
    action: 'open',
    raw: normalized.raw,
    path,
    fragment: normalized.fragment,
    kind: normalized.kind,
    readonly: normalized.readonly,
    reference: normalized,
  })
}

/**
 * Creates a minimal source edit that changes only the selected reference
 * token's mode. Unchanged modes return `undefined`, so a context-menu click
 * cannot create a spurious DocumentStore revision.
 */
export function createReferenceContextEdit(
  options: ReferenceContextEditOptions,
): ReferenceContextModeEdit | undefined {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('Reference context edit options are required')
  }
  const source = requireSource(options.source)
  const reference = requireReference(options.reference)
  const mode = normalizeReferenceContextMode(options.mode)
  const from = options.from ?? reference.from
  const to = options.to ?? reference.to
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to > source.length
  ) {
    throw new RangeError('Reference context edit range must be inside the source')
  }
  if (source.slice(from, to) !== reference.raw) {
    throw new Error('Reference context edit no longer matches the source token')
  }
  if (mode === referenceContextModeFor(reference)) return undefined

  const insert = stringifyReference({
    kind: mode === 'link' ? 'link' : 'embed',
    path: reference.path,
    fragment: reference.fragment,
    readonly: mode === 'embed-readonly',
  })
  return Object.freeze({
    action: 'set-mode',
    mode,
    from,
    to,
    insert,
    cursorOffset: insert.length,
    reference,
  })
}

/** Descriptive alias for editor adapters that call this operation a conversion. */
export const createReferenceModeEdit = createReferenceContextEdit