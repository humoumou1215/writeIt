import {
  documentById,
  DocumentStore,
  isDocumentId,
} from '../../core/document'
import type {
  DocumentId,
  DocumentState,
  ProjectionId,
} from '../../core/document'
import {
  createWorkspacePath,
  isWorkspacePathWithin,
  workspaceParent,
} from '../../core/workspace'
import type {
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspacePath,
} from '../../core/workspace'
import {
  DocumentPersistenceService,
  type PersistenceDeletionSaveTransaction,
} from '../persistence'
import { WorkspaceRecoveryStore } from './recovery'
import { WorkspaceTabManager } from './tabs'
import type { WorkspaceTab } from './tabs'
import type { WorkspaceFileSystemPort } from '../../platform/filesystem'
import {
  WorkspaceEntryNotFoundError,
  WorkspaceInvalidOperationError,
} from '../../platform/filesystem'
import { ReferenceGraph } from '../../core/reference'
import type {
  ReferenceIndex,
  ReferenceIndexEntry,
} from '../../core/reference'
import type { ProjectionState } from '../../core/document'

export type WorkspaceDeletionDecision = 'save' | 'discard' | 'cancel'

export type WorkspaceDeletionPhase =
  | 'planning'
  | 'decision'
  | 'save'
  | 'filesystem'
  | 'cleanup'
  | 'refresh'

export interface WorkspaceDeletionEntry {
  readonly kind: WorkspaceEntryKind
  readonly path: WorkspacePath
}

/** A source-free diagnostic snapshot shown by the dirty-deletion prompt. */
export interface WorkspaceDeletionDocument {
  readonly documentId: DocumentId
  readonly path: WorkspacePath
  readonly revision: DocumentState['revision']
  readonly persistedRevision: DocumentState['persistedRevision']
  readonly dirty: boolean
}

export interface WorkspaceDeletionProjection {
  readonly documentId: DocumentId
  readonly projectionId: ProjectionId
  readonly revision: ProjectionState['revision']
  readonly stale: boolean
  readonly degraded: boolean
}

export interface WorkspaceDeletionPlan {
  readonly targetPath: WorkspacePath
  readonly targetKind: WorkspaceEntryKind
  readonly recursive: boolean
  /** Includes the target and every recursively discovered descendant. */
  readonly affectedEntries: readonly WorkspaceDeletionEntry[]
  readonly affectedPaths: readonly WorkspacePath[]
  readonly affectedFilePaths: readonly WorkspacePath[]
  readonly documents: readonly WorkspaceDeletionDocument[]
  readonly tabs: readonly WorkspaceTab[]
  readonly projections: readonly WorkspaceDeletionProjection[]
  readonly persistenceRegistrations: readonly DocumentId[]
  readonly recoveryPaths: readonly WorkspacePath[]
  readonly referenceSources: readonly ReferenceIndexEntry[]
}

export interface WorkspaceDeletionResult {
  readonly deleted: boolean
  readonly decision: WorkspaceDeletionDecision | 'none'
  readonly plan: WorkspaceDeletionPlan
}

export interface WorkspaceProjectionBinding {
  readonly documentId: DocumentId
  readonly projectionId: ProjectionId
  /** Destroys the UI/editor projection, if one is mounted. */
  readonly destroy: () => void | Promise<void>
}

export interface WorkspaceDeletionServiceOptions {
  readonly fileSystem: WorkspaceFileSystemPort
  readonly rootPath?: WorkspacePath | string
  readonly store?: DocumentStore
  readonly tabs?: WorkspaceTabManager
  readonly persistence?: DocumentPersistenceService
  readonly recovery?: WorkspaceRecoveryStore
  readonly referenceGraph?: ReferenceGraph
  readonly referenceIndex?: ReferenceIndex
  readonly getProjectionBindings?: () => readonly WorkspaceProjectionBinding[]
  /** One decision applies to all dirty Documents in this deletion plan. */
  readonly resolveDirty?: (
    plan: WorkspaceDeletionPlan,
  ) => WorkspaceDeletionDecision | PromiseLike<WorkspaceDeletionDecision>
  /** Called only after the filesystem deletion has succeeded. */
  readonly onDeleteCommitted?: (
    plan: WorkspaceDeletionPlan,
  ) => void | Promise<void>
  /** Lets the shell release non-Store registries before Store.unload. */
  readonly onDocumentsUnloaded?: (
    plan: WorkspaceDeletionPlan,
  ) => void | Promise<void>
  /** Tree projection refresh, normally supplied by WorkspaceTreeService. */
  readonly refresh?: () => Promise<unknown>
}

