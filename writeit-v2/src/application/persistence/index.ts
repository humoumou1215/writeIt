import {
  createDocumentOrigin,
  DocumentNotFoundError,
  DocumentStore,
  documentById,
  isDocumentId,
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
import {
  isFileVersionToken,
  type ConditionalWriteConflict,
  type ConditionalWriteDegraded,
  type FileSystemPort,
  type FileVersionToken,
  type TextFileSnapshot,
} from '../../platform/filesystem'

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
  /** Version observed on disk; absent when the file was deleted. */
  readonly actualVersion?: FileVersionToken
  /** Content that the persistence policy last observed as persisted. */
  readonly baselineMarkdown: string
  /** Version last acknowledged by the persistence policy, when known. */
  readonly baselineVersion?: FileVersionToken
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
  readonly baselineVersion?: FileVersionToken
  readonly externalChange?: ExternalFileChange
  readonly lastError?: string
}

export interface PersistenceSaveResult {
  readonly path: DocumentPath
  readonly revision: Revision
  readonly written: boolean
  readonly version: FileVersionToken
  readonly document: DocumentState
}

export interface ExternalFileCheckResult {
  readonly path: DocumentPath
  readonly changed: boolean
  readonly kind: ExternalFileChangeKind | 'none'
  readonly markdown?: string
  readonly version?: FileVersionToken
  readonly document: DocumentState
}

export interface PersistenceTrackOptions {
  /** Content known to be on disk at the tracked document's persisted revision. */
  readonly persistedMarkdown?: string
  /** Version read with persistedMarkdown, when the caller has a coherent snapshot. */
  readonly persistedVersion?: FileVersionToken
}

export interface PersistenceRebindPathOptions {
  /** New content already written while the document path was being moved. */
  readonly persistedMarkdown?: string
  /** Version returned by the successful move/conditional write. */
  readonly persistedVersion?: FileVersionToken
}

/**
 * A guarded batch of writes used by workspace deletion. The transaction does
 * not acknowledge a Store revision: if deletion is cancelled or fails, the
 * DocumentStore source/revision and dirty state remain unchanged. When a
 * conditional rollback succeeds, a known persistence version may be refreshed
 * to the token returned by that rollback write so the baseline still matches
 * the adapter's logical file version.
 */
export interface PersistenceDeletionSaveTransaction {
  commit(): void
  rollback(): Promise<void>
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

export class PersistenceConditionalWriteDegradedError extends Error {
  readonly code = 'persistence-conditional-write-degraded' as const
  readonly path: DocumentPath
  readonly expectedVersion: FileVersionToken
  readonly reason: ConditionalWriteDegraded['reason']
  readonly cause: ConditionalWriteDegraded

  constructor(path: DocumentPath, outcome: ConditionalWriteDegraded) {
    super(`Unable to safely save ${path}: ${outcome.message}`)
    this.name = 'PersistenceConditionalWriteDegradedError'
    this.path = path
    this.expectedVersion = outcome.expectedVersion
    this.reason = outcome.reason
    this.cause = outcome
  }
}

export class PersistenceDeletionSaveError extends Error {
  readonly code = 'persistence-deletion-save-failed' as const
  readonly path?: DocumentPath
  readonly cause: unknown
  readonly rollbackErrors: readonly unknown[]

  constructor(input: {
    readonly path?: DocumentPath
    readonly cause: unknown
    readonly rollbackErrors?: readonly unknown[]
  }) {
    const pathLabel = input.path === undefined ? '' : ` for ${input.path}`
    const rollbackLabel =
      input.rollbackErrors !== undefined && input.rollbackErrors.length > 0
        ? ` Rollback also failed for ${input.rollbackErrors.length} write${input.rollbackErrors.length === 1 ? '' : 's'}.`
        : ''
    super(
      `Unable to prepare guarded deletion save${pathLabel}: ${errorMessage(input.cause)}.${rollbackLabel}`,
      { cause: input.cause },
    )
    this.name = 'PersistenceDeletionSaveError'
    this.path = input.path
    this.cause = input.cause
    this.rollbackErrors = Object.freeze([...(input.rollbackErrors ?? [])])
  }
}

/**
 * A conditional rollback could not restore a pre-delete write because the
 * bytes/version changed after the successful CAS. The rollback deliberately
 * does not retry with the newly observed version: doing so could overwrite
 * an external writer's content.
 */
export class PersistenceDeletionRollbackConflictError extends Error {
  readonly code = 'persistence-deletion-rollback-conflict' as const
  readonly path: DocumentPath
  readonly reason: ConditionalWriteConflict['reason']
  readonly expectedVersion: FileVersionToken
  readonly actualVersion?: FileVersionToken
  readonly actualMarkdown?: string

