import type { DocumentOrigin } from './store'
import type { DocumentId, DocumentPath, DocumentState, Revision } from './types'

/** Stable identity for an attached editor, embed, preview, or other projection. */
export type ProjectionId = string

export interface ObserverErrorContext {
  readonly source: 'timeline' | 'document-store'
  readonly error: unknown
  readonly eventType: string
  readonly documentId?: DocumentId
  readonly projectionId?: ProjectionId
}

/**
 * Receives failures from passive observers without becoming part of the
 * authoritative operation. Implementations must treat this as diagnostics;
 * a sink failure is isolated as well.
 */
export type ObserverErrorSink = (context: ObserverErrorContext) => void

export interface EventTimelineOptions {
  readonly observerErrorSink?: ObserverErrorSink
  /** Maximum number of compact facts retained for later diagnostics. */
  readonly maxEvents?: number
}

/**
 * Timeline state intentionally excludes Markdown. The document store remains
 * the only owner of source text; the timeline retains identity, revision and
 * persistence status only.
 */
export interface TimelineDocumentState {
  readonly id: DocumentId
  readonly path: DocumentPath
  readonly revision: Revision
  readonly persistedRevision: Revision
  readonly dirty: boolean
}

function compactTimelineDocumentState(
  state: TimelineDocumentState,
): TimelineDocumentState {
  return Object.freeze({
    id: state.id,
    path: state.path,
    revision: state.revision,
    persistedRevision: state.persistedRevision,
    dirty: state.dirty,
  })
}

export function createTimelineDocumentState(
  state: DocumentState,
): TimelineDocumentState {
  return compactTimelineDocumentState(state)
}

export interface DocumentLoadedTimelineEvent {
  readonly sequence: number
  readonly type: 'DocumentLoaded'
  readonly documentId: DocumentId
  readonly document: TimelineDocumentState
}

export interface DocumentChangedTimelineEvent {
  readonly sequence: number
  readonly type: 'DocumentChanged'
  readonly documentId: DocumentId
  readonly previous: TimelineDocumentState
  readonly document: TimelineDocumentState
  readonly origin: DocumentOrigin
}

export interface DocumentPersistedTimelineEvent {
  readonly sequence: number
  readonly type: 'DocumentPersisted'
  readonly documentId: DocumentId
  readonly previous: TimelineDocumentState
  readonly document: TimelineDocumentState
  readonly origin: DocumentOrigin
}

export interface ProjectionAttachedTimelineEvent {
  readonly sequence: number
  readonly type: 'ProjectionAttached'
  readonly documentId: DocumentId
  readonly projectionId: ProjectionId
  readonly revision: Revision
}

export interface ProjectionUpdatedTimelineEvent {
  readonly sequence: number
  readonly type: 'ProjectionUpdated'
  readonly documentId: DocumentId
  readonly projectionId: ProjectionId
  readonly revision: Revision
  /** Present when the acknowledged source is currently rendered degraded. */
  readonly degradedReason?: string
}

export interface ProjectionDegradedTimelineEvent {
  readonly sequence: number
  readonly type: 'ProjectionDegraded'
  readonly documentId: DocumentId
  readonly projectionId: ProjectionId
  readonly revision: Revision
  readonly reason: string
}

export interface ProjectionDetachedTimelineEvent {
  readonly sequence: number
  readonly type: 'ProjectionDetached'
  readonly documentId: DocumentId
  readonly projectionId: ProjectionId
  readonly revision: Revision
}

export interface ProjectionStaleTimelineEvent {
  readonly sequence: number
  readonly type: 'ProjectionStale'
  readonly documentId: DocumentId
  readonly projectionId: ProjectionId
  readonly revision: Revision
  readonly reason?: string
  readonly degradedReason?: string
}

export type DocumentTimelineEvent =
  | DocumentLoadedTimelineEvent
  | DocumentChangedTimelineEvent
  | DocumentPersistedTimelineEvent
  | ProjectionAttachedTimelineEvent
  | ProjectionUpdatedTimelineEvent
  | ProjectionDegradedTimelineEvent
  | ProjectionDetachedTimelineEvent
  | ProjectionStaleTimelineEvent