export type WorkspaceDeletionConfiguration = Omit<
  WorkspaceDeletionServiceOptions,
  'fileSystem' | 'rootPath' | 'refresh'
>

function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return 'Unknown workspace deletion failure'
  }
}

function normalizePath(value: WorkspacePath | string, name: string): WorkspacePath {
  try {
    return createWorkspacePath(value)
  } catch (error) {
    throw new TypeError(`${name} is invalid: ${errorMessage(error)}`)
  }
}

function freezeDocument(document: DocumentState): WorkspaceDeletionDocument {
  return Object.freeze({
    documentId: document.id,
    path: normalizePath(document.path, `Document ${document.id} path`),
    revision: document.revision,
    persistedRevision: document.persistedRevision,
    dirty: document.dirty,
  })
}

function freezeEntry(entry: WorkspaceDeletionEntry): WorkspaceDeletionEntry {
  return Object.freeze({ kind: entry.kind, path: entry.path })
}

function freezePlan(input: {
  readonly targetPath: WorkspacePath
  readonly targetKind: WorkspaceEntryKind
  readonly recursive: boolean
  readonly affectedEntries: readonly WorkspaceDeletionEntry[]
  readonly documents: readonly WorkspaceDeletionDocument[]
  readonly tabs: readonly WorkspaceTab[]
  readonly projections: readonly WorkspaceDeletionProjection[]
  readonly persistenceRegistrations: readonly DocumentId[]
  readonly recoveryPaths: readonly WorkspacePath[]
  readonly referenceSources: readonly ReferenceIndexEntry[]
}): WorkspaceDeletionPlan {
  const affectedEntries = Object.freeze(
    [...input.affectedEntries]
      .map(freezeEntry)
      .sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.kind.localeCompare(right.kind),
      ),
  )
  const affectedPaths = Object.freeze(
    [...new Set(affectedEntries.map((entry) => entry.path))].sort((left, right) =>
      left.localeCompare(right),
    ),
  )
  const affectedFilePaths = Object.freeze(
    affectedEntries
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.path)
      .sort((left, right) => left.localeCompare(right)),
  )

  return Object.freeze({
    targetPath: input.targetPath,
    targetKind: input.targetKind,
    recursive: input.recursive,
    affectedEntries,
    affectedPaths,
    affectedFilePaths,
    documents: Object.freeze([...input.documents]),
    tabs: Object.freeze(
      input.tabs.map((tab) => Object.freeze({ documentId: tab.documentId })),
    ),
    projections: Object.freeze([...input.projections]),
    persistenceRegistrations: Object.freeze([
      ...input.persistenceRegistrations,
    ]),
    recoveryPaths: Object.freeze([...input.recoveryPaths]),
    referenceSources: Object.freeze([...input.referenceSources]),
  })
}

function sameDocumentSnapshot(
  left: WorkspaceDeletionDocument,
  right: WorkspaceDeletionDocument,
): boolean {
  return (
    left.documentId === right.documentId &&
    left.path === right.path &&
    left.revision === right.revision &&
    left.persistedRevision === right.persistedRevision &&
    left.dirty === right.dirty
  )
}

function samePathList(
  left: readonly WorkspacePath[],
  right: readonly WorkspacePath[],
): boolean {
  return (
    left.length === right.length &&
    left.every((path, index) => path === right[index])
  )
}