  constructor(input: {
    readonly path: DocumentPath
    readonly outcome: ConditionalWriteConflict
  }) {
    const actual =
      input.outcome.reason === 'deleted'
        ? 'the file was deleted externally'
        : 'the file changed externally'
    super(
      `Unable to restore ${input.path} after deletion preparation: ${actual}`,
    )
    this.name = 'PersistenceDeletionRollbackConflictError'
    this.path = input.path
    this.reason = input.outcome.reason
    this.expectedVersion = input.outcome.expectedVersion
    if (input.outcome.actualVersion !== undefined) {
      this.actualVersion = input.outcome.actualVersion
    }
    if (input.outcome.actualContent !== undefined) {
      this.actualMarkdown = input.outcome.actualContent
    }
  }
}

export class PersistenceOperationLockedError extends Error {
  readonly code = 'persistence-operation-locked' as const
  readonly documentId: DocumentId

  constructor(documentId: DocumentId) {
    super(`Persistence operation is locked while deleting document ${documentId}`)
    this.name = 'PersistenceOperationLockedError'
    this.documentId = documentId
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
  readonly expectedVersion?: FileVersionToken
  readonly actualVersion?: FileVersionToken
  readonly revision: Revision

  constructor(input: {
    readonly path: DocumentPath
    readonly kind: ExternalFileChangeKind
    readonly expectedMarkdown: string
    readonly actualMarkdown?: string
    readonly expectedVersion?: FileVersionToken
    readonly actualVersion?: FileVersionToken
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
    this.expectedVersion = input.expectedVersion
    this.actualVersion = input.actualVersion
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
  persistedVersion?: FileVersionToken
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

type DiskReadResult =
  | {
      readonly kind: 'available'
      readonly markdown: string
      readonly version: FileVersionToken
    }
  | {
      readonly kind: 'deleted'
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

  /** Nested deletion operations are not expected, but a counter keeps the
   * lock safe for application adapters that compose commands. */
  private readonly deletionLocks = new Map<DocumentId, number>()

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
    if (
      options.persistedVersion !== undefined &&
      !isFileVersionToken(options.persistedVersion)
    ) {
      throw new TypeError('Tracked persisted version must be a file version token')
    }

    const baseline = options.persistedMarkdown ?? document.markdown
    let unsubscribeStore: PersistenceUnsubscribe = () => undefined
    const record: TrackedDocument = {
      id: document.id,
      path: document.path,
      persistedMarkdown: baseline,
      ...(options.persistedVersion === undefined
        ? {}
        : { persistedVersion: options.persistedVersion }),
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

  /** Reads a coherent file snapshot, seeds the Store, and starts tracking. */
  async loadFromFile(input: PersistenceLoadInput): Promise<DocumentState> {
    const snapshot = await this.readSnapshot(input.path)
    const document = this.store.load({
      id: input.id,
      path: input.path,
      markdown: snapshot.content,
    })
    this.track(documentById(document.id), {
      persistedMarkdown: snapshot.content,
      persistedVersion: snapshot.version,
    })
    return document
  }

  getAutoSaveDelay(): AutoSaveDelayMs {
    return this.autoSaveDelayMs
  }

  /** Returns the ids of every persistence registration, including closed tabs. */
  getTrackedDocumentIds(): readonly DocumentId[] {
    return Object.freeze(
      [...this.records.keys()].sort((left, right) => left.localeCompare(right)),
    )
  }

  isTracked(locator: DocumentLocator): boolean {
    const document = this.store.get(locator)
    return document !== undefined && this.records.has(document.id)
  }

  /**
   * Runs one application deletion workflow while suppressing auto-save races
   * for the supplied documents. Existing timers are left intact; a callback
   * that fires during the lock keeps its pending state and is rescheduled only
   * if the operation is cancelled.
   */
  async runDeletionExclusive<T>(
    documentIds: readonly DocumentId[],
    callback: () => Promise<T> | T,
  ): Promise<T> {
    if (!Array.isArray(documentIds)) {
      throw new TypeError('Deletion document ids must be an array')
    }
    if (typeof callback !== 'function') {
      throw new TypeError('Deletion callback must be a function')
    }

    const ids = [...new Set(documentIds)]
    for (const documentId of ids) {
      if (!isDocumentId(documentId)) {
        throw new TypeError('Deletion document id must be non-empty')
      }
    }

    const records: TrackedDocument[] = []
    for (const documentId of ids) {
      const record = this.records.get(documentId)
      if (record !== undefined) records.push(record)
    }

    for (const record of records) {
      this.deletionLocks.set(record.id, (this.deletionLocks.get(record.id) ?? 0) + 1)
    }

    try {
      // Do not let an already-running auto-save overlap the deletion plan.
      // Conflicts are safe to observe and the guarded deletion workflow will
      // re-check the current disk baseline before writing.
      for (const record of records) await this.waitForInFlightSave(record)
      return await callback()
    } finally {
      for (const record of records) {
        const count = this.deletionLocks.get(record.id) ?? 0
        if (count <= 1) this.deletionLocks.delete(record.id)
        else this.deletionLocks.set(record.id, count - 1)
        if (count <= 1) this.restoreAutoSaveAfterDeletion(record)
      }
    }
  }

  /**
   * Prepares guarded writes for dirty documents without acknowledging a Store
   * revision or changing the local source state. Every write uses the coherent
   * version read during the preflight. The caller commits by deleting the
   * workspace entry; rollback restores every byte written by this preparation
   * with the version returned by that successful CAS, and may refresh a known
   * persistence baseline token to match the restored adapter state.
   */
  async prepareDeletionSave(
    documentIds: readonly DocumentId[],
  ): Promise<PersistenceDeletionSaveTransaction> {
    if (!Array.isArray(documentIds)) {
      throw new TypeError('Deletion document ids must be an array')
    }

    interface PreparedWrite {
      readonly record: TrackedDocument
      readonly document: DocumentState
      readonly originalMarkdown: string
      readonly originalVersion: FileVersionToken
      readonly hadPersistedVersion: boolean
      readonly targetMarkdown: string
      written: boolean
      writtenVersion?: FileVersionToken
    }

    const prepared: PreparedWrite[] = []
    const ids = [...new Set(documentIds)]
    for (const documentId of ids) {
      if (!isDocumentId(documentId)) {
        throw new TypeError('Deletion document id must be non-empty')
      }
      const record = this.records.get(documentId)
      if (record === undefined) {
        throw new PersistenceDeletionSaveError({
          cause: new PersistenceNotTrackedError(documentId),
        })
      }
      const document = this.store.get(documentById(documentId))
      if (!document) {
        throw new PersistenceDeletionSaveError({
          cause: new DocumentNotFoundError(documentById(documentId)),
        })
      }
      if (!document.dirty) continue

      let disk: DiskReadResult
      try {
        disk = await this.readDisk(record)
      } catch (error) {
        throw new PersistenceDeletionSaveError({
          path: record.path,
          cause: error,
        })
      }
      if (disk.kind === 'deleted') {
        throw new PersistenceDeletionSaveError({
          path: record.path,
          cause: this.createConflict(record, document, 'deleted'),
        })
      }
      const baselineVersionChanged =
        record.persistedVersion !== undefined &&
        record.persistedVersion !== disk.version
      if (disk.markdown !== record.persistedMarkdown || baselineVersionChanged) {
        throw new PersistenceDeletionSaveError({
          path: record.path,
          cause: this.createConflict(
            record,
            document,
            'changed',
            disk.markdown,
            disk.version,
          ),
        })
      }

      prepared.push({
        record,
        document,
        originalMarkdown: disk.markdown,
        originalVersion: disk.version,
        hadPersistedVersion: record.persistedVersion !== undefined,
        targetMarkdown: document.markdown,
        written: false,
      })
    }

    const rollbackWrites = async (): Promise<readonly unknown[]> => {
      const rollbackErrors: unknown[] = []
      for (const item of [...prepared].reverse()) {
        if (!item.written || item.writtenVersion === undefined) continue
        try {
          const outcome = await this.fileSystem.writeTextIfUnchanged(
            item.record.path,
            item.writtenVersion,
            item.originalMarkdown,
          )
          if (outcome.status === 'conflict') {
            this.noteExternalChange(item.record, item.document, {
              kind: outcome.reason,
              markdown: outcome.actualContent,
              actualVersion: outcome.actualVersion,
            })
            rollbackErrors.push(
              new PersistenceDeletionRollbackConflictError({
                path: item.record.path,
                outcome,
              }),
            )
            continue
          }
          if (outcome.status === 'degraded') {
            const error = new PersistenceConditionalWriteDegradedError(
              item.record.path,
              outcome,
            )
            this.noteDeletionRollbackFailure(item.record, error)
            rollbackErrors.push(error)
            continue
          }
          if (item.hadPersistedVersion) {
            item.record.persistedVersion = outcome.version
            this.notify(item.record)
          }
          item.written = false
          item.writtenVersion = undefined
        } catch (error) {
          const wrapped = new PersistenceWriteError(item.record.path, error)
          this.noteDeletionRollbackFailure(item.record, wrapped)
          rollbackErrors.push(wrapped)
        }
      }
      return Object.freeze(rollbackErrors)
    }

    try {
      for (const item of prepared) {
        const current = this.store.get(documentById(item.document.id))
        if (
          !current ||
          current.revision !== item.document.revision ||
          current.markdown !== item.document.markdown ||
          current.path !== item.document.path
        ) {
          throw new PersistenceDeletionSaveError({
            path: item.record.path,
            cause: new Error(
              `Document ${item.document.id} changed while preparing deletion save`,
            ),
          })
        }
        try {
          const outcome = await this.fileSystem.writeTextIfUnchanged(
            item.record.path,
            item.originalVersion,
            item.targetMarkdown,
          )
          if (outcome.status === 'conflict') {
            throw new PersistenceDeletionSaveError({
              path: item.record.path,
              cause: this.createConflict(
                item.record,
                current,
                outcome.reason,
                outcome.actualContent,
                outcome.actualVersion,
                outcome.expectedVersion,
              ),
            })
          }
          if (outcome.status === 'degraded') {
            throw new PersistenceDeletionSaveError({
              path: item.record.path,
              cause: new PersistenceConditionalWriteDegradedError(
                item.record.path,
                outcome,
              ),
            })
          }
          item.written = true
          item.writtenVersion = outcome.version
        } catch (error) {
          if (error instanceof PersistenceDeletionSaveError) throw error
          throw new PersistenceDeletionSaveError({
            path: item.record.path,
            cause: new PersistenceWriteError(item.record.path, error),
          })
        }
      }
      for (const item of prepared) {
        const current = this.store.get(documentById(item.document.id))
        if (
          !current ||
          current.revision !== item.document.revision ||
          current.markdown !== item.document.markdown ||
          current.path !== item.document.path
        ) {
          throw new PersistenceDeletionSaveError({
            path: item.record.path,
            cause: new Error(
              `Document ${item.document.id} changed while preparing deletion save`,
            ),
          })
        }
      }
    } catch (error) {
      const rollbackErrors = await rollbackWrites()
      if (error instanceof PersistenceDeletionSaveError) {
        if (rollbackErrors.length === 0) throw error
        throw new PersistenceDeletionSaveError({
          path: error.path,
          cause: error.cause,
          rollbackErrors,
        })
      }
      throw new PersistenceDeletionSaveError({
        cause: error,
        rollbackErrors,
      })
    }

    let committed = false
    let rolledBack = false
    return Object.freeze({
      commit: (): void => {
        committed = true
      },
      rollback: async (): Promise<void> => {
        if (committed || rolledBack) return
        const rollbackErrors = await rollbackWrites()
        if (rollbackErrors.length > 0) {
          throw new PersistenceDeletionSaveError({
            cause: new Error('Deletion save rollback failed'),
            rollbackErrors,
          })
        }
        rolledBack = true
      },
    })
  }

  /** Removes one registration and cancels any future auto-save callback. */
  untrack(locator: DocumentLocator): boolean {
    const document = this.store.get(locator)
    if (!document) return false
    const record = this.records.get(document.id)
    if (!record) return false
    this.cancelAutoSave(record)
    record.unsubscribeStore()
    record.listeners.clear()
    this.records.delete(document.id)
    this.deletionLocks.delete(document.id)
    return true
  }

  /** Explicit alias for application deletion/lifecycle callers. */
  unregister(locator: DocumentLocator): boolean {
    return this.untrack(locator)
  }

  setAutoSaveDelay(delay: AutoSaveDelayMs): AutoSaveDelayMs {
    this.autoSaveDelayMs = requireAutoSaveDelay(delay)
    for (const record of this.records.values()) {
      this.cancelAutoSave(record)
      if (this.autoSaveDelayMs !== null && !this.isDeletionLocked(record)) {
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
    if (
      options.persistedVersion !== undefined &&
      !isFileVersionToken(options.persistedVersion)
    ) {
      throw new TypeError('Rebound persisted version must be a file version token')
    }

    record.path = path
    if (options.persistedMarkdown !== undefined) {
      record.persistedMarkdown = options.persistedMarkdown
    }
    if (options.persistedVersion !== undefined) {
      record.persistedVersion = options.persistedVersion
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
    if (this.isDeletionLocked(record)) {
      throw new PersistenceOperationLockedError(record.id)
    }
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

    const markdown = disk.markdown
    const version = disk.version
    const versionChanged =
      record.persistedVersion !== undefined &&
      record.persistedVersion !== version
    if (markdown === record.persistedMarkdown && !versionChanged) {
      if (record.persistedVersion === undefined) {
        record.persistedVersion = version
      }
      this.clearExternalChange(record)
      return Object.freeze({
        path: record.path,
        changed: false,
        kind: 'none' as const,
        version,
        document: this.requireDocument(locator),
      })
    }

    this.noteExternalChange(record, document, {
      kind: 'changed',
      markdown,
      actualVersion: version,
    })
    return Object.freeze({
      path: record.path,
      changed: true,
      kind: 'changed' as const,
      markdown,
      version,
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
    return this.replaceWithDisk(record, disk)
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
    return this.replaceWithDisk(record, disk)
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
    this.deletionLocks.clear()
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
      const diskVersion = disk.version
      const diskChanged =
        disk.markdown !== record.persistedMarkdown ||
        (record.persistedVersion !== undefined &&
          record.persistedVersion !== diskVersion)
      if (diskChanged) {
        throw this.createConflict(
          record,
          before,
          'changed',
          disk.markdown,
          diskVersion,
        )
      }

      const targetRevision = before.revision
      const targetMarkdown = before.markdown
      let persistedVersion = diskVersion
      if (before.dirty) {
        const outcome = await this.fileSystem.writeTextIfUnchanged(
          record.path,
          diskVersion,
          targetMarkdown,
        )
        if (outcome.status === 'conflict') {
          throw this.createConflict(
            record,
            before,
            outcome.reason,
            outcome.actualContent,
            outcome.actualVersion,
            outcome.expectedVersion,
          )
        }
        if (outcome.status === 'degraded') {
          throw new PersistenceConditionalWriteDegradedError(
            record.path,
            outcome,
          )
        }
        persistedVersion = outcome.version
        record.persistedMarkdown = targetMarkdown
        record.persistedVersion = persistedVersion
      } else if (record.persistedVersion === undefined) {
        record.persistedVersion = persistedVersion
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
        version: persistedVersion,
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
          error instanceof PersistenceConditionalWriteDegradedError ||
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
    snapshot: Extract<DiskReadResult, { readonly kind: 'available' }>,
  ): DocumentState {
    const markdown = snapshot.markdown
    const version = snapshot.version
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
      record.persistedVersion = version
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
      record.externalChange === undefined &&
      !this.isDeletionLocked(record)
    ) {
      this.scheduleAutoSave(record)
    }
  }

  private scheduleAutoSave(record: TrackedDocument): void {
    this.cancelAutoSave(record)
    if (this.autoSaveDelayMs === null || this.isDeletionLocked(record)) return
    const delay = this.autoSaveDelayMs
    record.pendingAutoSave = true
    this.notify(record)
    if (delay === 0) {
      queueMicrotask(() => {
        if (!record.pendingAutoSave || this.isDeletionLocked(record)) return
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
      if (this.isDeletionLocked(record)) return
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

  private isDeletionLocked(record: TrackedDocument): boolean {
    return (this.deletionLocks.get(record.id) ?? 0) > 0
  }

  private restoreAutoSaveAfterDeletion(record: TrackedDocument): void {
    if (
      this.records.get(record.id) !== record ||
      record.timer !== undefined ||
      !record.pendingAutoSave ||
      this.autoSaveDelayMs === null ||
      record.phase === 'error'
    ) {
      return
    }
    const document = this.store.get(documentById(record.id))
    if (!document?.dirty || record.externalChange !== undefined) {
      record.pendingAutoSave = false
      this.notify(record)
      return
    }

    // scheduleAutoSave deliberately clears and re-adds the pending marker;
    // callers observe the same final state while a consumed timer is replaced
    // with a live timer after cancellation.
    record.pendingAutoSave = false
    this.notify(record)
    this.scheduleAutoSave(record)
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
    actualVersion?: FileVersionToken,
    expectedVersion: FileVersionToken | undefined = record.persistedVersion,
  ): SaveConflictError {
    this.noteExternalChange(record, document, {
      kind,
      markdown,
      actualVersion,
    })
    return new SaveConflictError({
      path: record.path,
      kind,
      expectedMarkdown: record.persistedMarkdown,
      ...(markdown === undefined ? {} : { actualMarkdown: markdown }),
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      ...(actualVersion === undefined ? {} : { actualVersion }),
      revision: document.revision,
    })
  }

  private noteDeletionRollbackFailure(
    record: TrackedDocument,
    error: unknown,
  ): void {
    record.externalChange = undefined
    record.phase = 'error'
    record.lastError = errorMessage(error)
    this.cancelAutoSave(record)
    this.notify(record)
  }

  private noteExternalChange(
    record: TrackedDocument,
    document: DocumentState,
    input: {
      readonly kind: ExternalFileChangeKind
      readonly markdown?: string
      readonly actualVersion?: FileVersionToken
    },
  ): ExternalFileChange {
    const change: ExternalFileChange = Object.freeze({
      kind: input.kind,
      path: record.path,
      baselineMarkdown: record.persistedMarkdown,
      ...(record.persistedVersion === undefined
        ? {}
        : { baselineVersion: record.persistedVersion }),
      documentRevision: document.revision,
      documentDirty: document.dirty,
      ...(input.markdown === undefined ? {} : { markdown: input.markdown }),
      ...(input.actualVersion === undefined
        ? {}
        : { actualVersion: input.actualVersion }),
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

  private async readSnapshot(path: DocumentPath): Promise<TextFileSnapshot> {
    try {
      return await this.fileSystem.readTextSnapshot(path)
    } catch (error) {
      throw new PersistenceReadError(path, error)
    }
  }

  private async readDisk(record: TrackedDocument): Promise<DiskReadResult> {
    try {
      const snapshot = await this.fileSystem.readTextSnapshot(record.path)
      return Object.freeze({
        kind: 'available' as const,
        markdown: snapshot.content,
        version: snapshot.version,
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
      ...(record.persistedVersion === undefined
        ? {}
        : { baselineVersion: record.persistedVersion }),
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
