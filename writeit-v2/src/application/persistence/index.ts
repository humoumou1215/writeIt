import {
  createDocumentOrigin,
  DocumentNotFoundError,
  DocumentStore,
  documentById,
  isDocumentPath,
} from '../../core/document'
import type {
  DocumentId,
  DocumentLocator,
  DocumentOrigin,
  DocumentPath,
  DocumentState,
  Revision,
} from '../../core/document'
import type { FileSystemPort } from '../../platform/filesystem'

/** `null` disables automatic persistence and leaves saving to the user. */
export type AutoSaveDelayMs = number | null

export const DEFAULT_AUTO_SAVE_DELAY_MS: AutoSaveDelayMs = 1_000

export type PersistenceStatus =
  | 'clean'
  | 'dirty'
  | 'saving'
  | 'external-change'
  | 'conflict'
  | 'error'

export type ExternalFileChangeKind = 'changed' | 'deleted'

export interface ExternalFileChange {
  readonly kind: ExternalFileChangeKind
  readonly path: DocumentPath
  /** Content observed on disk; absent when the file was deleted. */
  readonly markdown?: string
  /** Content that the persistence policy last observed as persisted. */
  readonly baselineMarkdown: string
  readonly documentRevision: Revision
  readonly documentDirty: boolean
}

export interface PersistenceState {
  readonly documentId: DocumentId
  readonly path: DocumentPath
  readonly revision: Revision
  readonly persistedRevision: Revision
  readonly dirty: boolean
  readonly status: PersistenceStatus
  readonly autoSaveDelayMs: AutoSaveDelayMs
  readonly pendingAutoSave: boolean
  readonly baselineMarkdown: string
  readonly externalChange?: ExternalFileChange
  readonly lastError?: string
}

export interface PersistenceSaveResult {
  readonly path: DocumentPath
  readonly revision: Revision
  readonly written: boolean
  readonly document: DocumentState
}

export interface ExternalFileCheckResult {
  readonly path: DocumentPath
  readonly changed: boolean
  readonly kind: ExternalFileChangeKind | 'none'
  readonly markdown?: string
  readonly document: DocumentState
}

export interface PersistenceTrackOptions {
  /** Content known to be on disk at the tracked document's persisted revision. */
  readonly persistedMarkdown?: string
}

export interface PersistenceRebindPathOptions {
  /** New content already written while the document path was being moved. */
  readonly persistedMarkdown?: string
}

export interface PersistenceLoadInput {
  readonly id: DocumentId
  readonly path: DocumentPath
}

/**
 * The timer is scheduling only: DocumentStore remains the source of truth and
 * every actual save still performs a revision/external-content check.
 */
export interface PersistenceScheduler {
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

export interface DocumentPersistenceOptions {
  readonly autoSaveDelayMs?: AutoSaveDelayMs
  readonly scheduler?: PersistenceScheduler
}

export type PersistenceStateListener = (state: PersistenceState) => void
export type PersistenceUnsubscribe = () => void

export class PersistenceNotTrackedError extends Error {
  readonly documentId: DocumentId

  constructor(documentId: DocumentId) {
    super(`Document is not tracked by the persistence policy: ${documentId}`)
    this.name = 'PersistenceNotTrackedError'
    this.documentId = documentId
  }
}

export class PersistenceReadError extends Error {
  readonly path: DocumentPath
  readonly cause: unknown

  constructor(path: DocumentPath, cause: unknown) {
    super(`Unable to read ${path} before persistence`, { cause })
    this.name = 'PersistenceReadError'
    this.path = path
    this.cause = cause
  }
}

export class PersistenceWriteError extends Error {
  readonly path: DocumentPath
  readonly cause: unknown

  constructor(path: DocumentPath, cause: unknown) {
    super(`Unable to save ${path}`, { cause })
    this.name = 'PersistenceWriteError'
    this.path = path
    this.cause = cause
  }
}

export class ExternalFileUnavailableError extends Error {
  readonly path: DocumentPath
  readonly cause: unknown

  constructor(path: DocumentPath, cause?: unknown) {
    super(`The external file is unavailable: ${path}`, { cause })
    this.name = 'ExternalFileUnavailableError'
    this.path = path
    this.cause = cause
  }
}

export class SaveConflictError extends Error {
  readonly path: DocumentPath
  readonly kind: ExternalFileChangeKind
  readonly expectedMarkdown: string
  readonly actualMarkdown?: string
  readonly revision: Revision

