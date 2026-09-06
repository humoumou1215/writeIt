import { EventTimeline } from './timeline'
import type {
  DocumentTimelineEvent,
  ProjectionId,
  TimelineListener,
  TimelineUnsubscribe,
} from './timeline'
import {
  INITIAL_REVISION,
  createDocumentState,
  documentById,
  isDocumentId,
  isDocumentLocator,
  isDocumentPath,
  isRevision,
  nextRevision,
} from './types'
import type {
  DocumentId,
  DocumentLocator,
  DocumentPath,
  DocumentState,
  Revision,
} from './types'

export interface DocumentOrigin {
  readonly kind: string
  readonly source?: string
}

export interface DocumentLoadInput {
  readonly id: DocumentId
  readonly path: DocumentPath
  readonly markdown: string
}

export interface DocumentChangeInput {
  readonly markdown: string
  readonly origin: DocumentOrigin
  readonly expectedRevision?: Revision
}

/**
 * One source-level edit retained for a document's undo/redo history.
 *
 * History stores immutable source snapshots for reversal; it is not a second
 * live document authority. The current Markdown remains owned by
 * `DocumentStore`.
 */
export interface DocumentHistoryEntry {
  readonly before: string
  readonly after: string
  readonly origin: DocumentOrigin
}

export interface DocumentHistorySnapshot {
  readonly undo: readonly DocumentHistoryEntry[]
  readonly redo: readonly DocumentHistoryEntry[]
}

interface MutableDocumentHistory {
  readonly undo: DocumentHistoryEntry[]
  readonly redo: DocumentHistoryEntry[]
}

interface ProjectionRecord {
  readonly id: ProjectionId
  revision: Revision
  stale: boolean
}

interface DocumentSubscription {
  readonly projectionId: ProjectionId
  readonly listener: DocumentStoreListener
}

export interface DocumentChangedEvent {
  readonly type: 'changed'
  readonly previous: DocumentState
  readonly document: DocumentState
  readonly origin: DocumentOrigin
}

export interface DocumentPersistedEvent {
  readonly type: 'persisted'
  readonly previous: DocumentState
  readonly document: DocumentState
  readonly origin: DocumentOrigin
}

export type DocumentStoreEvent = DocumentChangedEvent | DocumentPersistedEvent
export type DocumentStoreListener = (event: DocumentStoreEvent) => void
export type Unsubscribe = () => void

export class DocumentNotFoundError extends Error {
  readonly locator: DocumentLocator

  constructor(locator: DocumentLocator) {
    const description =
      locator.kind === 'id'
        ? `id ${locator.id}`
        : `path ${locator.path}`
    super(`Document not found by ${description}`)
    this.name = 'DocumentNotFoundError'
    this.locator = locator
  }
}

export class DocumentIdentityConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentIdentityConflictError'
  }
}

export class DocumentRevisionConflictError extends Error {
  constructor(expected: Revision, actual: Revision) {
    super(`Document revision conflict: expected ${expected}, actual ${actual}`)
    this.name = 'DocumentRevisionConflictError'
  }
}

export class ProjectionIdentityConflictError extends Error {
  constructor(documentId: DocumentId, projectionId: ProjectionId) {
    super(`Projection ${projectionId} is already attached to document ${documentId}`)
    this.name = 'ProjectionIdentityConflictError'
  }
}

export class ProjectionNotFoundError extends Error {
  constructor(documentId: DocumentId, projectionId: ProjectionId) {
    super(`Projection ${projectionId} is not attached to document ${documentId}`)
    this.name = 'ProjectionNotFoundError'
  }
}

function requireOrigin(origin: DocumentOrigin): DocumentOrigin {
  if (origin === null || typeof origin !== 'object') {
    throw new TypeError('Document change origin is required')
  }
  if (typeof origin.kind !== 'string' || origin.kind.trim().length === 0) {
    throw new TypeError('Document change origin.kind must be a non-empty string')
  }
  if (origin.source !== undefined && typeof origin.source !== 'string') {
    throw new TypeError('Document change origin.source must be a string when provided')
  }
  if (origin.source !== undefined && origin.source.trim().length === 0) {
    throw new TypeError('Document change origin.source must be non-empty when provided')
  }

  return Object.freeze({
    kind: origin.kind,
    ...(origin.source === undefined ? {} : { source: origin.source }),
  })
}

export function createDocumentOrigin(kind: string, source?: string): DocumentOrigin {
  return requireOrigin({ kind, source })
}