function samePlanRuntimeState(
  left: WorkspaceDeletionPlan,
  right: WorkspaceDeletionPlan,
): boolean {
  return (
    left.targetPath === right.targetPath &&
    left.targetKind === right.targetKind &&
    left.recursive === right.recursive &&
    samePathList(left.affectedPaths, right.affectedPaths) &&
    samePathList(left.affectedFilePaths, right.affectedFilePaths) &&
    left.affectedEntries.length === right.affectedEntries.length &&
    left.affectedEntries.every((entry, index) => {
      const current = right.affectedEntries[index]
      return (
        current !== undefined &&
        current.path === entry.path &&
        current.kind === entry.kind
      )
    }) &&
    left.documents.length === right.documents.length &&
    left.documents.every((document, index) => {
      const current = right.documents[index]
      return current !== undefined && sameDocumentSnapshot(document, current)
    })
  )
}

function isEntry(value: unknown): value is WorkspaceEntry {
  return value !== null && typeof value === 'object'
}

export class WorkspaceDeletionError extends WorkspaceInvalidOperationError {
  readonly code = 'workspace-deletion-failed' as const
  readonly phase: WorkspaceDeletionPhase
  readonly targetPath: WorkspacePath
  readonly affectedPaths: readonly WorkspacePath[]
  readonly affectedDocumentIds: readonly DocumentId[]
  readonly cause: unknown
  readonly rollbackErrors: readonly unknown[]

  constructor(input: {
    readonly phase: WorkspaceDeletionPhase
    readonly targetPath: WorkspacePath
    readonly affectedPaths?: readonly WorkspacePath[]
    readonly affectedDocumentIds?: readonly DocumentId[]
    readonly cause: unknown
    readonly rollbackErrors?: readonly unknown[]
  }) {
    const rollbackErrors = Object.freeze([...(input.rollbackErrors ?? [])])
    const rollbackLabel =
      rollbackErrors.length === 0
        ? ''
        : ` Rollback reported ${rollbackErrors.length} additional failure${rollbackErrors.length === 1 ? '' : 's'}.`
    super(
      `Workspace deletion failed during ${input.phase} for ${input.targetPath || '.'}: ${errorMessage(input.cause)}.${rollbackLabel}`,
    )
    this.name = 'WorkspaceDeletionError'
    this.phase = input.phase
    this.targetPath = input.targetPath
    this.affectedPaths = Object.freeze([...(input.affectedPaths ?? [])])
    this.affectedDocumentIds = Object.freeze([
      ...(input.affectedDocumentIds ?? []),
    ])
    this.cause = input.cause
    this.rollbackErrors = rollbackErrors
  }
}

/**
 * Application command for deleting a file or a recursively discovered
 * directory. It owns the dirty decision and lifecycle cleanup; the tree and
 * UI only provide a projection and a decision surface.
 */
export class WorkspaceDeletionService {
  private readonly fileSystem: WorkspaceFileSystemPort
  private readonly rootPath: WorkspacePath
  private readonly store: DocumentStore | undefined
  private readonly tabs: WorkspaceTabManager | undefined
  private readonly persistence: DocumentPersistenceService | undefined
  private readonly recovery: WorkspaceRecoveryStore | undefined
  private readonly referenceGraph: ReferenceGraph | undefined
  private readonly referenceIndex: ReferenceIndex | undefined
  private readonly getProjectionBindings:
    | (() => readonly WorkspaceProjectionBinding[])
    | undefined
  private readonly resolveDirty: WorkspaceDeletionServiceOptions['resolveDirty']
  private readonly onDeleteCommitted: WorkspaceDeletionServiceOptions['onDeleteCommitted']
  private readonly onDocumentsUnloaded: WorkspaceDeletionServiceOptions['onDocumentsUnloaded']
  private readonly refresh: WorkspaceDeletionServiceOptions['refresh']

