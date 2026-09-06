import type { DocumentOrigin } from './store'
import type { DocumentId, DocumentState, Revision } from './types'

/** Stable identity for an attached editor, embed, preview, or other projection. */
export type ProjectionId = string

export interface DocumentLoadedTimelineEvent {
  readonly sequence: number
  readonly type: 'DocumentLoaded'
  readonly documentId: DocumentId
  readonly document: DocumentState
}

export interface DocumentChangedTimelineEvent {
  readonly sequence: number
  readonly type: 'DocumentChanged'
  readonly documentId: DocumentId
  readonly previous: DocumentState
  readonly document: DocumentState
  readonly origin: DocumentOrigin
}

export interface DocumentPersistedTimelineEvent {
  readonly sequence: number
  readonly type: 'DocumentPersisted'
  readonly documentId: DocumentId
  readonly previous: DocumentState
  readonly document: DocumentState
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
}

export type DocumentTimelineEvent =
  | DocumentLoadedTimelineEvent
  | DocumentChangedTimelineEvent
  | DocumentPersistedTimelineEvent
  | ProjectionAttachedTimelineEvent
  | ProjectionUpdatedTimelineEvent
  | ProjectionDetachedTimelineEvent
  | ProjectionStaleTimelineEvent

type TimelineEventInput<T extends DocumentTimelineEvent> = Omit<T, 'sequence'>

export type DocumentTimelineEventInput =
  | TimelineEventInput<DocumentLoadedTimelineEvent>
  | TimelineEventInput<DocumentChangedTimelineEvent>
  | TimelineEventInput<DocumentPersistedTimelineEvent>
  | TimelineEventInput<ProjectionAttachedTimelineEvent>
  | TimelineEventInput<ProjectionUpdatedTimelineEvent>
  | TimelineEventInput<ProjectionDetachedTimelineEvent>
  | TimelineEventInput<ProjectionStaleTimelineEvent>

export type TimelineListener = (event: DocumentTimelineEvent) => void
export type TimelineUnsubscribe = () => void

/**
 * Small synchronous append-only fact log. It deliberately does not replay or
 * derive state: DocumentStore remains the runtime authority, while this class
 * only makes the facts observable in deterministic sequence order.
 */
export class EventTimeline {
  private readonly events: DocumentTimelineEvent[] = []

  private readonly listeners = new Set<TimelineListener>()

  private nextSequence = 0

  record(input: DocumentTimelineEventInput): DocumentTimelineEvent {
    const event = Object.freeze({
      ...input,
      sequence: ++this.nextSequence,
    }) as DocumentTimelineEvent

    this.events.push(event)
    for (const listener of [...this.listeners]) {
      listener(event)
    }
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
}