function requireProjectionId(projectionId: ProjectionId): ProjectionId {
  if (typeof projectionId !== 'string' || projectionId.trim().length === 0) {
    throw new TypeError('Projection id must be a non-empty string')
  }
  return projectionId
}

function requireMarkdown(markdown: string): void {
  if (typeof markdown !== 'string') {
    throw new TypeError('Document markdown must be a string')
  }
}

function requireDocumentLocator(locator: DocumentLocator): DocumentLocator {
  if (!isDocumentLocator(locator)) {
    throw new TypeError(
      'Document locator must identify a document by id or path',
    )
  }

  return locator
}

/**
 * In-memory authority for document source and revision state.
 *
 * Persistence adapters are intentionally not part of this class yet. A load
 * seeds a clean document, while `markPersisted` lets the future persistence
 * port acknowledge the exact revision it wrote.
 */
export class DocumentStore {
  private readonly documents = new Map<DocumentId, DocumentState>()

  private readonly idsByPath = new Map<DocumentPath, DocumentId>()

  private readonly listeners = new Map<DocumentId, Set<DocumentSubscription>>()

  private readonly histories = new Map<DocumentId, MutableDocumentHistory>()

  private readonly projections = new Map<
    DocumentId,
    Map<ProjectionId, ProjectionRecord>
  >()

  private readonly timeline = new EventTimeline()

  private nextProjectionNumber = 0

  load(input: DocumentLoadInput): DocumentState {
    if (!isDocumentId(input.id)) {
      throw new TypeError('DocumentLoadInput.id must be a non-empty DocumentId')
    }
    if (!isDocumentPath(input.path)) {
      throw new TypeError('DocumentLoadInput.path must be a non-empty DocumentPath')
    }
    requireMarkdown(input.markdown)

    const byId = this.documents.get(input.id)
    const idForPath = this.idsByPath.get(input.path)

    if (byId && (byId.path !== input.path || idForPath !== input.id)) {
      throw new DocumentIdentityConflictError(
        `Document id ${input.id} is already loaded at ${byId.path}`,
      )
    }
    if (idForPath && idForPath !== input.id) {
      throw new DocumentIdentityConflictError(
        `Document path ${input.path} is already owned by ${idForPath}`,
      )
    }
    if (byId) {
      // Loading is idempotent. External source replacement must go through a
      // future explicit reconciliation/change path, never overwrite authority.
      return byId
    }

    const state = createDocumentState({
      id: input.id,
      path: input.path,
      markdown: input.markdown,
      revision: INITIAL_REVISION,
      persistedRevision: INITIAL_REVISION,
    })

    this.documents.set(state.id, state)
    this.idsByPath.set(state.path, state.id)
    this.listeners.set(state.id, new Set())
    this.histories.set(state.id, { undo: [], redo: [] })
    this.projections.set(state.id, new Map())
    this.timeline.record({
      type: 'DocumentLoaded',
      documentId: state.id,
      document: state,
    })
    return state
  }

  get(locator: DocumentLocator): DocumentState | undefined {
    const id = this.resolveDocumentId(locator)
    return id === undefined ? undefined : this.documents.get(id)
  }

  getRevision(locator: DocumentLocator): Revision {
    return this.requireDocument(locator).revision
  }

  getPersistedRevision(locator: DocumentLocator): Revision {
    return this.requireDocument(locator).persistedRevision
  }

  isDirty(locator: DocumentLocator): boolean {
    return this.requireDocument(locator).dirty
  }

  /**
   * Returns the append-only observable facts recorded by this store. Passing a
   * document locator filters the same timeline without creating document state.
   */
  getTimeline(locator?: DocumentLocator): readonly DocumentTimelineEvent[] {
    if (locator === undefined) return this.timeline.getAll()
    return this.timeline.getForDocument(this.requireDocument(locator).id)
  }

  subscribeTimeline(listener: TimelineListener): TimelineUnsubscribe {
    return this.timeline.subscribe(listener)
  }

  /**
   * Projection lifecycle facts are deliberately metadata-only. A projection
   * may hold editor/DOM state elsewhere, but it never becomes Markdown
   * authority and only reports the revision it displays.
   */
  attachProjection(
    locator: DocumentLocator,
    projectionId: ProjectionId,
    revision?: Revision,
  ): void {
    const document = this.requireDocument(locator)
    const id = requireProjectionId(projectionId)
    const displayedRevision = this.requireProjectionRevision(
      revision ?? document.revision,
      document.revision,
    )
    const projections = this.requireProjectionMap(document.id)

    if (projections.has(id)) {
      throw new ProjectionIdentityConflictError(document.id, id)
    }

    projections.set(id, {
      id,
      revision: displayedRevision,
      stale: false,
    })
    this.timeline.record({
      type: 'ProjectionAttached',
      documentId: document.id,
      projectionId: id,
      revision: displayedRevision,
    })
  }

