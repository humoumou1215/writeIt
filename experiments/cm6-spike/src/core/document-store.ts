import { ChangeSet, Text } from '@codemirror/state'

export type ViewId = string

export interface DocumentState {
  readonly id: string
  readonly markdown: string
  readonly revision: number
}

export interface DocumentChange {
  readonly fromRevision: number
  readonly changes: ChangeSet
}

export interface DocumentChangedEvent {
  readonly documentId: string
  readonly fromRevision: number
  readonly toRevision: number
  readonly changes: ChangeSet
  readonly origin: ViewId
  readonly before: string
  readonly after: string
  readonly label: string
}

export interface ProjectionState {
  readonly key: string
  readonly documentId: string
  revision: number
  stale: boolean
}

export interface DiagnosticSnapshot {
  documents: Array<{ id: string; markdown: string; revision: number; disk: string; dirty: boolean }>
  projections: ProjectionState[]
  events: string[]
}

export class DocumentConflictError extends Error {
  constructor(
    public readonly documentId: string,
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(`stale document ${documentId}: expected rev ${expectedRevision}, actual rev ${actualRevision}`)
    this.name = 'DocumentConflictError'
  }
}

export type DocumentListener = (event: DocumentChangedEvent) => void

interface HistoryEntry {
  before: string
  after: string
  label: string
}

interface InternalDocument {
  state: DocumentState
  disk: string
  listeners: Map<string, { key: string; documentId: string; revision: number; stale: boolean; listener: DocumentListener }>
  undo: HistoryEntry[]
  redo: HistoryEntry[]
}

/**
 * Markdown-first authority for the Spike.
 *
 * CodeMirror views only submit ChangeSets here and subscribe to the resulting
 * event. They never become a second source of truth.
 */
export class DocumentStore {
  private readonly documents = new Map<string, InternalDocument>()
  private readonly events: string[] = []
  private eventSequence = 0

  constructor(initial: Record<string, string> = {}) {
    for (const [id, markdown] of Object.entries(initial)) this.seed(id, markdown)
  }

  seed(id: string, markdown: string): void {
    if (this.documents.has(id)) throw new Error(`document already exists: ${id}`)
    this.documents.set(id, {
      state: { id, markdown, revision: 1 },
      disk: markdown,
      listeners: new Map(),
      undo: [],
      redo: [],
    })
    this.recordEvent(`DocumentLoaded ${id} rev=1`)
  }

  get(id: string): DocumentState {
    const document = this.documents.get(id)
    if (!document) throw new Error(`unknown document: ${id}`)
    return { ...document.state }
  }

  has(id: string): boolean {
    return this.documents.has(id)
  }

  remove(id: string): void {
    const document = this.require(id)
    if (document.listeners.size > 0) throw new Error(`cannot remove subscribed document: ${id}`)
    this.documents.delete(id)
    this.recordEvent(`DocumentRemoved ${id}`)
  }

  subscribe(documentId: string, key: string, listener: DocumentListener): () => void {
    const document = this.require(documentId)
    if (document.listeners.has(key)) throw new Error(`duplicate projection: ${key}`)
    document.listeners.set(key, { key, documentId, revision: document.state.revision, stale: false, listener })
    this.recordEvent(`SubscriptionCreated ${key} -> ${documentId} rev=${document.state.revision}`)
    return () => {
      if (document.listeners.delete(key)) this.recordEvent(`SubscriptionDestroyed ${key} -> ${documentId}`)
    }
  }

  applyChanges(documentId: string, change: DocumentChange, origin: ViewId, label = 'edit'): number {
    const document = this.require(documentId)
    const current = document.state
    if (current.revision !== change.fromRevision) {
      throw new DocumentConflictError(documentId, change.fromRevision, current.revision)
    }
    if (change.changes.length !== current.markdown.length) {
      throw new Error(
        `ChangeSet length mismatch for ${documentId}: ${change.changes.length} != ${current.markdown.length}`,
      )
    }
    const after = applyChangeSet(change.changes, current.markdown)
    if (after === current.markdown) return current.revision
    return this.commit(document, after, origin, label, true, change.changes)
  }

  replace(documentId: string, markdown: string, origin: ViewId, label = 'replace'): number {
    const document = this.require(documentId)
    if (document.state.markdown === markdown) return document.state.revision
    const changes = fullReplace(document.state.markdown, markdown)
    return this.commit(document, markdown, origin, label, true, changes)
  }