type TimelineEventInput<T extends DocumentTimelineEvent> = Omit<T, 'sequence'>

export type DocumentTimelineEventInput =
  | TimelineEventInput<DocumentLoadedTimelineEvent>
  | TimelineEventInput<DocumentChangedTimelineEvent>
  | TimelineEventInput<DocumentPersistedTimelineEvent>
  | TimelineEventInput<ProjectionAttachedTimelineEvent>
  | TimelineEventInput<ProjectionUpdatedTimelineEvent>
  | TimelineEventInput<ProjectionDegradedTimelineEvent>
  | TimelineEventInput<ProjectionDetachedTimelineEvent>
  | TimelineEventInput<ProjectionStaleTimelineEvent>

function compactTimelineEventInput(
  input: DocumentTimelineEventInput,
): DocumentTimelineEventInput {
  switch (input.type) {
    case 'DocumentLoaded':
      return {
        ...input,
        document: compactTimelineDocumentState(input.document),
      }
    case 'DocumentChanged':
    case 'DocumentPersisted':
      return {
        ...input,
        previous: compactTimelineDocumentState(input.previous),
        document: compactTimelineDocumentState(input.document),
      }
    default:
      return input
  }
}

export type TimelineListener = (event: DocumentTimelineEvent) => void
export type TimelineUnsubscribe = () => void

/**
 * Small synchronous append-only fact log. It deliberately does not replay or
 * derive state: DocumentStore remains the runtime authority, while this class
 * only makes the facts observable in deterministic sequence order.
 */
const DEFAULT_TIMELINE_MAX_EVENTS = 1_000

function requireMaxEvents(maxEvents: number): number {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 0) {
    throw new RangeError('Timeline maxEvents must be a non-negative safe integer')
  }
  return maxEvents
}

export class EventTimeline {
  private readonly events: DocumentTimelineEvent[] = []

  private readonly listeners = new Set<TimelineListener>()

  private readonly observerErrorSink: ObserverErrorSink

  private readonly pendingEvents: DocumentTimelineEvent[] = []

  private readonly maxEvents: number

  private nextSequence = 0

  private dispatching = false

  constructor(options: EventTimelineOptions = {}) {
    this.observerErrorSink = options.observerErrorSink ?? (() => undefined)
    this.maxEvents = requireMaxEvents(
      options.maxEvents ?? DEFAULT_TIMELINE_MAX_EVENTS,
    )
  }

  record(input: DocumentTimelineEventInput): DocumentTimelineEvent {
    const compactInput = compactTimelineEventInput(input)
    const event = Object.freeze({
      ...compactInput,
      sequence: ++this.nextSequence,
    }) as DocumentTimelineEvent

    this.events.push(event)
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents)
    }
    this.pendingEvents.push(event)
    this.dispatchPendingEvents()
    return event
  }

  getAll(): readonly DocumentTimelineEvent[] {
    return Object.freeze([...this.events])
  }

  getForDocument(documentId: DocumentId): readonly DocumentTimelineEvent[] {
    return Object.freeze(
      this.events.filter((event) => event.documentId === documentId),
    )
  }

  subscribe(listener: TimelineListener): TimelineUnsubscribe {
    if (typeof listener !== 'function') {
      throw new TypeError('EventTimeline listener must be a function')
    }

    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  private dispatchPendingEvents(): void {
    if (this.dispatching) return

    this.dispatching = true
    try {
      while (this.pendingEvents.length > 0) {
        const event = this.pendingEvents.shift() as DocumentTimelineEvent
        for (const listener of [...this.listeners]) {
          try {
            listener(event)
          } catch (error) {
            this.reportObserverError({
              source: 'timeline',
              error,
              eventType: event.type,
              documentId: event.documentId,
            })
          }
        }
      }
    } finally {
      this.dispatching = false
    }
  }

  private reportObserverError(context: ObserverErrorContext): void {
    try {
      this.observerErrorSink(Object.freeze({ ...context }))
    } catch {
      // Diagnostics must not be able to interrupt an authoritative operation.
    }
  }
}