  updateProjection(
    locator: DocumentLocator,
    projectionId: ProjectionId,
    revision?: Revision,
  ): void {
    const document = this.requireDocument(locator)
    const projection = this.requireProjection(document.id, projectionId)
    const displayedRevision = this.requireProjectionRevision(
      revision ?? document.revision,
      document.revision,
    )

    projection.revision = displayedRevision
    projection.stale = false
    this.timeline.record({
      type: 'ProjectionUpdated',
      documentId: document.id,
      projectionId: projection.id,
      revision: displayedRevision,
    })
  }

  detachProjection(
    locator: DocumentLocator,
    projectionId: ProjectionId,
    revision?: Revision,
  ): void {
    const document = this.requireDocument(locator)
    const projection = this.requireProjection(document.id, projectionId)
    const detachedRevision = this.requireProjectionRevision(
      revision ?? projection.revision,
      document.revision,
    )

    this.requireProjectionMap(document.id).delete(projection.id)
    this.timeline.record({
      type: 'ProjectionDetached',
      documentId: document.id,
      projectionId: projection.id,
      revision: detachedRevision,
    })
  }

  markProjectionStale(
    locator: DocumentLocator,
    projectionId: ProjectionId,
    revisionOrReason?: Revision | string,
    suppliedReason?: string,
  ): void {
    const document = this.requireDocument(locator)
    const projection = this.requireProjection(document.id, projectionId)
    const revision =
      typeof revisionOrReason === 'string'
        ? projection.revision
        : this.requireProjectionRevision(
            revisionOrReason ?? projection.revision,
            document.revision,
          )
    const reason =
      typeof revisionOrReason === 'string'
        ? revisionOrReason
        : suppliedReason

    projection.revision = revision
    projection.stale = true
    this.timeline.record({
      type: 'ProjectionStale',
      documentId: document.id,
      projectionId: projection.id,
      revision,
      ...(reason === undefined ? {} : { reason }),
    })
  }

  /**
   * Returns a defensive snapshot of the document's source history. The
   * returned arrays and entries cannot mutate the store's history.
   */
  getHistory(locator: DocumentLocator): DocumentHistorySnapshot {
    const document = this.requireDocument(locator)
    const history = this.requireHistoryById(document.id)

    return Object.freeze({
      undo: Object.freeze([...history.undo]),
      redo: Object.freeze([...history.redo]),
    })
  }

  canUndo(locator: DocumentLocator): boolean {
    const document = this.requireDocument(locator)
    return this.requireHistoryById(document.id).undo.length > 0
  }

  canRedo(locator: DocumentLocator): boolean {
    const document = this.requireDocument(locator)
    return this.requireHistoryById(document.id).redo.length > 0
  }

  /**
   * Reverts the most recent source edit for this document. Undo is itself a
   * source mutation, so it receives a new monotonic revision and emits the
   * usual `changed` event, but it does not create a second history entry.
   */
  undo(locator: DocumentLocator, origin: DocumentOrigin): DocumentState {
    const current = this.requireDocument(locator)
    const normalizedOrigin = requireOrigin(origin)
    const history = this.requireHistoryById(current.id)
    const entry = history.undo.pop()

    if (!entry) return current

    history.redo.push(entry)
    return this.commitChange(current, entry.before, normalizedOrigin, false)
  }

  /**
   * Reapplies the most recently undone source edit for this document. Redo
   * follows the same store/event/revision path as any other source mutation.
   */
  redo(locator: DocumentLocator, origin: DocumentOrigin): DocumentState {
    const current = this.requireDocument(locator)
    const normalizedOrigin = requireOrigin(origin)
    const history = this.requireHistoryById(current.id)
    const entry = history.redo.pop()

    if (!entry) return current

    history.undo.push(entry)
    return this.commitChange(current, entry.after, normalizedOrigin, false)
  }

  applyChange(
    locator: DocumentLocator,
    change: DocumentChangeInput,
  ): DocumentState

  applyChange(
    locator: DocumentLocator,
    markdown: string,
    origin: DocumentOrigin,
  ): DocumentState