  constructor(options: WorkspaceDeletionServiceOptions) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('Workspace deletion options are required')
    }
    this.fileSystem = options.fileSystem
    this.rootPath = normalizePath(options.rootPath ?? '', 'Workspace root')
    this.store = options.store
    this.tabs = options.tabs
    this.persistence = options.persistence
    this.recovery = options.recovery
    this.referenceGraph = options.referenceGraph
    this.referenceIndex = options.referenceIndex
    this.getProjectionBindings = options.getProjectionBindings
    this.resolveDirty = options.resolveDirty
    this.onDeleteCommitted = options.onDeleteCommitted
    this.onDocumentsUnloaded = options.onDocumentsUnloaded
    this.refresh = options.refresh

    if (!this.fileSystem || typeof this.fileSystem.deleteEntry !== 'function') {
      throw new TypeError('Workspace deletion requires a filesystem port')
    }
    if (this.persistence && !this.store) {
      throw new TypeError('Workspace deletion persistence requires a DocumentStore')
    }
    if (this.tabs && !this.store) {
      throw new TypeError('Workspace deletion tabs require a DocumentStore')
    }
  }

  async plan(
    path: WorkspacePath | string,
    options: { readonly recursive?: boolean } = {},
  ): Promise<WorkspaceDeletionPlan> {
    try {
      return (await this.collectRuntimePlan(path, options)).plan
    } catch (error) {
      if (error instanceof WorkspaceDeletionError) throw error
      throw this.failure(
        'planning',
        this.emptyPlan(this.safePath(path), 'file', options.recursive ?? true),
        error,
      )
    }
  }

  /** Descriptive alias used by application command callers. */
  async planDeletion(
    path: WorkspacePath | string,
    options: { readonly recursive?: boolean } = {},
  ): Promise<WorkspaceDeletionPlan> {
    return this.plan(path, options)
  }

  async delete(
    path: WorkspacePath | string,
    options: { readonly recursive?: boolean } = { recursive: true },
  ): Promise<WorkspaceDeletionResult> {
    const targetPath = this.safePath(path)
    const recursive = options.recursive ?? true
    const candidateDocumentIds = this.store
      ? this.store.getAll().flatMap((document) => {
          const documentPath = normalizePath(
            document.path,
            `Document ${document.id} path`,
          )
          return isWorkspacePathWithin(documentPath, targetPath)
            ? [document.id]
            : []
        })
      : []
    const candidateSet = new Set(candidateDocumentIds)

    const execute = async (): Promise<WorkspaceDeletionResult> => {
      let initial: {
        readonly plan: WorkspaceDeletionPlan
        readonly bindings: readonly WorkspaceProjectionBinding[]
      }
      try {
        initial = await this.collectRuntimePlan(path, options)
      } catch (error) {
        if (error instanceof WorkspaceDeletionError) throw error
        throw this.failure(
          'planning',
          this.emptyPlan(targetPath, 'file', recursive),
          error,
        )
      }
      if (
        this.store &&
        initial.plan.documents.some(
          (document) => !candidateSet.has(document.documentId),
        )
      ) {
        throw this.failure(
          'planning',
          initial.plan,
          new Error('A Document was loaded while deletion was being planned'),
        )
      }

      const current = await this.collectRuntimePlan(path, options)
      if (!samePlanRuntimeState(initial.plan, current.plan)) {
        throw this.failure(
          'planning',
          current.plan,
          new Error('Workspace deletion plan became stale before execution'),
        )
      }
      return this.executePlan(current)
    }

    if (this.persistence) {
      try {
        return await this.persistence.runDeletionExclusive(
          candidateDocumentIds,
          execute,
        )
      } catch (error) {
        if (error instanceof WorkspaceDeletionError) throw error
        throw this.failure(
          'planning',
          this.emptyPlan(targetPath, 'file', recursive),
          error,
        )
      }
    }

    try {
      return await execute()
    } catch (error) {
      if (error instanceof WorkspaceDeletionError) throw error
      throw this.failure(
        'planning',
        this.emptyPlan(targetPath, 'file', recursive),
        error,
      )
    }
  }

  /** Explicit alias for callers avoiding the JavaScript `delete` keyword. */
  async deleteEntry(
    path: WorkspacePath | string,
    options: { readonly recursive?: boolean } = { recursive: true },
  ): Promise<WorkspaceDeletionResult> {
    return this.delete(path, options)
  }

  private async collectRuntimePlan(
    path: WorkspacePath | string,
    options: { readonly recursive?: boolean },
  ): Promise<{ readonly plan: WorkspaceDeletionPlan; readonly bindings: readonly WorkspaceProjectionBinding[] }> {
    const targetPath = normalizePath(path, 'Workspace deletion target')
    if (
      targetPath === this.rootPath ||
      !isWorkspacePathWithin(targetPath, this.rootPath)
    ) {
      throw this.failure(
        'planning',
        this.emptyPlan(targetPath, 'file', options.recursive ?? true),
        new WorkspaceInvalidOperationError(
          'The workspace root or an outside path cannot be deleted',
        ),
      )
    }

    const recursive = options.recursive ?? true
    if (typeof recursive !== 'boolean') {
      throw this.failure(
        'planning',
        this.emptyPlan(targetPath, 'file', true),
        new TypeError('Workspace deletion recursive option must be boolean'),
      )
    }

    let entries: readonly WorkspaceDeletionEntry[]
    try {
      const target = await this.readDirectEntry(targetPath)
      const collected: WorkspaceDeletionEntry[] = [
        freezeEntry({ kind: target.kind, path: target.path }),
      ]
      if (target.kind === 'directory') {
        await this.collectDirectoryEntries(target.path, collected)
      }
      const seenPaths = new Set<WorkspacePath>()
      for (const entry of collected) {
        if (seenPaths.has(entry.path)) {
          throw new Error(`Filesystem returned duplicate workspace entry ${entry.path}`)
        }
        seenPaths.add(entry.path)
      }
      entries = Object.freeze(collected)
    } catch (error) {
      throw this.failure(
        'planning',
        this.emptyPlan(targetPath, 'file', recursive),
        error,
      )
    }

    const filePaths = new Set(
      entries
        .filter((entry) => entry.kind === 'file')
        .map((entry) => entry.path),
    )
    const documents: WorkspaceDeletionDocument[] = []
    const documentIds = new Set<DocumentId>()
    if (this.store) {
      for (const document of this.store.getAll()) {
        const documentPath = normalizePath(
          document.path,
          `Document ${document.id} path`,
        )
        if (!filePaths.has(documentPath)) continue
        documents.push(freezeDocument(document))
        documentIds.add(document.id)
      }
    }
    documents.sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.documentId.localeCompare(right.documentId),
    )

    const tabs = this.tabs
      ? this.tabs
          .getSnapshot()
          .tabs.filter((tab) => documentIds.has(tab.documentId))
      : []

    const projections: WorkspaceDeletionProjection[] = []
    if (this.store) {
      for (const document of documents) {
        for (const projection of this.store.getProjections(
          documentById(document.documentId),
        )) {
          projections.push(
            Object.freeze({
              documentId: document.documentId,
              projectionId: projection.projectionId,
              revision: projection.revision,
              stale: projection.stale,
              degraded: projection.degraded,
            }),
          )
        }
      }
    }
    projections.sort(
      (left, right) =>
        left.documentId.localeCompare(right.documentId) ||
        left.projectionId.localeCompare(right.projectionId),
    )

    let bindings: readonly WorkspaceProjectionBinding[] = Object.freeze([])
    if (this.getProjectionBindings) {
      try {
        const supplied = this.getProjectionBindings()
        if (!Array.isArray(supplied)) {
          throw new TypeError('Workspace projection bindings must be an array')
        }
        const seen = new Set<string>()
        const normalized: WorkspaceProjectionBinding[] = []
        for (const [index, binding] of supplied.entries()) {
          if (binding === null || typeof binding !== 'object') {
            throw new TypeError(
              `Workspace projection binding at index ${index} is invalid`,
            )
          }
          if (!isDocumentId(binding.documentId)) {
            throw new TypeError(
              `Workspace projection binding at index ${index} has an invalid documentId`,
            )
          }
          if (
            typeof binding.projectionId !== 'string' ||
            binding.projectionId.trim().length === 0
          ) {
            throw new TypeError(
              `Workspace projection binding ${binding.documentId} has an invalid projectionId`,
            )
          }
          if (typeof binding.destroy !== 'function') {
            throw new TypeError(
              `Workspace projection binding ${binding.documentId}/${binding.projectionId} has no destroy function`,
            )
          }
          if (!documentIds.has(binding.documentId)) continue
          const key = `${binding.documentId}\u0000${binding.projectionId}`
          if (seen.has(key)) continue
          seen.add(key)
          normalized.push(binding)
        }
        normalized.sort(
          (left, right) =>
            left.documentId.localeCompare(right.documentId) ||
            left.projectionId.localeCompare(right.projectionId),
        )
        bindings = Object.freeze(normalized)
      } catch (error) {
        throw this.failure(
          'planning',
          this.emptyPlan(targetPath, 'file', recursive),
          error,
        )
      }
    }

    const persistenceRegistrations = this.persistence
      ? this.persistence
          .getTrackedDocumentIds()
          .filter((documentId) => documentIds.has(documentId))
      : []

    let recoveryPaths: readonly WorkspacePath[] = Object.freeze([])
    if (this.recovery) {
      try {
        const snapshot = this.recovery.getSnapshot()
        recoveryPaths = Object.freeze(
          [
            ...snapshot.openDocumentPaths,
            ...(snapshot.activeDocumentPath === null
              ? []
              : [snapshot.activeDocumentPath]),
            ...(snapshot.selectedWorkspacePath === null
              ? []
              : [snapshot.selectedWorkspacePath]),
          ]
            .map((candidate) => normalizePath(candidate, 'Recovery path'))
            .filter((candidate, index, all) =>
              isWorkspacePathWithin(candidate, targetPath) &&
              all.indexOf(candidate) === index,
            )
            .sort((left, right) => left.localeCompare(right)),
        )
      } catch (error) {
        throw this.failure(
          'planning',
          this.emptyPlan(targetPath, 'file', recursive),
          error,
        )
      }
    }

    const referenceSources = this.collectReferenceSources(filePaths)
    const plan = freezePlan({
      targetPath,
      targetKind:
        entries.find((entry) => entry.path === targetPath)?.kind ?? 'file',
      recursive,
      affectedEntries: entries,
      documents,
      tabs,
      projections,
      persistenceRegistrations,
      recoveryPaths,
      referenceSources,
    })
    return { plan, bindings }
  }

  private collectReferenceSources(
    filePaths: ReadonlySet<WorkspacePath>,
  ): readonly ReferenceIndexEntry[] {
    const index = this.referenceGraph?.getIndex() ?? this.referenceIndex
    if (!index) return Object.freeze([])
    return Object.freeze(
      index
        .getAll()
        .filter((entry) => filePaths.has(entry.sourcePath))
        .sort(
          (left, right) =>
            left.sourcePath.localeCompare(right.sourcePath) ||
            (left.sourceId ?? '').localeCompare(right.sourceId ?? ''),
        ),
    )
  }

  private async readDirectEntry(targetPath: WorkspacePath): Promise<WorkspaceEntry> {
    const parentPath = workspaceParent(targetPath)
    const entries = await this.fileSystem.listDirectory(parentPath)
    for (const entry of entries) {
      if (!isEntry(entry)) {
        throw new Error(`Filesystem returned an invalid entry under ${parentPath}`)
      }
      let path: WorkspacePath
      try {
        path = createWorkspacePath(entry.path)
      } catch {
        throw new Error(`Filesystem returned an invalid path under ${parentPath}`)
      }
      if (path === '' || workspaceParent(path) !== parentPath) {
        throw new Error(`Filesystem returned a non-direct entry under ${parentPath}`)
      }
      if (entry.kind !== 'file' && entry.kind !== 'directory') {
        throw new Error(`Filesystem returned an invalid kind under ${parentPath}`)
      }
      if (path !== targetPath) continue
      return Object.freeze({
        kind: entry.kind,
        path,
        name: entry.name,
      })
    }
    throw new WorkspaceEntryNotFoundError(targetPath)
  }

  private async collectDirectoryEntries(
    directory: WorkspacePath,
    output: WorkspaceDeletionEntry[],
  ): Promise<void> {
    const entries = await this.fileSystem.listDirectory(directory)
    for (const entry of entries) {
      if (!isEntry(entry)) {
        throw new Error(`Filesystem returned an invalid entry under ${directory}`)
      }
      const path = createWorkspacePath(entry.path)
      if (path === '' || workspaceParent(path) !== directory) {
        throw new Error(`Filesystem returned a non-direct entry under ${directory}`)
      }
      if (entry.kind !== 'file' && entry.kind !== 'directory') {
        throw new Error(`Filesystem returned an invalid kind under ${directory}`)
      }
      output.push(freezeEntry({ kind: entry.kind, path }))
      if (entry.kind === 'directory') {
        await this.collectDirectoryEntries(path, output)
      }
    }
  }

  private async executePlan(
    runtime: { readonly plan: WorkspaceDeletionPlan; readonly bindings: readonly WorkspaceProjectionBinding[] },
  ): Promise<WorkspaceDeletionResult> {
    const { plan } = runtime
    const dirtyDocuments = plan.documents.filter((document) => document.dirty)
    let decision: WorkspaceDeletionResult['decision'] = 'none'
    if (dirtyDocuments.length > 0) {
      let resolved: WorkspaceDeletionDecision = 'cancel'
      if (this.resolveDirty) {
        try {
          resolved = await this.resolveDirty(plan)
        } catch (error) {
          throw this.failure('decision', plan, error)
        }
      }
      if (resolved !== 'save' && resolved !== 'discard' && resolved !== 'cancel') {
        throw this.failure(
          'decision',
          plan,
          new TypeError('Workspace deletion decision must be save, discard, or cancel'),
        )
      }
      decision = resolved
      if (resolved === 'cancel') {
        return Object.freeze({ deleted: false, decision, plan })
      }
    }

    this.assertCurrentDocuments(plan)

    let saveTransaction: PersistenceDeletionSaveTransaction | undefined
    if (decision === 'save') {
      if (!this.persistence) {
        throw this.failure(
          'save',
          plan,
          new Error('No persistence policy is available to save dirty Documents'),
        )
      }
      const untracked = dirtyDocuments.filter(
        (document) =>
          !this.persistence?.isTracked(documentById(document.documentId)),
      )
      if (untracked.length > 0) {
        throw this.failure(
          'save',
          plan,
          new Error(
            `Dirty Documents are not persistence-registered: ${untracked
              .map((document) => document.documentId)
              .join(', ')}`,
          ),
        )
      }
      try {
        saveTransaction = await this.persistence.prepareDeletionSave(
          dirtyDocuments.map((document) => document.documentId),
        )
      } catch (error) {
        throw this.failure('save', plan, error)
      }
    }

    try {
      await this.fileSystem.deleteEntry(plan.targetPath, {
        recursive: plan.recursive,
      })
    } catch (error) {
      const rollbackErrors: unknown[] = []
      if (saveTransaction) {
        try {
          await saveTransaction.rollback()
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      throw this.failure('filesystem', plan, error, rollbackErrors)
    }
    saveTransaction?.commit()

    const cleanupErrors: unknown[] = []
    await this.runCleanupStep(cleanupErrors, 'projection shell cleanup', () =>
      this.onDeleteCommitted?.(plan),
    )
    for (const binding of runtime.bindings) {
      await this.runCleanupStep(
        cleanupErrors,
        `projection ${binding.documentId}/${binding.projectionId}`,
        () => binding.destroy(),
      )
    }

    if (this.store) {
      for (const projection of plan.projections) {
        await this.runCleanupStep(
          cleanupErrors,
          `detach projection ${projection.documentId}/${projection.projectionId}`,
          () => {
            const document = this.store?.get(
              documentById(projection.documentId),
            )
            if (!document) return
            try {
              this.store?.detachProjection(
                documentById(projection.documentId),
                projection.projectionId,
              )
            } catch (error) {
              if (error instanceof Error && error.name === 'ProjectionNotFoundError') return
              throw error
            }
          },
        )
      }
    }

    await this.runCleanupStep(cleanupErrors, 'shell registry cleanup', () =>
      this.onDocumentsUnloaded?.(plan),
    )

    if (this.tabs) {
      for (const tab of plan.tabs) {
        await this.runCleanupStep(cleanupErrors, `close tab ${tab.documentId}`, () => {
          if (this.tabs?.isOpen(tab.documentId)) this.tabs.close(tab.documentId)
        })
      }
    }

    if (this.persistence) {
      for (const documentId of plan.persistenceRegistrations) {
        await this.runCleanupStep(cleanupErrors, `untrack ${documentId}`, () => {
          if (!this.persistence?.untrack(documentById(documentId))) {
            throw new Error(`Persistence registration ${documentId} disappeared before cleanup`)
          }
        })
      }
    }

    if (this.recovery && plan.recoveryPaths.length > 0) {
      await this.runCleanupStep(cleanupErrors, 'recovery cleanup', () => {
        this.recovery?.removePaths(plan.affectedPaths)
      })
    }

    await this.runCleanupStep(cleanupErrors, 'reference index cleanup', () =>
      this.cleanupReferences(plan),
    )

    if (this.store) {
      for (const document of plan.documents) {
        await this.runCleanupStep(cleanupErrors, `unload ${document.documentId}`, () => {
          const current = this.store?.get(documentById(document.documentId))
          if (!current) return
          this.store?.unload(documentById(document.documentId))
        })
      }
    }

    let refreshError: unknown
    if (this.refresh) {
      try {
        await this.refresh()
      } catch (error) {
        refreshError = error
      }
    }

    if (cleanupErrors.length > 0) {
      throw this.failure(
        'cleanup',
        plan,
        new Error(
          `Deletion completed in filesystem but ${cleanupErrors.length} cleanup step${cleanupErrors.length === 1 ? '' : 's'} failed`,
        ),
        cleanupErrors,
      )
    }
    if (refreshError !== undefined) {
      throw this.failure('refresh', plan, refreshError)
    }

    return Object.freeze({ deleted: true, decision, plan })
  }

  private assertCurrentDocuments(plan: WorkspaceDeletionPlan): void {
    if (!this.store) return
    for (const expected of plan.documents) {
      const current = this.store.get(documentById(expected.documentId))
      if (!current || !sameDocumentSnapshot(expected, freezeDocument(current))) {
        throw this.failure(
          'decision',
          plan,
          new Error(
            `Document ${expected.documentId} changed while the deletion decision was pending`,
          ),
        )
      }
    }
  }

  private cleanupReferences(plan: WorkspaceDeletionPlan): void {
    const affectedFiles = new Set(plan.affectedFilePaths)
    const removeSources = (index: ReferenceIndex): void => {
      for (const source of index
        .getAll()
        .filter((entry) => affectedFiles.has(entry.sourcePath))) {
        index.removeDocument({
          kind: 'path',
          path: source.sourcePath,
        })
      }
    }

    if (this.referenceGraph) {
      removeSources(this.referenceGraph.getIndex())
      const remaining = this.referenceGraph
        .getWorkspacePaths()
        .filter((path) => !isWorkspacePathWithin(path, plan.targetPath))
      this.referenceGraph.setWorkspacePaths(remaining)
    }
    if (this.referenceIndex && this.referenceIndex !== this.referenceGraph?.getIndex()) {
      removeSources(this.referenceIndex)
    }
  }

  private async runCleanupStep(
    errors: unknown[],
    _label: string,
    step: () => void | Promise<void> | undefined,
  ): Promise<void> {
    try {
      await step()
    } catch (error) {
      errors.push(error)
    }
  }

  private emptyPlan(
    targetPath: WorkspacePath,
    targetKind: WorkspaceEntryKind,
    recursive: boolean,
  ): WorkspaceDeletionPlan {
    return freezePlan({
      targetPath,
      targetKind,
      recursive,
      affectedEntries: [],
      documents: [],
      tabs: [],
      projections: [],
      persistenceRegistrations: [],
      recoveryPaths: [],
      referenceSources: [],
    })
  }

  private safePath(path: WorkspacePath | string): WorkspacePath {
    try {
      return normalizePath(path, 'Workspace deletion target')
    } catch {
      return '' as WorkspacePath
    }
  }

  private failure(
    phase: WorkspaceDeletionPhase,
    plan: WorkspaceDeletionPlan,
    cause: unknown,
    rollbackErrors: readonly unknown[] = [],
  ): WorkspaceDeletionError {
    if (cause instanceof WorkspaceDeletionError) return cause
    return new WorkspaceDeletionError({
      phase,
      targetPath: plan.targetPath,
      affectedPaths: plan.affectedPaths,
      affectedDocumentIds: plan.documents.map(
        (document) => document.documentId,
      ),
      cause,
      rollbackErrors,
    })
  }
}
