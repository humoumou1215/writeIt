import {
  createDocumentId,
  createRevision,
  INITIAL_REVISION,
} from '../document'
import type {
  DocumentId,
  Revision,
} from '../document'
import { createWorkspacePath } from '../workspace'
import type { WorkspacePath } from '../workspace'
import { parseReferences } from './syntax'
import type { ParsedReference } from './syntax'

/**
 * The source-shaped input consumed by the reference index.
 *
 * `markdown` is read once to produce derived facts and is deliberately not
 * retained by the index. Callers may pass a DocumentStore snapshot directly;
 * the optional fields also make the index useful before a document receives a
 * stable application id.
 */
export interface ReferenceDocumentInput {
  readonly id?: DocumentId | string
  readonly path: WorkspacePath | string
  readonly markdown: string
  readonly revision?: Revision | number
}

export interface ReferencePathLocator {
  readonly kind: 'path'
  readonly path: WorkspacePath | string
}

export interface ReferenceIdLocator {
  readonly kind: 'id'
  readonly id: DocumentId | string
}

export type ReferenceSourceLocator =
  | ReferencePathLocator
  | ReferenceIdLocator
  | (WorkspacePath | DocumentId | string)

/** The source metadata and parsed tokens retained as derived facts. */
export interface ReferenceIndexEntry {
  readonly sourceId?: DocumentId
  readonly sourcePath: WorkspacePath
  readonly revision: Revision
  readonly references: readonly ParsedReference[]
}

export type ReferenceIndexChangeType =
  | 'indexed'
  | 'removed'
  | 'rebuilt'
  | 'cleared'

export interface ReferenceIndexChange {
  readonly type: ReferenceIndexChangeType
  readonly generation: number
  readonly entry?: ReferenceIndexEntry
  readonly previous?: ReferenceIndexEntry
  readonly entries?: readonly ReferenceIndexEntry[]
}

export type ReferenceIndexListener = (change: ReferenceIndexChange) => void

export interface ReferenceIndexSnapshot {
  readonly generation: number
  readonly entries: readonly ReferenceIndexEntry[]
}

export class ReferenceIndexValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceIndexValidationError'
  }
}

export class ReferenceIndexConsistencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceIndexConsistencyError'
  }
}