  applyChange(
    locator: DocumentLocator,
    changeOrMarkdown: DocumentChangeInput | string,
    positionalOrigin?: DocumentOrigin,
  ): DocumentState {
    const current = this.requireDocument(locator)
    const change: DocumentChangeInput =
      typeof changeOrMarkdown === 'string'
        ? {
            markdown: changeOrMarkdown,
            origin: positionalOrigin as DocumentOrigin,
          }
        : changeOrMarkdown

    if (!change || change.origin === undefined) {
      throw new TypeError('Document change origin is required')
    }
    requireMarkdown(change.markdown)
    const origin = requireOrigin(change.origin)

    if (change.expectedRevision !== undefined) {
      if (!isRevision(change.expectedRevision)) {
        throw new TypeError('expectedRevision must be a valid Revision')
      }
      if (change.expectedRevision !== current.revision) {
        throw new DocumentRevisionConflictError(
          change.expectedRevision,
          current.revision,
        )
      }
    }

    if (change.markdown === current.markdown) {
      return current
    }

    return this.commitChange(current, change.markdown, origin, true)
  }

  /**
   * Commits a source mutation through the one authoritative state path.
   * `recordHistory` is false only for undo/redo, which move an existing entry
   * between stacks instead of recursively recording the reversal.
   */
  private commitChange(
    current: DocumentState,
    markdown: string,
    origin: DocumentOrigin,
    recordHistory: boolean,
  ): DocumentState {
    const next = createDocumentState({
      id: current.id,
      path: current.path,
      markdown,
      revision: nextRevision(current.revision),
      persistedRevision: current.persistedRevision,
    })

    const history = this.requireHistoryById(current.id)
    if (recordHistory) {
      history.undo.push(
        Object.freeze({
          before: current.markdown,
          after: markdown,
          origin,
        }),
      )
      history.redo.length = 0
    }

    this.documents.set(next.id, next)
    this.timeline.record({
      type: 'DocumentChanged',
      documentId: next.id,
      previous: current,
      document: next,
      origin,
    })
    this.emit(next.id, {
      type: 'changed',
      previous: current,
      document: next,
      origin,
    })
    return next
  }

  /**
   * A persistence adapter acknowledges the revision it actually wrote. It
   * cannot move persistedRevision backwards or acknowledge a future revision.
   */
  markPersisted(
    locator: DocumentLocator,
    revision: Revision,
    origin: DocumentOrigin,
  ): DocumentState {
    const current = this.requireDocument(locator)
    if (!isRevision(revision)) {
      throw new TypeError('persisted revision must be a valid Revision')
    }
    if (revision > current.revision) {
      throw new RangeError(
        `Cannot persist future revision ${revision}; current is ${current.revision}`,
      )
    }
    if (revision < current.persistedRevision) {
      throw new RangeError(
        `Cannot move persisted revision backwards from ${current.persistedRevision} to ${revision}`,
      )
    }

    const normalizedOrigin = requireOrigin(origin)
    if (revision === current.persistedRevision) {
      return current
    }

    const next = createDocumentState({
      id: current.id,
      path: current.path,
      markdown: current.markdown,
      revision: current.revision,
      persistedRevision: revision,
    })

    this.documents.set(next.id, next)
    this.timeline.record({
      type: 'DocumentPersisted',
      documentId: next.id,
      previous: current,
      document: next,
      origin: normalizedOrigin,
    })
    this.emit(next.id, {
      type: 'persisted',
      previous: current,
      document: next,
      origin: normalizedOrigin,
    })
    return next
  }

  subscribe(
    locator: DocumentLocator,
    listener: DocumentStoreListener,
  ): Unsubscribe

  subscribe(
    locator: DocumentLocator,
    projectionId: ProjectionId,
    listener: DocumentStoreListener,
  ): Unsubscribe

  subscribe(
    locator: DocumentLocator,
    projectionOrListener: ProjectionId | DocumentStoreListener,
    maybeListener?: DocumentStoreListener,
  ): Unsubscribe {
    const document = this.requireDocument(locator)
    let projectionId: ProjectionId
    let listener: DocumentStoreListener

    if (typeof projectionOrListener === 'string') {
      projectionId = requireProjectionId(projectionOrListener)
      if (typeof maybeListener !== 'function') {
        throw new TypeError('DocumentStore listener must be a function')
      }
      listener = maybeListener
    } else {
      if (typeof projectionOrListener !== 'function') {
        throw new TypeError('DocumentStore listener must be a function')
      }
      listener = projectionOrListener
      projectionId = this.allocateProjectionId(document.id)
    }

    this.attachProjection(
      documentById(document.id),
      projectionId,
      document.revision,
    )

    const documentListeners = this.listeners.get(document.id)
    if (!documentListeners) {
      throw new Error(`Listener registry missing for document ${document.id}`)
    }

    const subscription: DocumentSubscription = { projectionId, listener }
    documentListeners.add(subscription)
    let active = true
    return () => {
      if (!active) return
      active = false
      documentListeners.delete(subscription)
      if (this.isProjectionAttached(document.id, projectionId)) {
        this.detachProjection(documentById(document.id), projectionId)
      }
    }
  }