  constructor(input: {
    readonly path: DocumentPath
    readonly kind: ExternalFileChangeKind
    readonly expectedMarkdown: string
    readonly actualMarkdown?: string
    readonly revision: Revision
  }) {
    super(
      input.kind === 'deleted'
        ? `Cannot save ${input.path}: the file was deleted externally`
        : `Cannot save ${input.path}: the file changed externally`,
    )
    this.name = 'SaveConflictError'
    this.path = input.path
    this.kind = input.kind
    this.expectedMarkdown = input.expectedMarkdown
    this.actualMarkdown = input.actualMarkdown
    this.revision = input.revision
  }
}

export class UnsavedChangesError extends Error {
  readonly documentId: DocumentId

  constructor(documentId: DocumentId) {
    super(`Document ${documentId} has unsaved changes`)
    this.name = 'UnsavedChangesError'
    this.documentId = documentId
  }
}

interface TrackedDocument {
  readonly id: DocumentId
  path: DocumentPath
  persistedMarkdown: string
  phase: 'ready' | 'saving' | 'external-change' | 'conflict' | 'error'
  externalChange?: ExternalFileChange
  lastError?: string
  pendingAutoSave: boolean
  timer?: unknown
  savePromise?: Promise<PersistenceSaveResult>
  suppressAutoSave: number
  readonly listeners: Set<PersistenceStateListener>
  readonly unsubscribeStore: PersistenceUnsubscribe
}

interface DiskReadResult {
  readonly kind: 'available' | 'deleted'
  readonly markdown?: string
  readonly cause?: unknown
}

const DEFAULT_SCHEDULER: PersistenceScheduler = {
  set(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs)
  },
  clear(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

function requireAutoSaveDelay(delay: AutoSaveDelayMs): AutoSaveDelayMs {
  if (delay === null) return null
  if (!Number.isSafeInteger(delay) || delay < 0) {
    throw new RangeError(
      'Auto-save delay must be null or a non-negative safe integer',
    )
  }
  return delay
}

function isDocumentLocator(value: unknown): value is DocumentLocator {
  return value !== null && typeof value === 'object' && 'kind' in value
}

function isMissingFileError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const candidate = error as { readonly name?: unknown; readonly code?: unknown }
  return candidate.name === 'FileNotFoundError' || candidate.code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Application-owned persistence policy for one authoritative DocumentStore.
 *
 * The policy remembers only the last content known to be on disk so it can
 * perform optimistic external-change detection. It never supplies editor
 * content or creates another live Markdown authority.
 */
export class DocumentPersistenceService {
  private readonly store: DocumentStore

  private readonly fileSystem: FileSystemPort

  private readonly scheduler: PersistenceScheduler

  private readonly records = new Map<DocumentId, TrackedDocument>()

  private readonly listeners = new Set<PersistenceStateListener>()

  private autoSaveDelayMs: AutoSaveDelayMs

  constructor(
    store: DocumentStore,
    fileSystem: FileSystemPort,
    options: DocumentPersistenceOptions = {},
  ) {
    this.store = store
    this.fileSystem = fileSystem
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER
    this.autoSaveDelayMs = requireAutoSaveDelay(
      options.autoSaveDelayMs === undefined
        ? DEFAULT_AUTO_SAVE_DELAY_MS
        : options.autoSaveDelayMs,
    )
  }

  /**
   * Tracks a document that has already been loaded from the persistence
   * boundary. Callers should pass the exact content read from disk when it is
   * available; otherwise the current Store source is used as the baseline.
   */
  track(
    locator: DocumentLocator,
    options: PersistenceTrackOptions = {},
  ): PersistenceState {
    const document = this.requireDocument(locator)
    const existing = this.records.get(document.id)
    if (existing) {
      if (existing.path !== document.path) {
        throw new Error(
          `Tracked document ${document.id} changed path from ${existing.path} to ${document.path}`,
        )
      }
      return this.getState(locator)
    }

    if (
      options.persistedMarkdown !== undefined &&
      typeof options.persistedMarkdown !== 'string'
    ) {
      throw new TypeError('Tracked persisted Markdown must be a string')
    }

    const baseline = options.persistedMarkdown ?? document.markdown
    let unsubscribeStore: PersistenceUnsubscribe = () => undefined
    const record: TrackedDocument = {
      id: document.id,
      path: document.path,
      persistedMarkdown: baseline,
      phase: 'ready',
      pendingAutoSave: false,
      suppressAutoSave: 0,
      listeners: new Set(),
      unsubscribeStore: () => unsubscribeStore(),
    }

    unsubscribeStore = this.store.subscribe(
      documentById(document.id),
      (event) => {
        if (event.type === 'changed') {
          this.onDocumentChanged(record)
        } else if (event.type === 'renamed') {
          record.path = event.document.path
          record.externalChange = undefined
          record.lastError = undefined
          record.phase = 'ready'
          this.notify(record)
        } else {
          this.notify(record)
        }
      },
    )
    this.records.set(document.id, record)
    return this.getState(locator)
  }

  /** Reads a file, seeds the Store, and starts tracking its persistence state. */
  async loadFromFile(input: PersistenceLoadInput): Promise<DocumentState> {
    const markdown = await this.readFile(input.path)
    const document = this.store.load({
      id: input.id,
      path: input.path,
      markdown,
    })
    this.track(documentById(document.id), { persistedMarkdown: markdown })
    return document
  }

  getAutoSaveDelay(): AutoSaveDelayMs {
    return this.autoSaveDelayMs
  }

  setAutoSaveDelay(delay: AutoSaveDelayMs): AutoSaveDelayMs {
    this.autoSaveDelayMs = requireAutoSaveDelay(delay)
    for (const record of this.records.values()) {
      this.cancelAutoSave(record)
      if (this.autoSaveDelayMs !== null) {
        const document = this.store.get(documentById(record.id))
        if (document?.dirty && record.externalChange === undefined) {
          this.scheduleAutoSave(record)
        }
      }
      this.notify(record)
    }
    return this.autoSaveDelayMs
  }

  getState(locator: DocumentLocator): PersistenceState {
    const record = this.requireRecord(locator)
    const document = this.requireDocument(locator)
    return this.toState(record, document)
  }

  /**
   * Rebinds an existing persistence record after a filesystem rename/move.
   * The DocumentStore path must already be the new path; Markdown remains
   * Store-authoritative and an optional new baseline describes bytes already
   * written by the rename transaction.
   */
  rebindPath(
    locator: DocumentLocator,
    path: DocumentPath,
    options: PersistenceRebindPathOptions = {},
  ): PersistenceState {
    const record = this.requireRecord(locator)
    const document = this.requireDocument(locator)
    if (!isDocumentPath(path)) {
      throw new TypeError('Persistence path must be a non-empty DocumentPath')
    }
    if (document.path !== path) {
      throw new Error(
        `Document ${document.id} is still addressed at ${document.path}; cannot rebind persistence to ${path}`,
      )
    }
    if (
      options.persistedMarkdown !== undefined &&
      typeof options.persistedMarkdown !== 'string'
    ) {
      throw new TypeError('Rebound persisted Markdown must be a string')
    }

    record.path = path
    if (options.persistedMarkdown !== undefined) {
      record.persistedMarkdown = options.persistedMarkdown
    }
    record.externalChange = undefined
    record.lastError = undefined
    record.phase = 'ready'
    this.cancelAutoSave(record)
    this.notify(record)
    return this.toState(record, this.requireDocument(documentById(record.id)))
  }

  /** Aliases used by workspace rename/move application services. */
  renamePath(
    locator: DocumentLocator,
    path: DocumentPath,
    options: PersistenceRebindPathOptions = {},
  ): PersistenceState {
    return this.rebindPath(locator, path, options)
  }

  updatePath(
    locator: DocumentLocator,
    path: DocumentPath,
    options: PersistenceRebindPathOptions = {},
  ): PersistenceState {
    return this.rebindPath(locator, path, options)
  }

  subscribe(
    locator: DocumentLocator,
    listener: PersistenceStateListener,
  ): PersistenceUnsubscribe {
    if (typeof listener !== 'function') {
      throw new TypeError('Persistence state listener must be a function')
    }
    const record = this.requireRecord(locator)
    record.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      record.listeners.delete(listener)
    }
  }

  /** Subscribes to state changes for every tracked document. */
  subscribeAll(listener: PersistenceStateListener): PersistenceUnsubscribe {
    if (typeof listener !== 'function') {
      throw new TypeError('Persistence state listener must be a function')
    }
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  /**
   * Saves the current Store revision. Before writing, the external file must
   * still equal the last known persisted content; otherwise the method throws
   * and never overwrites the external edit.
   */
  async save(locator: DocumentLocator): Promise<PersistenceSaveResult> {
    const record = this.requireRecord(locator)
    const inFlight = record.savePromise
    if (inFlight) {
      const result = await inFlight
      const current = this.store.get(documentById(record.id))
      if (current?.dirty && this.records.get(record.id) === record) {
        return this.save(locator)
      }
      return result
    }

    const promise = this.performSave(record)
    record.savePromise = promise
    try {
      return await promise
    } finally {
      if (record.savePromise === promise) record.savePromise = undefined
    }
  }

  /**
   * Checks the external path without changing Store authority. A caller can
   * then explicitly call `reloadFromDisk` or `discardLocalChanges`.
   */
  async checkExternalChange(
    locator: DocumentLocator,
  ): Promise<ExternalFileCheckResult> {
    const record = this.requireRecord(locator)
    const document = this.requireDocument(locator)
    const disk = await this.readDisk(record)

    if (disk.kind === 'deleted') {
      this.noteExternalChange(record, document, {
        kind: 'deleted',
      })
      return Object.freeze({
        path: record.path,
        changed: true,
        kind: 'deleted' as const,
        document: this.requireDocument(locator),
      })
    }

    const markdown = disk.markdown as string
    if (markdown === record.persistedMarkdown) {
      this.clearExternalChange(record)
      return Object.freeze({
        path: record.path,
        changed: false,
        kind: 'none' as const,
        document: this.requireDocument(locator),
      })
    }

    this.noteExternalChange(record, document, {
      kind: 'changed',
      markdown,
    })
    return Object.freeze({
      path: record.path,
      changed: true,
      kind: 'changed' as const,
      markdown,
      document: this.requireDocument(locator),
    })
  }

  /**
   * Replaces a clean Store document with the current external file. The
   * replacement is an explicit source mutation followed by a persistence
   * acknowledgement, so the Store remains the only authority.
   */
  async reloadFromDisk(locator: DocumentLocator): Promise<DocumentState> {
    const record = this.requireRecord(locator)
    this.cancelAutoSave(record)
    await this.waitForInFlightSave(record)
    const current = this.requireDocument(locator)
    if (current.dirty) throw new UnsavedChangesError(current.id)

    const disk = await this.readDisk(record)
    if (disk.kind === 'deleted') {
      throw new ExternalFileUnavailableError(record.path, disk.cause)
    }
    return this.replaceWithDisk(record, disk.markdown as string)
  }

  /**
   * Explicitly discards local edits and adopts the external file. This is the
   * close-without-saving path; a missing file is reported instead of silently
   * losing the Store source.
   */
  async discardLocalChanges(locator: DocumentLocator): Promise<DocumentState> {
    const record = this.requireRecord(locator)
    this.cancelAutoSave(record)
    await this.waitForInFlightSave(record)
    const disk = await this.readDisk(record)
    if (disk.kind === 'deleted') {
      throw new ExternalFileUnavailableError(record.path, disk.cause)
    }
    return this.replaceWithDisk(record, disk.markdown as string)
  }

  /**
   * A closed tab can be reopened from the persistence boundary. Clean
   * documents accept external changes; dirty documents must be resolved first.
   */
  async reopen(locator: DocumentLocator): Promise<DocumentState> {
    const current = this.requireDocument(locator)
    if (current.dirty) throw new UnsavedChangesError(current.id)
    return this.reloadFromDisk(locator)
  }

  /** Clears timers/listeners owned by this application policy. */
  destroy(): void {
    for (const record of this.records.values()) {
      this.cancelAutoSave(record)
      record.unsubscribeStore()
      record.listeners.clear()
    }
    this.records.clear()
    this.listeners.clear()
  }

  private async performSave(
    record: TrackedDocument,
  ): Promise<PersistenceSaveResult> {
    const before = this.requireDocument(documentById(record.id))
    this.cancelAutoSave(record)
    record.phase = 'saving'
    record.lastError = undefined
    this.notify(record)

    try {
      const disk = await this.readDisk(record)
      if (disk.kind === 'deleted') {
        throw this.createConflict(record, before, 'deleted')
      }
      if (disk.markdown !== record.persistedMarkdown) {
        throw this.createConflict(record, before, 'changed', disk.markdown)
      }

      const targetRevision = before.revision
      const targetMarkdown = before.markdown
      if (before.dirty) {
        await this.fileSystem.writeFile(record.path, targetMarkdown)
        record.persistedMarkdown = targetMarkdown
      }

      record.externalChange = undefined
      record.phase = 'ready'
      const acknowledged = before.dirty
        ? this.store.markPersisted(
            documentById(record.id),
            targetRevision,
            createDocumentOrigin('persistence', 'document-save'),
          )
        : this.requireDocument(documentById(record.id))
      this.notify(record)

      const current = this.requireDocument(documentById(record.id))
      if (current.dirty && this.autoSaveDelayMs !== null) {
        this.scheduleAutoSave(record)
      }
      return Object.freeze({
        path: record.path,
        revision: targetRevision,
        written: before.dirty,
        document: acknowledged,
      })
    } catch (error) {
      if (!(error instanceof SaveConflictError)) {
        record.phase = 'error'
        record.lastError = errorMessage(error)
        this.notify(record)
        if (
          error instanceof PersistenceReadError ||
          error instanceof PersistenceWriteError ||
          error instanceof ExternalFileUnavailableError
        ) {
          throw error
        }
        // Errors from a platform adapter are kept as causes at this boundary.
        throw new PersistenceWriteError(record.path, error)
      }
      this.notify(record)
      throw error
    }
  }

  private replaceWithDisk(
    record: TrackedDocument,
    markdown: string,
  ): DocumentState {
    record.suppressAutoSave += 1
    try {
      const current = this.requireDocument(documentById(record.id))
      const changed =
        current.markdown === markdown
          ? current
          : this.store.applyChange(documentById(record.id), {
              markdown,
              origin: createDocumentOrigin('external', 'file-reload'),
              expectedRevision: current.revision,
            })
      const persisted = this.store.markPersisted(
        documentById(record.id),
        changed.revision,
        createDocumentOrigin('persistence', 'file-reload'),
      )
      record.persistedMarkdown = markdown
      record.externalChange = undefined
      record.lastError = undefined
      record.phase = 'ready'
      this.cancelAutoSave(record)
      this.notify(record)
      return persisted
    } finally {
      record.suppressAutoSave -= 1
    }
  }

  private onDocumentChanged(record: TrackedDocument): void {
    if (this.records.get(record.id) !== record) return
    record.lastError = undefined
    if (record.externalChange) {
      const document = this.store.get(documentById(record.id))
      record.phase = document?.dirty ? 'conflict' : 'external-change'
    } else if (record.phase !== 'saving') {
      record.phase = 'ready'
    }
    this.notify(record)
    if (
      record.suppressAutoSave === 0 &&
      record.externalChange === undefined
    ) {
      this.scheduleAutoSave(record)
    }
  }

  private scheduleAutoSave(record: TrackedDocument): void {
    this.cancelAutoSave(record)
    if (this.autoSaveDelayMs === null) return
    const delay = this.autoSaveDelayMs
    record.pendingAutoSave = true
    this.notify(record)
    if (delay === 0) {
      queueMicrotask(() => {
        if (!record.pendingAutoSave) return
        record.pendingAutoSave = false
        this.notify(record)
        void this.save(documentById(record.id)).catch((error: unknown) => {
          if (this.records.get(record.id) !== record) return
          if (error instanceof SaveConflictError) return
          record.phase = 'error'
          record.lastError = errorMessage(error)
          this.notify(record)
        })
      })
      return
    }
    record.timer = this.scheduler.set(() => {
      record.timer = undefined
      record.pendingAutoSave = false
      this.notify(record)
      void this.save(documentById(record.id)).catch((error: unknown) => {
        if (this.records.get(record.id) !== record) return
        if (error instanceof SaveConflictError) return
        record.phase = 'error'
        record.lastError = errorMessage(error)
        this.notify(record)
      })
    }, delay)
  }

  private cancelAutoSave(record: TrackedDocument): void {
    if (record.timer !== undefined) {
      this.scheduler.clear(record.timer)
      record.timer = undefined
    }
    if (record.pendingAutoSave) {
      record.pendingAutoSave = false
      this.notify(record)
    }
  }

  private createConflict(
    record: TrackedDocument,
    document: DocumentState,
    kind: ExternalFileChangeKind,
    markdown?: string,
  ): SaveConflictError {
    this.noteExternalChange(record, document, { kind, markdown })
    return new SaveConflictError({
      path: record.path,
      kind,
      expectedMarkdown: record.persistedMarkdown,
      ...(markdown === undefined ? {} : { actualMarkdown: markdown }),
      revision: document.revision,
    })
  }

  private noteExternalChange(
    record: TrackedDocument,
    document: DocumentState,
    input: { readonly kind: ExternalFileChangeKind; readonly markdown?: string },
  ): ExternalFileChange {
    const change: ExternalFileChange = Object.freeze({
      kind: input.kind,
      path: record.path,
      baselineMarkdown: record.persistedMarkdown,
      documentRevision: document.revision,
      documentDirty: document.dirty,
      ...(input.markdown === undefined ? {} : { markdown: input.markdown }),
    })
    record.externalChange = change
    record.phase = document.dirty ? 'conflict' : 'external-change'
    record.lastError = undefined
    this.cancelAutoSave(record)
    return change
  }

  private clearExternalChange(record: TrackedDocument): void {
    if (record.externalChange === undefined && record.phase !== 'external-change') {
      return
    }
    record.externalChange = undefined
    record.lastError = undefined
    record.phase = 'ready'
    this.notify(record)
  }

  private async waitForInFlightSave(record: TrackedDocument): Promise<void> {
    const inFlight = record.savePromise
    if (!inFlight) return
    try {
      await inFlight
    } catch (error) {
      if (!(error instanceof SaveConflictError)) throw error
    }
  }

  private async readFile(path: DocumentPath): Promise<string> {
    try {
      return await this.fileSystem.readFile(path)
    } catch (error) {
      throw new PersistenceReadError(path, error)
    }
  }

  private async readDisk(record: TrackedDocument): Promise<DiskReadResult> {
    try {
      return Object.freeze({
        kind: 'available' as const,
        markdown: await this.fileSystem.readFile(record.path),
      })
    } catch (error) {
      if (isMissingFileError(error)) {
        return Object.freeze({ kind: 'deleted' as const, cause: error })
      }
      throw new PersistenceReadError(record.path, error)
    }
  }

  private requireDocument(locator: DocumentLocator): DocumentState {
    const document = this.store.get(locator)
    if (!document) throw new DocumentNotFoundError(locator)
    return document
  }

  private requireRecord(locator: DocumentLocator): TrackedDocument {
    const document = this.requireDocument(locator)
    const record = this.records.get(document.id)
    if (!record) throw new PersistenceNotTrackedError(document.id)
    return record
  }

  private toState(
    record: TrackedDocument,
    document: DocumentState,
  ): PersistenceState {
    const status: PersistenceStatus =
      record.phase === 'saving'
        ? 'saving'
        : record.phase === 'conflict'
          ? 'conflict'
          : record.phase === 'external-change'
            ? 'external-change'
            : record.phase === 'error'
              ? 'error'
              : document.dirty
                ? 'dirty'
                : 'clean'

    return Object.freeze({
      documentId: record.id,
      path: record.path,
      revision: document.revision,
      persistedRevision: document.persistedRevision,
      dirty: document.dirty,
      status,
      autoSaveDelayMs: this.autoSaveDelayMs,
      pendingAutoSave: record.pendingAutoSave,
      baselineMarkdown: record.persistedMarkdown,
      ...(record.externalChange === undefined
        ? {}
        : { externalChange: record.externalChange }),
      ...(record.lastError === undefined
        ? {}
        : { lastError: record.lastError }),
    })
  }

  private notify(record: TrackedDocument): void {
    const document = this.store.get(documentById(record.id))
    if (!document) return
    const state = this.toState(record, document)
    for (const listener of [...record.listeners]) {
      try {
        listener(state)
      } catch {
        // State observers are projections; they cannot interrupt persistence.
      }
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(state)
      } catch {
        // Global state observers have the same isolation guarantee.
      }
    }
  }
}

/** Short name for callers that model this class as a persistence policy. */
export { DocumentPersistenceService as PersistencePolicy }

/** Convenience origin retained for application adapters that need a stable source label. */
export const PERSISTENCE_ORIGIN: DocumentOrigin = createDocumentOrigin(
  'persistence',
  'document-persistence',
)

export function isPersistenceTracked(
  service: DocumentPersistenceService,
  locator: DocumentLocator,
): boolean {
  if (!isDocumentLocator(locator)) return false
  try {
    service.getState(locator)
    return true
  } catch (error) {
    if (error instanceof PersistenceNotTrackedError) return false
    throw error
  }
}