interface NormalizedReferenceDocument {
  readonly sourceId?: DocumentId
  readonly sourcePath: WorkspacePath
  readonly revision: Revision
  readonly references: readonly ParsedReference[]
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReferenceIndexValidationError(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function normalizeDocument(
  input: ReferenceDocumentInput,
): NormalizedReferenceDocument {
  const record = requireRecord(input, 'Reference document')

  if (typeof record.path !== 'string' || record.path.length === 0) {
    throw new ReferenceIndexValidationError(
      'Reference document path must be a non-empty workspace path',
    )
  }

  let sourcePath: WorkspacePath
  try {
    sourcePath = createWorkspacePath(record.path)
  } catch (error) {
    throw new ReferenceIndexValidationError(
      `Reference document path is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  if (sourcePath === '') {
    throw new ReferenceIndexValidationError(
      'Reference document path must identify a file',
    )
  }

  if (typeof record.markdown !== 'string') {
    throw new ReferenceIndexValidationError(
      'Reference document markdown must be a string',
    )
  }

  let sourceId: DocumentId | undefined
  if (record.id !== undefined) {
    if (typeof record.id !== 'string' || record.id.trim().length === 0) {
      throw new ReferenceIndexValidationError(
        'Reference document id must be a non-empty string',
      )
    }
    sourceId = createDocumentId(record.id)
  }

  let revision = INITIAL_REVISION
  if (record.revision !== undefined) {
    if (typeof record.revision !== 'number') {
      throw new ReferenceIndexValidationError(
        'Reference document revision must be a non-negative safe integer',
      )
    }
    try {
      revision = createRevision(record.revision)
    } catch (error) {
      throw new ReferenceIndexValidationError(
        `Reference document revision is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  return {
    ...(sourceId === undefined ? {} : { sourceId }),
    sourcePath,
    revision,
    references: parseReferences(record.markdown),
  }
}

function freezeEntry(input: NormalizedReferenceDocument): ReferenceIndexEntry {
  return Object.freeze({
    ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
    sourcePath: input.sourcePath,
    revision: input.revision,
    references: Object.freeze([...input.references]),
  })
}

function normalizePath(value: unknown, name: string): WorkspacePath {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ReferenceIndexValidationError(`${name} must be a non-empty path`)
  }

  try {
    const path = createWorkspacePath(value)
    if (path === '') {
      throw new ReferenceIndexValidationError(`${name} must identify a file`)
    }
    return path
  } catch (error) {
    if (error instanceof ReferenceIndexValidationError) throw error
    throw new ReferenceIndexValidationError(
      `${name} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function normalizeId(value: unknown, name: string): DocumentId {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ReferenceIndexValidationError(`${name} must be a non-empty id`)
  }
  return createDocumentId(value)
}

function normalizeLocator(
  locator: ReferenceSourceLocator,
): { readonly kind: 'path'; readonly value: WorkspacePath } | {
  readonly kind: 'id'
  readonly value: DocumentId
} {
  if (typeof locator === 'string') {
    // A path is the least surprising interpretation for a bare string. If no
    // path exists, callers can still address an id through the id locator.
    return { kind: 'path', value: normalizePath(locator, 'Reference source path') }
  }

  if (locator === null || typeof locator !== 'object') {
    throw new ReferenceIndexValidationError('Reference source locator is required')
  }

  if (locator.kind === 'path') {
    return {
      kind: 'path',
      value: normalizePath(locator.path, 'Reference source path'),
    }
  }
  if (locator.kind === 'id') {
    return {
      kind: 'id',
      value: normalizeId(locator.id, 'Reference source id'),
    }
  }

  throw new ReferenceIndexValidationError(
    'Reference source locator must identify a path or id',
  )
}

function sortEntries(
  entries: Iterable<ReferenceIndexEntry>,
): readonly ReferenceIndexEntry[] {
  return Object.freeze(
    [...entries].sort((left, right) => {
      const pathOrder = left.sourcePath.localeCompare(right.sourcePath)
      if (pathOrder !== 0) return pathOrder
      return (left.sourceId ?? '').localeCompare(right.sourceId ?? '')
    }),
  )
}

/**
 * Derived, source-backed facts for the references in each indexed document.
 *
 * The index stores parsed tokens, offsets, source path, and source revision. It
 * never stores Markdown itself and never writes to a DocumentStore. A caller
 * can update one document after a Store event or rebuild the complete index
 * from a fresh set of snapshots.
 */
export class ReferenceIndex {
  private readonly byPath = new Map<WorkspacePath, ReferenceIndexEntry>()

  private readonly pathById = new Map<DocumentId, WorkspacePath>()

  private readonly listeners = new Set<ReferenceIndexListener>()

  private generation = 0

  constructor(documents: Iterable<ReferenceDocumentInput> = []) {
    this.rebuild(documents)
  }

  get size(): number {
    return this.byPath.size
  }

  getGeneration(): number {
    return this.generation
  }

  getSnapshot(): ReferenceIndexSnapshot {
    return Object.freeze({
      generation: this.generation,
      entries: sortEntries(this.byPath.values()),
    })
  }

  getAll(): readonly ReferenceIndexEntry[] {
    return this.getSnapshot().entries
  }

  entries(): readonly ReferenceIndexEntry[] {
    return this.getAll()
  }

  get(locator: ReferenceSourceLocator): ReferenceIndexEntry | undefined {
    if (typeof locator === 'string') {
      const path = normalizePath(locator, 'Reference source path')
      return this.byPath.get(path) ?? this.getByIdIfPresent(locator)
    }

    const normalized = normalizeLocator(locator)
    if (normalized.kind === 'path') return this.byPath.get(normalized.value)

    const path = this.pathById.get(normalized.value)
    return path === undefined ? undefined : this.byPath.get(path)
  }

  getByPath(path: WorkspacePath | string): ReferenceIndexEntry | undefined {
    return this.byPath.get(normalizePath(path, 'Reference source path'))
  }

  getById(id: DocumentId | string): ReferenceIndexEntry | undefined {
    const normalized = normalizeId(id, 'Reference source id')
    const path = this.pathById.get(normalized)
    return path === undefined ? undefined : this.byPath.get(path)
  }

  has(locator: ReferenceSourceLocator): boolean {
    return this.get(locator) !== undefined
  }

  /**
   * Parses and atomically replaces one source document's derived facts.
   * Re-indexing the same path keeps its existing id when the caller omits id.
   */
  indexDocument(input: ReferenceDocumentInput): ReferenceIndexEntry {
    const normalized = normalizeDocument(input)
    const byPath = this.byPath.get(normalized.sourcePath)
    const byId =
      normalized.sourceId === undefined
        ? undefined
        : this.getById(normalized.sourceId)

    if (
      byPath?.sourceId !== undefined &&
      normalized.sourceId !== undefined &&
      byPath.sourceId !== normalized.sourceId
    ) {
      throw new ReferenceIndexConsistencyError(
        `Reference path ${normalized.sourcePath} is already indexed by ${byPath.sourceId}`,
      )
    }

    if (
      byId !== undefined &&
      byId.sourcePath !== normalized.sourcePath &&
      byPath !== undefined
    ) {
      throw new ReferenceIndexConsistencyError(
        `Reference id ${normalized.sourceId} conflicts with path ${normalized.sourcePath}`,
      )
    }

    const effectiveId = normalized.sourceId ?? byPath?.sourceId
    const next = freezeEntry({ ...normalized, ...(effectiveId === undefined ? {} : { sourceId: effectiveId }) })

    if (byId !== undefined && byId.sourcePath !== next.sourcePath) {
      this.removePathInternal(byId.sourcePath)
    }
    if (byPath !== undefined && byPath.sourcePath !== next.sourcePath) {
      this.removePathInternal(byPath.sourcePath)
    }

    const previous = this.byPath.get(next.sourcePath)
    if (previous !== undefined) this.removePathInternal(previous.sourcePath)
    this.byPath.set(next.sourcePath, next)
    if (next.sourceId !== undefined) this.pathById.set(next.sourceId, next.sourcePath)

    this.generation++
    this.notify({
      type: 'indexed',
      generation: this.generation,
      entry: next,
      ...(previous === undefined ? {} : { previous }),
    })
    return next
  }

  /** Alias that reads naturally at Store-update call sites. */
  upsert(input: ReferenceDocumentInput): ReferenceIndexEntry {
    return this.indexDocument(input)
  }

  /** Replaces all indexed source facts in one transaction. */
  rebuild(documents: Iterable<ReferenceDocumentInput>): ReferenceIndexSnapshot {
    if (documents === null || documents === undefined || typeof documents[Symbol.iterator] !== 'function') {
      throw new ReferenceIndexValidationError(
        'Reference index rebuild input must be iterable',
      )
    }

    const nextByPath = new Map<WorkspacePath, ReferenceIndexEntry>()
    const nextPathById = new Map<DocumentId, WorkspacePath>()
    for (const document of documents) {
      const normalized = normalizeDocument(document)
      const entry = freezeEntry(normalized)
      if (nextByPath.has(entry.sourcePath)) {
        throw new ReferenceIndexConsistencyError(
          `Reference path ${entry.sourcePath} appears more than once`,
        )
      }
      if (entry.sourceId !== undefined) {
        const existingPath = nextPathById.get(entry.sourceId)
        if (existingPath !== undefined && existingPath !== entry.sourcePath) {
          throw new ReferenceIndexConsistencyError(
            `Reference id ${entry.sourceId} appears more than once`,
          )
        }
        nextPathById.set(entry.sourceId, entry.sourcePath)
      }
      nextByPath.set(entry.sourcePath, entry)
    }

    this.byPath.clear()
    this.pathById.clear()
    for (const [path, entry] of nextByPath) this.byPath.set(path, entry)
    for (const [id, path] of nextPathById) this.pathById.set(id, path)

    this.generation++
    const entries = sortEntries(this.byPath.values())
    this.notify({
      type: 'rebuilt',
      generation: this.generation,
      entries,
    })
    return Object.freeze({ generation: this.generation, entries })
  }

  removeDocument(locator: ReferenceSourceLocator): ReferenceIndexEntry | undefined {
    const normalized = normalizeLocator(locator)
    const path =
      normalized.kind === 'path'
        ? normalized.value
        : this.pathById.get(normalized.value)
    if (path === undefined) return undefined

    const previous = this.byPath.get(path)
    if (previous === undefined) return undefined
    this.removePathInternal(path)
    this.generation++
    this.notify({
      type: 'removed',
      generation: this.generation,
      previous,
    })
    return previous
  }

  remove(locator: ReferenceSourceLocator): ReferenceIndexEntry | undefined {
    return this.removeDocument(locator)
  }

  clear(): void {
    if (this.byPath.size === 0) return
    const entries = sortEntries(this.byPath.values())
    this.byPath.clear()
    this.pathById.clear()
    this.generation++
    this.notify({
      type: 'cleared',
      generation: this.generation,
      entries,
    })
  }

  subscribe(listener: ReferenceIndexListener): () => void {
    if (typeof listener !== 'function') {
      throw new ReferenceIndexValidationError(
        'Reference index listener must be a function',
      )
    }
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  private getByIdIfPresent(value: string): ReferenceIndexEntry | undefined {
    const path = this.pathById.get(value as DocumentId)
    return path === undefined ? undefined : this.byPath.get(path)
  }

  private removePathInternal(path: WorkspacePath): void {
    const previous = this.byPath.get(path)
    if (previous === undefined) return
    this.byPath.delete(path)
    if (previous.sourceId !== undefined) {
      this.pathById.delete(previous.sourceId)
    }
  }

  private notify(change: ReferenceIndexChange): void {
    for (const listener of [...this.listeners]) listener(Object.freeze(change))
  }
}

export function referenceByPath(
  path: WorkspacePath | string,
): ReferencePathLocator {
  return Object.freeze({ kind: 'path', path })
}

export function referenceById(id: DocumentId | string): ReferenceIdLocator {
  return Object.freeze({ kind: 'id', id })
}

export function buildReferenceIndex(
  documents: Iterable<ReferenceDocumentInput>,
): ReferenceIndex {
  return new ReferenceIndex(documents)
}
