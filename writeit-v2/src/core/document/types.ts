declare const documentIdBrand: unique symbol

declare const documentPathBrand: unique symbol

declare const revisionBrand: unique symbol

/** Stable identity for one document during the application's lifetime. */
export type DocumentId = string & {
  readonly [documentIdBrand]: 'DocumentId'
}

/** The path used by the persistence boundary to identify a document. */
export type DocumentPath = string & {
  readonly [documentPathBrand]: 'DocumentPath'
}

/** Monotonic, non-negative document revision. */
export type Revision = number & {
  readonly [revisionBrand]: 'Revision'
}

/** Runtime-discriminated address for an authoritative document by stable id. */
export interface DocumentIdLocator {
  readonly kind: 'id'
  readonly id: DocumentId
}

/** Runtime-discriminated address for an authoritative document by path. */
export interface DocumentPathLocator {
  readonly kind: 'path'
  readonly path: DocumentPath
}

/**
 * Explicit document address. The discriminator is required because branded
 * ids and paths are both strings after TypeScript erasure.
 */
export type DocumentLocator = DocumentIdLocator | DocumentPathLocator

export const INITIAL_REVISION: Revision = 0 as Revision

export interface DocumentSnapshot {
  readonly id: DocumentId
  readonly path: DocumentPath
  readonly markdown: string
  readonly revision: Revision
  readonly persistedRevision: Revision
}

export interface DocumentState extends DocumentSnapshot {
  /** True when the authoritative revision has not been persisted yet. */
  readonly dirty: boolean
}

export interface DocumentSnapshotInput {
  readonly id: DocumentId
  readonly path: DocumentPath
  readonly markdown: string
  readonly revision: Revision
  readonly persistedRevision: Revision
}

function requireNonEmpty(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`)
  }

  return value
}

export function createDocumentId(value: string): DocumentId {
  return requireNonEmpty(value, 'DocumentId') as DocumentId
}

export function createDocumentPath(value: string): DocumentPath {
  return requireNonEmpty(value, 'DocumentPath') as DocumentPath
}

export function isDocumentId(value: unknown): value is DocumentId {
  return typeof value === 'string' && value.trim().length > 0
}

export function isDocumentPath(value: unknown): value is DocumentPath {
  return typeof value === 'string' && value.trim().length > 0
}

export function documentById(id: DocumentId): DocumentIdLocator {
  if (!isDocumentId(id)) {
    throw new TypeError('Document locator id must be a non-empty DocumentId')
  }

  return Object.freeze({ kind: 'id', id })
}

export function documentByPath(path: DocumentPath): DocumentPathLocator {
  if (!isDocumentPath(path)) {
    throw new TypeError('Document locator path must be a non-empty DocumentPath')
  }

  return Object.freeze({ kind: 'path', path })
}

export function isDocumentLocator(value: unknown): value is DocumentLocator {
  if (value === null || typeof value !== 'object') return false

  const candidate = value as {
    readonly kind?: unknown
    readonly id?: unknown
    readonly path?: unknown
  }

  if (candidate.kind === 'id') return isDocumentId(candidate.id)
  if (candidate.kind === 'path') return isDocumentPath(candidate.path)
  return false
}

export function createRevision(value: number): Revision {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Revision must be a non-negative safe integer')
  }

  return value as Revision
}

export function isRevision(value: unknown): value is Revision {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function nextRevision(revision: Revision): Revision {
  return createRevision(revision + 1)
}

export function isDocumentDirty(
  document: Pick<DocumentSnapshot, 'revision' | 'persistedRevision'>,
): boolean {
  return document.revision > document.persistedRevision
}

function validateSnapshotInput(input: DocumentSnapshotInput): void {
  if (!isDocumentId(input.id)) {
    throw new TypeError('DocumentSnapshot.id must be a non-empty DocumentId')
  }
  if (!isDocumentPath(input.path)) {
    throw new TypeError('DocumentSnapshot.path must be a non-empty DocumentPath')
  }
  if (typeof input.markdown !== 'string') {
    throw new TypeError('DocumentSnapshot.markdown must be a string')
  }
  if (!isRevision(input.revision)) {
    throw new TypeError('DocumentSnapshot.revision must be a valid Revision')
  }
  if (!isRevision(input.persistedRevision)) {
    throw new TypeError('DocumentSnapshot.persistedRevision must be a valid Revision')
  }
  if (input.persistedRevision > input.revision) {
    throw new RangeError('persistedRevision cannot be greater than revision')
  }
}

/**
 * Creates a frozen source snapshot. Derived projections must consume this
 * value instead of retaining a mutable reference to document state.
 */
export function createDocumentSnapshot(
  input: DocumentSnapshotInput,
): DocumentSnapshot {
  validateSnapshotInput(input)

  return Object.freeze({
    id: input.id,
    path: input.path,
    markdown: input.markdown,
    revision: input.revision,
    persistedRevision: input.persistedRevision,
  })
}

export function createDocumentState(
  input: DocumentSnapshotInput,
): DocumentState {
  const snapshot = createDocumentSnapshot(input)

  return Object.freeze({
    ...snapshot,
    dirty: isDocumentDirty(snapshot),
  })
}

export function toDocumentSnapshot(state: DocumentState): DocumentSnapshot {
  return createDocumentSnapshot(state)
}
