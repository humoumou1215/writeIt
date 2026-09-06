import {
  EventTimeline,
  createTimelineDocumentState,
} from './timeline'
import type {
  DocumentTimelineEvent,
  EventTimelineOptions,
  ObserverErrorSink,
  ProjectionId,
  TimelineListener,
  TimelineUnsubscribe,
} from './timeline'
import {
  INITIAL_REVISION,
  createDocumentState,
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

export interface DocumentHistoryOptions {
  /** Maximum undo and redo entries retained for each document. */
  readonly maxEntries?: number
}

export interface DocumentStoreOptions {
  /** Receives isolated failures from timeline and document observers. */
  readonly observerErrorSink?: ObserverErrorSink
  /** Diagnostic fact retention; Markdown is never retained by the timeline. */
  readonly timeline?: Pick<EventTimelineOptions, 'maxEvents'>
  /** Per-document source history retention. */
  readonly history?: DocumentHistoryOptions
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

export interface ProjectionState {
  readonly projectionId: ProjectionId
  /** Highest revision explicitly acknowledged by the projection. */
  readonly revision: Revision
  /** True when explicitly stale or behind the authoritative document revision. */
  readonly stale: boolean
  /** True when the projection reported an apply/render failure. */
  readonly degraded: boolean
  readonly degradedReason?: string
}

interface MutableDocumentHistory {
  readonly undo: DocumentHistoryEntry[]
  readonly redo: DocumentHistoryEntry[]
  readonly maxEntries: number
}

interface ProjectionRecord {
  readonly id: ProjectionId
  revision: Revision
  explicitlyStale: boolean
  degradedReason?: string
}

interface DocumentSubscription {
  readonly projectionId?: ProjectionId
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

/**
 * Per-document FIFO dispatch state. Source commits remain synchronous, but
 * notifications created re-entrantly during a commit or fan-out wait until
 * the current event has reached every subscription.
 */
interface DocumentDispatchState {
  readonly pendingEvents: DocumentStoreEvent[]
  depth: number
  dispatching: boolean
}

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

export class ProjectionRevisionRegressionError extends RangeError {
  constructor(previous: Revision, next: Revision) {
    super(
      `Projection revision cannot move backwards from ${previous} to ${next}`,
    )
    this.name = 'ProjectionRevisionRegressionError'
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

const DEFAULT_HISTORY_MAX_ENTRIES = 1_000

function requireHistoryMaxEntries(maxEntries: number): number {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
    throw new RangeError(
      'History maxEntries must be a non-negative safe integer',
    )
  }
  return maxEntries
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

  private readonly dispatchStates = new Map<DocumentId, DocumentDispatchState>()

  private readonly timeline: EventTimeline

  private readonly observerErrorSink: ObserverErrorSink

  private readonly historyMaxEntries: number

  constructor(options: DocumentStoreOptions = {}) {
    this.observerErrorSink = options.observerErrorSink ?? (() => undefined)
    this.historyMaxEntries = requireHistoryMaxEntries(
      options.history?.maxEntries ?? DEFAULT_HISTORY_MAX_ENTRIES,
    )
    this.timeline = new EventTimeline({
      ...options.timeline,
      observerErrorSink: this.observerErrorSink,
    })
  }

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
    this.histories.set(state.id, {
      undo: [],
      redo: [],
      maxEntries: this.historyMaxEntries,
    })
    this.projections.set(state.id, new Map())
    this.dispatchStates.set(state.id, {
      pendingEvents: [],
      depth: 0,
      dispatching: false,
    })
    this.timeline.record({
      type: 'DocumentLoaded',
      documentId: state.id,
      document: createTimelineDocumentState(state),
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
      explicitlyStale: false,
    })
    this.timeline.record({
      type: 'ProjectionAttached',
      documentId: document.id,
      projectionId: id,
      revision: displayedRevision,
    })
  }

  getProjection(
    locator: DocumentLocator,
    projectionId: ProjectionId,
  ): ProjectionState {
    const document = this.requireDocument(locator)
    return this.toProjectionState(
      document,
      this.requireProjection(document.id, projectionId),
    )
  }

  getProjectionState(
    locator: DocumentLocator,
    projectionId: ProjectionId,
  ): ProjectionState {
    return this.getProjection(locator, projectionId)
  }

  getProjections(locator: DocumentLocator): readonly ProjectionState[] {
    const document = this.requireDocument(locator)
    return Object.freeze(
      [...this.requireProjectionMap(document.id).values()].map((projection) =>
        this.toProjectionState(document, projection),
      ),
    )
  }

  /**
   * Records that a projection has actually applied a revision. A callback
   * returning successfully is not an acknowledgement; projection adapters
   * must call this after their local apply/render completes.
   */
  acknowledgeProjection(
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

    if (displayedRevision < projection.revision) {
      throw new ProjectionRevisionRegressionError(
        projection.revision,
        displayedRevision,
      )
    }

    projection.revision = displayedRevision
    projection.explicitlyStale = false
    if (displayedRevision === document.revision) {
      projection.degradedReason = undefined
    }
    this.timeline.record({
      type: 'ProjectionUpdated',
      documentId: document.id,
      projectionId: projection.id,
      revision: displayedRevision,
    })
  }

  /** Backwards-compatible name for the explicit acknowledgement protocol. */
  updateProjection(
    locator: DocumentLocator,
    projectionId: ProjectionId,
    revision?: Revision,
  ): void {
    this.acknowledgeProjection(locator, projectionId, revision)
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
    const documentListeners = this.listeners.get(document.id)
    documentListeners?.forEach((subscription) => {
      if (subscription.projectionId === projection.id) {
        documentListeners.delete(subscription)
      }
    })
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
    const reason =
      typeof revisionOrReason === 'string'
        ? revisionOrReason
        : suppliedReason

    // A numeric argument is retained for API compatibility as the reported
    // source revision, but it never acknowledges an unapplied revision.
    if (typeof revisionOrReason === 'number') {
      const reportedRevision = this.requireProjectionRevision(
        revisionOrReason,
        document.revision,
      )
      if (reportedRevision < projection.revision) {
        throw new ProjectionRevisionRegressionError(
          projection.revision,
          reportedRevision,
        )
      }
    }

    projection.explicitlyStale = true
    if (reason !== undefined) {
      projection.degradedReason = reason
    }
    this.timeline.record({
      type: 'ProjectionStale',
      documentId: document.id,
      projectionId: projection.id,
      revision: projection.revision,
      ...(reason === undefined ? {} : { reason, degradedReason: reason }),
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
    this.trimHistory(history.redo, history.maxEntries)
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
    this.trimHistory(history.undo, history.maxEntries)
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
    const dispatchState = this.requireDispatchState(current.id)
    dispatchState.depth += 1

    try {
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
        this.trimHistory(history.undo, history.maxEntries)
        history.redo.length = 0
      }

      this.documents.set(next.id, next)
      dispatchState.pendingEvents.push({
        type: 'changed',
        previous: current,
        document: next,
        origin,
      })
      this.timeline.record({
        type: 'DocumentChanged',
        documentId: next.id,
        previous: createTimelineDocumentState(current),
        document: createTimelineDocumentState(next),
        origin,
      })
      return next
    } finally {
      dispatchState.depth -= 1
      if (dispatchState.depth === 0 && !dispatchState.dispatching) {
        this.dispatchPendingEvents(current.id)
      }
    }
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

    const dispatchState = this.requireDispatchState(current.id)
    dispatchState.depth += 1

    try {
      const next = createDocumentState({
        id: current.id,
        path: current.path,
        markdown: current.markdown,
        revision: current.revision,
        persistedRevision: revision,
      })

      this.documents.set(next.id, next)
      dispatchState.pendingEvents.push({
        type: 'persisted',
        previous: current,
        document: next,
        origin: normalizedOrigin,
      })
      this.timeline.record({
        type: 'DocumentPersisted',
        documentId: next.id,
        previous: createTimelineDocumentState(current),
        document: createTimelineDocumentState(next),
        origin: normalizedOrigin,
      })
      return next
    } finally {
      dispatchState.depth -= 1
      if (dispatchState.depth === 0 && !dispatchState.dispatching) {
        this.dispatchPendingEvents(current.id)
      }
    }
  }

  /**
   * Subscribes to document facts without creating or mutating projection
   * lifecycle state. Generic observers must not be mistaken for a view apply.
   */
  subscribe(
    locator: DocumentLocator,
    listener: DocumentStoreListener,
  ): Unsubscribe

  /**
   * Compatibility overload; the projection must already be explicitly
   * attached and this subscription does not detach it on unsubscribe.
   */
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

    if (typeof projectionOrListener === 'string') {
      const projectionId = requireProjectionId(projectionOrListener)
      if (typeof maybeListener !== 'function') {
        throw new TypeError('DocumentStore listener must be a function')
      }
      this.requireProjection(document.id, projectionId)
      return this.addSubscription(document.id, projectionId, maybeListener)
    }

    if (typeof projectionOrListener !== 'function') {
      throw new TypeError('DocumentStore listener must be a function')
    }
    return this.addSubscription(document.id, undefined, projectionOrListener)
  }

  /** Subscribes a listener to an already-attached projection. */
  subscribeProjection(
    locator: DocumentLocator,
    projectionId: ProjectionId,
    listener: DocumentStoreListener,
  ): Unsubscribe {
    const document = this.requireDocument(locator)
    const id = requireProjectionId(projectionId)
    if (typeof listener !== 'function') {
      throw new TypeError('DocumentStore listener must be a function')
    }
    this.requireProjection(document.id, id)
    return this.addSubscription(document.id, id, listener)
  }

  private addSubscription(
    documentId: DocumentId,
    projectionId: ProjectionId | undefined,
    listener: DocumentStoreListener,
  ): Unsubscribe {
    const documentListeners = this.listeners.get(documentId)
    if (!documentListeners) {
      throw new Error(`Listener registry missing for document ${documentId}`)
    }

    const subscription: DocumentSubscription = { projectionId, listener }
    documentListeners.add(subscription)
    let active = true
    return () => {
      if (!active) return
      active = false
      documentListeners.delete(subscription)
    }
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

  private toProjectionState(
    document: DocumentState,
    projection: ProjectionRecord,
  ): ProjectionState {
    return Object.freeze({
      projectionId: projection.id,
      revision: projection.revision,
      stale:
        projection.explicitlyStale || projection.revision < document.revision,
      degraded: projection.degradedReason !== undefined,
      ...(projection.degradedReason === undefined
        ? {}
        : { degradedReason: projection.degradedReason }),
    })
  }

  private markProjectionStaleAfterFailure(
    documentId: DocumentId,
    projectionId: ProjectionId,
    reason: string,
  ): void {
    const projection = this.requireProjectionMap(documentId).get(projectionId)
    if (!projection) return

    projection.explicitlyStale = true
    projection.degradedReason = reason
    this.timeline.record({
      type: 'ProjectionStale',
      documentId,
      projectionId: projection.id,
      revision: projection.revision,
      reason,
      degradedReason: reason,
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

  private trimHistory(entries: DocumentHistoryEntry[], maxEntries: number): void {
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries)
    }
  }

  private requireDispatchState(
    documentId: DocumentId,
  ): DocumentDispatchState {
    const dispatchState = this.dispatchStates.get(documentId)
    if (!dispatchState) {
      throw new Error(`Dispatch registry missing for document ${documentId}`)
    }
    return dispatchState
  }

  private dispatchPendingEvents(documentId: DocumentId): void {
    const dispatchState = this.requireDispatchState(documentId)
    if (dispatchState.dispatching) return

    dispatchState.dispatching = true
    try {
      while (dispatchState.pendingEvents.length > 0) {
        const event = dispatchState.pendingEvents.shift() as DocumentStoreEvent
        this.dispatchEvent(documentId, event)
      }
    } finally {
      dispatchState.dispatching = false
    }

    if (dispatchState.depth === 0 && dispatchState.pendingEvents.length > 0) {
      this.dispatchPendingEvents(documentId)
    }
  }

  private dispatchEvent(
    documentId: DocumentId,
    event: DocumentStoreEvent,
  ): void {
    const documentListeners = this.listeners.get(documentId)
    if (!documentListeners) return

    for (const subscription of [...documentListeners]) {
      try {
        subscription.listener(event)
      } catch (error) {
        if (subscription.projectionId !== undefined) {
          this.markProjectionStaleAfterFailure(
            documentId,
            subscription.projectionId,
            String(error),
          )
        }
        this.reportObserverError({
          source: 'document-store',
          error,
          eventType: event.type,
          documentId,
          ...(subscription.projectionId === undefined
            ? {}
            : { projectionId: subscription.projectionId }),
        })
      }
    }
  }

  private reportObserverError(context: Parameters<ObserverErrorSink>[0]): void {
    try {
      this.observerErrorSink(Object.freeze({ ...context }))
    } catch {
      // Diagnostics must not be able to interrupt an authoritative operation.
    }
  }
}