  undo(documentId: string, origin: ViewId): number {
    const document = this.require(documentId)
    const entry = document.undo.pop()
    if (!entry) return document.state.revision
    document.redo.push(entry)
    const changes = fullReplace(document.state.markdown, entry.before)
    return this.commit(document, entry.before, origin, `undo:${entry.label}`, false, changes)
  }

  redo(documentId: string, origin: ViewId): number {
    const document = this.require(documentId)
    const entry = document.redo.pop()
    if (!entry) return document.state.revision
    document.undo.push(entry)
    const changes = fullReplace(document.state.markdown, entry.after)
    return this.commit(document, entry.after, origin, `redo:${entry.label}`, false, changes)
  }

  save(documentId: string): string {
    const document = this.require(documentId)
    document.disk = document.state.markdown
    this.recordEvent(`DocumentSaved ${documentId} rev=${document.state.revision}`)
    return document.disk
  }

  diskContents(): Record<string, string> {
    return Object.fromEntries([...this.documents].map(([id, document]) => [id, document.disk]))
  }

  markStale(documentId: string, key: string): void {
    const projection = this.require(documentId).listeners.get(key)
    if (!projection) throw new Error(`unknown projection: ${key}`)
    projection.stale = true
    projection.revision = Math.max(0, this.require(documentId).state.revision - 1)
    this.recordEvent(`ProjectionStale ${key} rev=${projection.revision}`)
  }

  clearStale(documentId: string, key: string): void {
    const projection = this.require(documentId).listeners.get(key)
    if (!projection) throw new Error(`unknown projection: ${key}`)
    projection.stale = false
    projection.revision = this.require(documentId).state.revision
    this.recordEvent(`ProjectionRecovered ${key} rev=${projection.revision}`)
  }

  diagnostics(): DiagnosticSnapshot {
    return {
      documents: [...this.documents.values()].map((document) => ({
        id: document.state.id,
        markdown: document.state.markdown,
        revision: document.state.revision,
        disk: document.disk,
        dirty: document.disk !== document.state.markdown,
      })),
      projections: [...this.documents.values()].flatMap((document) =>
        [...document.listeners.values()].map((projection) => ({
          key: projection.key,
          documentId: projection.documentId,
          revision: projection.revision,
          stale: projection.stale,
        })),
      ),
      events: [...this.events],
    }
  }

  note(event: string): void {
    this.recordEvent(event)
  }

  private commit(
    document: InternalDocument,
    markdown: string,
    origin: ViewId,
    label: string,
    addHistory: boolean,
    changes: ChangeSet,
  ): number {
    const before = document.state.markdown
    const fromRevision = document.state.revision
    const toRevision = fromRevision + 1
    document.state = { ...document.state, markdown, revision: toRevision }
    if (addHistory) {
      document.undo.push({ before, after: markdown, label })
      document.redo = []
    }

    const event: DocumentChangedEvent = {
      documentId: document.state.id,
      fromRevision,
      toRevision,
      changes,
      origin,
      before,
      after: markdown,
      label,
    }
    this.recordEvent(
      `DocumentChanged ${document.state.id} revision=${fromRevision}->${toRevision} origin=${origin} label=${label}`,
    )

    for (const projection of document.listeners.values()) {
      projection.revision = toRevision
      projection.stale = false
      try {
        projection.listener(event)
      } catch (error) {
        projection.stale = true
        this.recordEvent(`ProjectionUpdateFailed ${projection.key}: ${String(error)}`)
      }
    }
    return toRevision
  }

  private require(id: string): InternalDocument {
    const document = this.documents.get(id)
    if (!document) throw new Error(`unknown document: ${id}`)
    return document
  }

  private recordEvent(event: string): void {
    this.events.push(`[${String(++this.eventSequence).padStart(3, '0')}] ${event}`)
    if (this.events.length > 80) this.events.shift()
  }
}

export function applyChangeSet(changes: ChangeSet, markdown: string): string {
  const text: Text = Text.of(markdown.split('\n'))
  return changes.apply(text).toString()
}

export function fullReplace(before: string, after: string): ChangeSet {
  return ChangeSet.of({ from: 0, to: before.length, insert: after }, before.length)
}