  private allocateProjectionId(documentId: DocumentId): ProjectionId {
    const projections = this.requireProjectionMap(documentId)
    let projectionId: ProjectionId

    do {
      projectionId = `projection-${++this.nextProjectionNumber}`
    } while (projections.has(projectionId))

    return projectionId
  }

  private requireProjectionMap(
    documentId: DocumentId,
  ): Map<ProjectionId, ProjectionRecord> {
    const projections = this.projections.get(documentId)
    if (!projections) {
      throw new Error(`Projection registry missing for document ${documentId}`)
    }
    return projections
  }

  private requireProjection(
    documentId: DocumentId,
    projectionId: ProjectionId,
  ): ProjectionRecord {
    const id = requireProjectionId(projectionId)
    const projection = this.requireProjectionMap(documentId).get(id)
    if (!projection) {
      throw new ProjectionNotFoundError(documentId, id)
    }
    return projection
  }

  private isProjectionAttached(
    documentId: DocumentId,
    projectionId: ProjectionId,
  ): boolean {
    return this.requireProjectionMap(documentId).has(projectionId)
  }

  private requireProjectionRevision(
    revision: Revision,
    currentRevision: Revision,
  ): Revision {
    if (!isRevision(revision)) {
      throw new TypeError('Projection revision must be a valid Revision')
    }
    if (revision > currentRevision) {
      throw new RangeError(
        `Projection revision ${revision} cannot be ahead of document revision ${currentRevision}`,
      )
    }
    return revision
  }

  private updateProjectionAfterStoreChange(
    documentId: DocumentId,
    projectionId: ProjectionId,
    revision: Revision,
  ): void {
    const projection = this.requireProjection(documentId, projectionId)
    projection.revision = revision
    projection.stale = false
    this.timeline.record({
      type: 'ProjectionUpdated',
      documentId,
      projectionId: projection.id,
      revision,
    })
  }

  private markProjectionStaleAfterFailure(
    documentId: DocumentId,
    projectionId: ProjectionId,
    reason: string,
  ): void {
    const projection = this.requireProjectionMap(documentId).get(projectionId)
    if (!projection) return

    projection.stale = true
    this.timeline.record({
      type: 'ProjectionStale',
      documentId,
      projectionId: projection.id,
      revision: projection.revision,
      reason,
    })
  }

  private resolveDocumentId(
    locator: DocumentLocator,
  ): DocumentId | undefined {
    const normalizedLocator = requireDocumentLocator(locator)
    if (normalizedLocator.kind === 'id') {
      return this.documents.has(normalizedLocator.id)
        ? normalizedLocator.id
        : undefined
    }
    return this.idsByPath.get(normalizedLocator.path)
  }

  private requireDocument(locator: DocumentLocator): DocumentState {
    const normalizedLocator = requireDocumentLocator(locator)
    const id = this.resolveDocumentId(normalizedLocator)
    const document = id === undefined ? undefined : this.documents.get(id)
    if (!document) {
      throw new DocumentNotFoundError(normalizedLocator)
    }
    return document
  }

  private requireHistoryById(
    documentId: DocumentId,
  ): MutableDocumentHistory {
    const history = this.histories.get(documentId)
    if (!history) {
      throw new Error(`History registry missing for document ${documentId}`)
    }
    return history
  }

  private emit(id: DocumentId, event: DocumentStoreEvent): void {
    const documentListeners = this.listeners.get(id)
    if (!documentListeners) return

    for (const subscription of [...documentListeners]) {
      try {
        subscription.listener(event)
      } catch (error) {
        this.markProjectionStaleAfterFailure(
          id,
          subscription.projectionId,
          String(error),
        )
        throw error
      }

      if (event.type === 'changed' && this.isProjectionAttached(id, subscription.projectionId)) {
        this.updateProjectionAfterStoreChange(
          id,
          subscription.projectionId,
          event.document.revision,
        )
      }
    }
  }
}
