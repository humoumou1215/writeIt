import type {
  ReferenceHealthFact,
  ReferenceHealthStatus,
} from './health'
import type { WorkspacePath } from '../workspace'

export type ReferenceNavigationAction = 'open' | 'reselect'

export interface ReferenceOpenRequest {
  readonly action: 'open'
  readonly fact: ReferenceHealthFact
  readonly path: WorkspacePath
  readonly fragment: string | null
  readonly fragmentTarget?: ReferenceHealthFact['fragmentTarget']
}

export interface ReferenceReselectRequest {
  readonly action: 'reselect'
  readonly fact: ReferenceHealthFact
  /** The exact token is retained so a picker can replace only this range. */
  readonly raw: string
  readonly path: string
  readonly fragment: string | null
  readonly kind: ReferenceHealthFact['reference']['kind']
  readonly readonly: boolean
}

export type ReferenceNavigationRequest =
  | ReferenceOpenRequest
  | ReferenceReselectRequest

export interface ReferenceNavigationDecision {
  readonly action: ReferenceNavigationAction
  readonly request: ReferenceNavigationRequest
  readonly reason?: ReferenceHealthStatus
}

function requireFact(fact: ReferenceHealthFact): ReferenceHealthFact {
  if (fact === null || typeof fact !== 'object') {
    throw new TypeError('Reference navigation requires a health fact')
  }
  return fact
}

/** True only when the reference has a verified target and fragment state. */
export function isNavigableReference(fact: ReferenceHealthFact): boolean {
  const normalized = requireFact(fact)
  return (
    normalized.status === 'resolved' &&
    normalized.targetPath !== undefined &&
    (normalized.reference.fragment === null ||
      normalized.fragmentStatus === 'resolved' ||
      normalized.fragmentStatus === 'not-requested')
  )
}

/** Builds the callback payload for a healthy reference. */
export function createReferenceOpenRequest(
  fact: ReferenceHealthFact,
): ReferenceOpenRequest {
  const normalized = requireFact(fact)
  if (!isNavigableReference(normalized) || normalized.targetPath === undefined) {
    throw new TypeError('Cannot open a broken reference')
  }
  return Object.freeze({
    action: 'open',
    fact: normalized,
    path: normalized.targetPath,
    fragment: normalized.reference.fragment,
    ...(normalized.fragmentTarget === undefined
      ? {}
      : { fragmentTarget: normalized.fragmentTarget }),
  })
}

/** Builds a source-preserving re-selection payload for a broken reference. */
export function createReferenceReselectRequest(
  fact: ReferenceHealthFact,
): ReferenceReselectRequest {
  const normalized = requireFact(fact)
  return Object.freeze({
    action: 'reselect',
    fact: normalized,
    raw: normalized.raw,
    path: normalized.reference.path,
    fragment: normalized.reference.fragment,
    kind: normalized.reference.kind,
    readonly: normalized.reference.readonly,
  })
}

/** Decides whether a click opens a target or enters broken-reference recovery. */
export function decideReferenceNavigation(
  fact: ReferenceHealthFact,
): ReferenceNavigationDecision {
  const normalized = requireFact(fact)
  if (isNavigableReference(normalized)) {
    return Object.freeze({
      action: 'open',
      request: createReferenceOpenRequest(normalized),
    })
  }
  return Object.freeze({
    action: 'reselect',
    request: createReferenceReselectRequest(normalized),
    ...(normalized.status === 'unknown'
      ? {}
      : { reason: normalized.status }),
  })
}

/** Finds the source reference occupying a CM6/Markdown UTF-16 offset. */
export function findReferenceAtOffset(
  facts: readonly ReferenceHealthFact[],
  offset: number,
): ReferenceHealthFact | undefined {
  if (!Array.isArray(facts)) {
    throw new TypeError('Reference health facts must be an array')
  }
  if (!Number.isSafeInteger(offset) || offset < 0) return undefined

  const matches = facts.filter(
    (fact) => fact.from <= offset && offset < fact.to,
  )
  // A valid parser does not create overlapping references. The shortest range
  // is nevertheless the safest answer if a custom health provider supplies
  // overlapping facts.
  return matches.sort((left, right) =>
    left.to - left.from - (right.to - right.from) || left.from - right.from,
  )[0]
}

/** Alias used by editor adapters that call the operation “hit testing”. */
export const referenceAtOffset = findReferenceAtOffset

/** Returns the destination for a healthy fact, or null for recovery states. */
export function navigationTargetForReference(
  fact: ReferenceHealthFact,
): ReferenceOpenRequest | null {
  return isNavigableReference(fact) ? createReferenceOpenRequest(fact) : null
}

/** Compatibility alias for application navigation callers. */
export const getReferenceNavigationTarget = navigationTargetForReference
