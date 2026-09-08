import {
  createDocumentOrigin,
  createDocumentPath,
  DocumentStore,
  documentById,
  type DocumentId,
  type DocumentState,
  type Revision,
} from '../../core/document'
import {
  collectWorkspaceFilePaths,
  parseReferences,
  resolveReference,
  stringifyReference,
  ReferenceGraph,
  type ParsedReference,
  type ReferenceIndexEntry,
  type ReferenceResolutionOptions,
} from '../../core/reference'
import {
  createWorkspacePath,
  isWorkspacePathWithin,
  workspaceJoin,
  workspaceName,
  workspaceParent,
} from '../../core/workspace'
import type { WorkspacePath } from '../../core/workspace'
import {
  DocumentPersistenceService,
  isPersistenceTracked,
} from '../persistence'
import type { PersistenceRebindPathOptions } from '../persistence'
import type { WorkspaceFileSystemPort } from '../../platform/filesystem'
import { WorkspaceEntryAlreadyExistsError } from '../../platform/filesystem'

export type ReferenceRenameOperation = 'rename' | 'move'

/**
 * `preserve` keeps an incoming token's relative/basename spelling when the
 * result remains an unambiguous reference, but records a canonical path when
 * the old spelling would remain byte-for-byte unchanged after a move.
 * Otherwise the workspace path is used. `workspace-relative` always writes
 * that path.
 */
export type ReferenceRenamePathStrategy =
  | 'preserve'
  | 'workspace-relative'

export interface ReferenceRenameServiceOptions {
  readonly fileSystem: WorkspaceFileSystemPort
  readonly store?: DocumentStore
  readonly graph?: ReferenceGraph
  readonly persistence?: DocumentPersistenceService
  /** Workspace root used by the tree/filesystem adapter. */
  readonly rootPath?: WorkspacePath | string
  readonly pathStrategy?: ReferenceRenamePathStrategy
  readonly resolution?: Pick<
    ReferenceResolutionOptions,
    'extensions' | 'basenameSearch'
  >
}

type ReferenceRenameServiceDependencies = Omit<
  ReferenceRenameServiceOptions,
  'fileSystem'
>

export interface ReferenceRenameConflict {
  readonly kind:
    | 'target-exists'
    | 'dirty-document'
    | 'external-change'
    | 'missing-document-file'
  readonly path: WorkspacePath
  readonly documentId?: DocumentId
  readonly message: string
}

export interface ReferenceRenameDocumentUpdate {
  readonly sourcePath: WorkspacePath
  readonly referenceCount: number
  readonly documentId?: DocumentId
  readonly revision?: Revision
}

export interface ReferenceRenameResult {
  readonly operation: ReferenceRenameOperation
  readonly sourcePath: WorkspacePath
  readonly targetPath: WorkspacePath
  readonly renamedDocumentId?: DocumentId
  /** Number of incoming source tokens replaced in this transaction. */
  readonly updatedReferences: number
  readonly updatedReferenceCount: number
  readonly updatedDocuments: readonly ReferenceRenameDocumentUpdate[]
  readonly updatedDocumentCount: number
}

export interface ReferenceRenameErrorOptions {
  readonly sourcePath?: WorkspacePath
  readonly targetPath?: WorkspacePath
  readonly cause?: unknown
}

export class ReferenceRenameError extends Error {
  readonly sourcePath?: WorkspacePath
  readonly targetPath?: WorkspacePath
  readonly cause?: unknown

  constructor(
    message: string,
    options: ReferenceRenameErrorOptions = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'ReferenceRenameError'
    this.sourcePath = options.sourcePath
    this.targetPath = options.targetPath
    this.cause = options.cause
  }
}

export class ReferenceRenameValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceRenameValidationError'
  }
}

export class ReferenceRenameUnsupportedError extends ReferenceRenameError {
  constructor(
    message: string,
    options: ReferenceRenameErrorOptions = {},
  ) {
    super(message, options)
    this.name = 'ReferenceRenameUnsupportedError'
  }
}

export class ReferenceRenameConflictError extends ReferenceRenameError {
  readonly conflicts: readonly ReferenceRenameConflict[]

  constructor(
    conflicts: readonly ReferenceRenameConflict[],
    options: ReferenceRenameErrorOptions = {},
  ) {
    const first = conflicts[0]?.message ?? 'Reference rename conflict'
    super(first, options)
    this.name = 'ReferenceRenameConflictError'
    this.conflicts = Object.freeze([...conflicts])
  }
}

export class ReferenceRenamePreflightError extends ReferenceRenameError {
  constructor(
    message: string,
    options: ReferenceRenameErrorOptions = {},
  ) {
    super(message, options)
    this.name = 'ReferenceRenamePreflightError'
  }
}

/** Failure before a filesystem mutation could be observed as committed. */
export class ReferenceRenameFilesystemError extends ReferenceRenameError {
  constructor(
    message: string,
    options: ReferenceRenameErrorOptions = {},
  ) {
    super(message, options)
    this.name = 'ReferenceRenameFilesystemError'
  }
}

/**
 * A post-rename failure. The service always attempts to restore both the
 * filesystem and Store state; callers can inspect whether that compensation
 * completed instead of receiving a silently half-linked workspace.
 */
export class ReferenceRenameTransactionError extends ReferenceRenameError {
  readonly rollbackAttempted: boolean
  readonly rollbackSucceeded: boolean

  constructor(input: {
    readonly message: string
    readonly sourcePath: WorkspacePath
    readonly targetPath: WorkspacePath
    readonly cause: unknown
    readonly rollbackAttempted: boolean
    readonly rollbackSucceeded: boolean
  }) {
    super(input.message, {
      sourcePath: input.sourcePath,
      targetPath: input.targetPath,
      cause: input.cause,
    })
    this.name = 'ReferenceRenameTransactionError'
    this.rollbackAttempted = input.rollbackAttempted
    this.rollbackSucceeded = input.rollbackSucceeded
  }
}

interface ContentUpdate {
  readonly sourcePath: WorkspacePath
  readonly originalMarkdown: string
  readonly updatedMarkdown: string
  readonly referenceCount: number
  readonly document?: DocumentState
}

interface RenamePlan {
  readonly operation: ReferenceRenameOperation
  readonly sourcePath: WorkspacePath
  readonly targetPath: WorkspacePath
  readonly availablePaths: readonly WorkspacePath[]
  readonly sourceContents: ReadonlyMap<WorkspacePath, string>
  readonly loadedByPath: ReadonlyMap<WorkspacePath, DocumentState>
  readonly contentUpdates: readonly ContentUpdate[]
}

interface AppliedSourceChange {
  readonly before: DocumentState
  readonly after: DocumentState
}

interface StoreTransaction {
  readonly originals: Map<DocumentId, DocumentState>
  readonly sourceChanges: AppliedSourceChange[]
  targetDocumentId?: DocumentId
}

interface FilesystemMoveState {
  movedPath: WorkspacePath
}

function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return 'Unknown rename failure'
  }
}

function normalizePath(value: unknown, name: string): WorkspacePath {
  if (typeof value !== 'string') {
    throw new ReferenceRenameValidationError(`${name} must be a workspace path`)
  }
  try {
    return createWorkspacePath(value)
  } catch (error) {
    throw new ReferenceRenameValidationError(
      `${name} is invalid: ${errorMessage(error)}`,
    )
  }
}

function requireFilePath(value: unknown, name: string): WorkspacePath {
  const path = normalizePath(value, name)
  if (path === '') {
    throw new ReferenceRenameValidationError(`${name} must identify a file`)
  }
  return path
}

function requireName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ReferenceRenameValidationError(
      'Reference rename name must be non-empty',
    )
  }
  return value
}

function isWorkspaceFileSystemPort(
  value: unknown,
): value is WorkspaceFileSystemPort {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.readFile === 'function' &&
    typeof candidate.writeFile === 'function' &&
    typeof candidate.listDirectory === 'function' &&
    typeof candidate.renameEntry === 'function' &&
    typeof candidate.moveEntry === 'function'
  )
}

function isReferenceDocumentPath(path: WorkspacePath): boolean {
  const name = workspaceName(path)
  return /\.(?:md|markdown|txt)$/iu.test(name) || !name.includes('.')
}

function normalizeLoadedDocuments(
  store: DocumentStore | undefined,
  rootPath: WorkspacePath,
): ReadonlyMap<WorkspacePath, DocumentState> {
  if (!store) return new Map()
  const loaded = new Map<WorkspacePath, DocumentState>()
  for (const document of store.getAll()) {
    try {
      const path = createWorkspacePath(document.path)
      if (
        path !== '' &&
        isWorkspacePathWithin(path, rootPath) &&
        !loaded.has(path)
      ) {
        loaded.set(path, document)
      }
    } catch {
      // Documents outside this workspace are not affected by its tree moves.
    }
  }
  return loaded
}

function pathHasExtension(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1
}

function removeFinalExtension(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot > 0 ? path.slice(0, dot) : path
}

function isExplicitRelativePath(path: string): boolean {
  return path === '.' || path === '..' || path.startsWith('./') || path.startsWith('../')
}

function relativeReferencePath(
  sourcePath: WorkspacePath,
  targetPath: WorkspacePath,
): string {
  const from = workspaceParent(sourcePath).split('/').filter(Boolean)
  const target = targetPath.split('/').filter(Boolean)
  let common = 0
  while (common < from.length && common < target.length && from[common] === target[common]) {
    common++
  }
  const segments = [
    ...Array.from({ length: from.length - common }, () => '..'),
    ...target.slice(common),
  ]
  const relative = segments.join('/')
  return from.length === common ? `./${relative}` : relative
}

function syntheticReference(
  reference: ParsedReference,
  path: string,
): ParsedReference {
  return Object.freeze({ ...reference, path })
}

function referencePathAfterRename(
  reference: ParsedReference,
  sourcePath: WorkspacePath,
  targetPath: WorkspacePath,
  availableAfterRename: readonly WorkspacePath[],
  pathStrategy: ReferenceRenamePathStrategy,
  resolution: Pick<ReferenceResolutionOptions, 'extensions' | 'basenameSearch'>,
): string {
  if (pathStrategy === 'workspace-relative') return targetPath

  let candidate: string
  if (isExplicitRelativePath(reference.path)) {
    candidate = relativeReferencePath(sourcePath, targetPath)
  } else if (reference.path.includes('/')) {
    candidate = targetPath
  } else {
    const name = workspaceName(targetPath)
    candidate = pathHasExtension(reference.path) ? name : removeFinalExtension(name)
  }

  try {
    const resolved = resolveReference(
      syntheticReference(reference, candidate),
      availableAfterRename,
      {
        ...resolution,
        hostPath: sourcePath,
      },
    )
    if (resolved.status === 'resolved' && resolved.resolvedPath === targetPath) {
      return candidate
    }
  } catch {
    // Fall back to a direct workspace path below. The source token remains
    // valid even when a custom resolver configuration is temporarily invalid.
  }
  return targetPath
}

function rewriteMarkdownReferences(
  sourcePath: WorkspacePath,
  markdown: string,
  oldTargetPath: WorkspacePath,
  newTargetPath: WorkspacePath,
  availablePaths: readonly WorkspacePath[],
  pathStrategy: ReferenceRenamePathStrategy,
  resolution: Pick<ReferenceResolutionOptions, 'extensions' | 'basenameSearch'>,
): { readonly markdown: string; readonly referenceCount: number } {
  const availableAfterRename = Object.freeze(
    availablePaths
      .filter((path) => path !== oldTargetPath)
      .concat(newTargetPath),
  )
  const replacements: Array<{
    readonly from: number
    readonly to: number
    readonly insert: string
  }> = []

  for (const reference of parseReferences(markdown)) {
    const resolved = resolveReference(reference, availablePaths, {
      ...resolution,
      hostPath: sourcePath,
    })
    if (
      resolved.status !== 'resolved' ||
      resolved.resolvedPath !== oldTargetPath
    ) {
      continue
    }

    const path = referencePathAfterRename(
      reference,
      sourcePath,
      newTargetPath,
      availableAfterRename,
      pathStrategy,
      resolution,
    )
    let replacement = stringifyReference({
      kind: reference.kind,
      path,
      fragment: reference.fragment,
      readonly: reference.readonly,
    })
    // A basename alias can remain resolvable after a move even though its
    // exact path disappeared. Linkage still records the path transition: use
    // the canonical workspace path when preserving the old spelling would
    // leave the token byte-for-byte unchanged.
    if (replacement === reference.raw) {
      replacement = stringifyReference({
        kind: reference.kind,
        path: newTargetPath,
        fragment: reference.fragment,
        readonly: reference.readonly,
      })
    }
    if (replacement === reference.raw) continue
    replacements.push({
      from: reference.from,
      to: reference.to,
      insert: replacement,
    })
  }

  if (replacements.length === 0) {
    return Object.freeze({ markdown, referenceCount: 0 })
  }

  let updated = markdown
  for (const replacement of [...replacements].reverse()) {
    updated =
      updated.slice(0, replacement.from) +
      replacement.insert +
      updated.slice(replacement.to)
  }
  return Object.freeze({
    markdown: updated,
    referenceCount: replacements.length,
  })
}

function createResult(
  plan: RenamePlan,
  renamedDocumentId: DocumentId | undefined,
  finalDocuments?: ReadonlyMap<DocumentId, DocumentState>,
): ReferenceRenameResult {
  const updates = Object.freeze(
    plan.contentUpdates.map((update) =>
      Object.freeze({
        sourcePath: update.sourcePath,
        referenceCount: update.referenceCount,
        ...(update.document === undefined
          ? {}
          : {
              documentId: update.document.id,
              revision:
                finalDocuments?.get(update.document.id)?.revision ??
                update.document.revision,
            }),
      }),
    ),
  )
  const updatedReferences = updates.reduce(
    (count, update) => count + update.referenceCount,
    0,
  )
  return Object.freeze({
    operation: plan.operation,
    sourcePath: plan.sourcePath,
    targetPath: plan.targetPath,
    ...(renamedDocumentId === undefined ? {} : { renamedDocumentId }),
    updatedReferences,
    updatedReferenceCount: updatedReferences,
    updatedDocuments: updates,
    updatedDocumentCount: updates.length,
  })
}

/**
 * Application policy for renaming/moving a file without silently breaking
 * incoming Markdown references. It preflights all reference-bearing files,
 * rejects dirty or externally changed loaded sources, then compensates a
 * post-filesystem failure by restoring the original files and Store state.
 */
export class ReferenceRenameService {
  private readonly fileSystem: WorkspaceFileSystemPort
  private readonly store?: DocumentStore
  private readonly graph?: ReferenceGraph
  private readonly persistence?: DocumentPersistenceService
  private readonly rootPath: WorkspacePath
  private readonly pathStrategy: ReferenceRenamePathStrategy
  private readonly resolution: Pick<
    ReferenceResolutionOptions,
    'extensions' | 'basenameSearch'
  >
  private operationTail: Promise<unknown> = Promise.resolve()

  constructor(options: ReferenceRenameServiceOptions)
  constructor(
    fileSystem: WorkspaceFileSystemPort,
    options?: ReferenceRenameServiceDependencies,
  )
  constructor(
    fileSystemOrOptions:
      | WorkspaceFileSystemPort
      | ReferenceRenameServiceOptions,
    options: ReferenceRenameServiceDependencies = {},
  ) {
    const normalized: ReferenceRenameServiceOptions = isWorkspaceFileSystemPort(
      fileSystemOrOptions,
    )
      ? { ...options, fileSystem: fileSystemOrOptions }
      : fileSystemOrOptions

    if (!isWorkspaceFileSystemPort(normalized?.fileSystem)) {
      throw new ReferenceRenameValidationError(
        'Reference rename requires a workspace filesystem port',
      )
    }
    if (normalized.store !== undefined && !(normalized.store instanceof DocumentStore)) {
      throw new ReferenceRenameValidationError(
        'Reference rename store must be a DocumentStore',
      )
    }
    if (
      normalized.persistence !== undefined &&
      !(normalized.persistence instanceof DocumentPersistenceService)
    ) {
      throw new ReferenceRenameValidationError(
        'Reference rename persistence must be a DocumentPersistenceService',
      )
    }
    if (normalized.persistence !== undefined && normalized.store === undefined) {
      throw new ReferenceRenameValidationError(
        'Reference rename persistence requires a DocumentStore',
      )
    }
    if (normalized.graph !== undefined && !(normalized.graph instanceof ReferenceGraph)) {
      throw new ReferenceRenameValidationError(
        'Reference rename graph must be a ReferenceGraph',
      )
    }

    this.fileSystem = normalized.fileSystem
    this.store = normalized.store
    this.graph = normalized.graph
    this.persistence = normalized.persistence
    this.rootPath = normalizePath(normalized.rootPath ?? '', 'Reference rename rootPath')
    this.pathStrategy = normalized.pathStrategy ?? 'preserve'
    if (
      this.pathStrategy !== 'preserve' &&
      this.pathStrategy !== 'workspace-relative'
    ) {
      throw new ReferenceRenameValidationError(
        'Reference rename pathStrategy must be preserve or workspace-relative',
      )
    }
    this.resolution = Object.freeze({
      ...(normalized.resolution?.extensions === undefined
        ? {}
        : { extensions: Object.freeze([...normalized.resolution.extensions]) }),
      ...(normalized.resolution?.basenameSearch === undefined
        ? {}
        : { basenameSearch: normalized.resolution.basenameSearch }),
    })
  }

  /** Renames one file in its current parent directory. */
  rename(
    path: WorkspacePath | string,
    name: string,
  ): Promise<ReferenceRenameResult> {
    const sourcePath = requireFilePath(path, 'Reference rename source path')
    const entryName = requireName(name)
    const targetPath = workspaceJoin(workspaceParent(sourcePath), entryName)
    return this.enqueue({
      operation: 'rename',
      sourcePath,
      targetPath,
    })
  }

  /** Alias that makes the file-only scope explicit to callers. */
  renameFile(
    path: WorkspacePath | string,
    name: string,
  ): Promise<ReferenceRenameResult> {
    return this.rename(path, name)
  }

  /** Moves one file below a destination directory without changing its name. */
  move(
    path: WorkspacePath | string,
    destinationDirectory: WorkspacePath | string,
  ): Promise<ReferenceRenameResult> {
    const sourcePath = requireFilePath(path, 'Reference move source path')
    const destination = normalizePath(
      destinationDirectory,
      'Reference move destination directory',
    )
    const targetPath = workspaceJoin(destination, workspaceName(sourcePath))
    return this.enqueue({
      operation: 'move',
      sourcePath,
      targetPath,
    })
  }

  moveFile(
    path: WorkspacePath | string,
    destinationDirectory: WorkspacePath | string,
  ): Promise<ReferenceRenameResult> {
    return this.move(path, destinationDirectory)
  }

  private enqueue(input: {
    readonly operation: ReferenceRenameOperation
    readonly sourcePath: WorkspacePath
    readonly targetPath: WorkspacePath
  }): Promise<ReferenceRenameResult> {
    const run = this.operationTail.then(() => this.perform(input))
    this.operationTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async perform(input: {
    readonly operation: ReferenceRenameOperation
    readonly sourcePath: WorkspacePath
    readonly targetPath: WorkspacePath
  }): Promise<ReferenceRenameResult> {
    const plan = await this.createPlan(input)
    if (plan.sourcePath === plan.targetPath) {
      return createResult(
        plan,
        plan.loadedByPath.get(plan.sourcePath)?.id,
      )
    }

    const originalContents = new Map<WorkspacePath, string>()
    for (const update of plan.contentUpdates) {
      originalContents.set(update.sourcePath, update.originalMarkdown)
    }

    let filesystemMove: FilesystemMoveState | undefined
    try {
      const moved =
        plan.operation === 'rename'
          ? await this.fileSystem.renameEntry(
              plan.sourcePath,
              workspaceName(plan.targetPath),
            )
          : await this.fileSystem.moveEntry(
              plan.sourcePath,
              workspaceParent(plan.targetPath),
            )
      // Treat a returned path as advisory only until it validates; the source
      // may already have moved when an adapter reports a malformed result.
      filesystemMove = { movedPath: plan.targetPath }
      const normalizedMoved = normalizePath(moved, 'Filesystem rename result')
      if (normalizedMoved !== plan.targetPath) {
        throw new Error(
          `Filesystem rename returned ${normalizedMoved}, expected ${plan.targetPath}`,
        )
      }

      for (const update of plan.contentUpdates) {
        const destinationPath =
          update.sourcePath === plan.sourcePath
            ? plan.targetPath
            : update.sourcePath
        await this.fileSystem.writeFile(
          createDocumentPath(destinationPath),
          update.updatedMarkdown,
        )
      }
    } catch (error) {
      if (!filesystemMove) {
        if (error instanceof WorkspaceEntryAlreadyExistsError) {
          throw new ReferenceRenameConflictError(
            [
              {
                kind: 'target-exists',
                path: plan.targetPath,
                message: `Workspace entry already exists: ${plan.targetPath}`,
              },
            ],
            {
              sourcePath: plan.sourcePath,
              targetPath: plan.targetPath,
              cause: error,
            },
          )
        }
        throw new ReferenceRenameFilesystemError(
          `Unable to ${plan.operation} ${plan.sourcePath}: ${errorMessage(error)}`,
          {
            sourcePath: plan.sourcePath,
            targetPath: plan.targetPath,
            cause: error,
          },
        )
      }

      const filesystemRollback = await this.rollbackFilesystem(
        plan,
        filesystemMove.movedPath,
        originalContents,
      )
      throw new ReferenceRenameTransactionError({
        message: `Unable to update references while moving ${plan.sourcePath}: ${errorMessage(error)}`,
        sourcePath: plan.sourcePath,
        targetPath: plan.targetPath,
        cause: error,
        rollbackAttempted: true,
        rollbackSucceeded: filesystemRollback,
      })
    }

    const storeTransaction: StoreTransaction = {
      originals: new Map(),
      sourceChanges: [],
    }
    try {
      const renamedDocumentId = this.applyStoreMutations(plan, storeTransaction)
      this.synchronizeGraph(plan, storeTransaction, 'updated')
      const finalDocuments = new Map<DocumentId, DocumentState>()
      if (this.store) {
        for (const documentId of storeTransaction.originals.keys()) {
          const document = this.store.get(documentById(documentId))
          if (document) finalDocuments.set(documentId, document)
        }
      }
      return createResult(plan, renamedDocumentId, finalDocuments)
    } catch (error) {
      const storeRollback = this.rollbackStore(plan, storeTransaction)
      const filesystemRollback = await this.rollbackFilesystem(
        plan,
        filesystemMove.movedPath,
        originalContents,
      )
      let graphRollback = true
      try {
        this.synchronizeGraph(plan, storeTransaction, 'original')
      } catch {
        graphRollback = false
      }
      throw new ReferenceRenameTransactionError({
        message: `Reference rename could not be completed: ${errorMessage(error)}`,
        sourcePath: plan.sourcePath,
        targetPath: plan.targetPath,
        cause: error,
        rollbackAttempted: true,
        rollbackSucceeded: storeRollback && filesystemRollback && graphRollback,
      })
    }
  }

  private async createPlan(input: {
    readonly operation: ReferenceRenameOperation
    readonly sourcePath: WorkspacePath
    readonly targetPath: WorkspacePath
  }): Promise<RenamePlan> {
    if (!isWorkspacePathWithin(input.sourcePath, this.rootPath)) {
      throw new ReferenceRenameValidationError(
        `Reference rename source ${input.sourcePath} is outside the workspace root`,
      )
    }
    if (!isWorkspacePathWithin(input.targetPath, this.rootPath)) {
      throw new ReferenceRenameValidationError(
        `Reference rename target ${input.targetPath} is outside the workspace root`,
      )
    }

    const sourceParent = workspaceParent(input.sourcePath)
    let sourceEntries
    try {
      sourceEntries = await this.fileSystem.listDirectory(sourceParent)
    } catch (error) {
      throw new ReferenceRenamePreflightError(
        `Unable to inspect ${sourceParent || '.'} before rename: ${errorMessage(error)}`,
        {
          sourcePath: input.sourcePath,
          targetPath: input.targetPath,
          cause: error,
        },
      )
    }
    const sourceEntry = sourceEntries.find((entry) => entry.path === input.sourcePath)
    if (!sourceEntry) {
      throw new ReferenceRenamePreflightError(
        `Workspace entry not found: ${input.sourcePath}`,
        {
          sourcePath: input.sourcePath,
          targetPath: input.targetPath,
        },
      )
    }
    if (sourceEntry.kind !== 'file') {
      throw new ReferenceRenameUnsupportedError(
        `Reference linkage currently supports file rename/move only: ${input.sourcePath}`,
        {
          sourcePath: input.sourcePath,
          targetPath: input.targetPath,
        },
      )
    }

    let destinationEntries
    try {
      destinationEntries = await this.fileSystem.listDirectory(
        workspaceParent(input.targetPath),
      )
    } catch (error) {
      throw new ReferenceRenamePreflightError(
        `Unable to inspect ${workspaceParent(input.targetPath) || '.'} before rename: ${errorMessage(error)}`,
        {
          sourcePath: input.sourcePath,
          targetPath: input.targetPath,
          cause: error,
        },
      )
    }
    const targetEntry = destinationEntries.find(
      (entry) => entry.path === input.targetPath,
    )
    if (targetEntry && input.targetPath !== input.sourcePath) {
      throw new ReferenceRenameConflictError(
        [
          {
            kind: 'target-exists',
            path: input.targetPath,
            message: `Workspace entry already exists: ${input.targetPath}`,
          },
        ],
        {
          sourcePath: input.sourcePath,
          targetPath: input.targetPath,
        },
      )
    }

    const availablePaths = await collectWorkspaceFilePaths(
      this.fileSystem,
      this.rootPath,
    )
    if (!availablePaths.includes(input.sourcePath)) {
      throw new ReferenceRenamePreflightError(
        `Workspace entry ${input.sourcePath} is not a regular workspace file`,
        {
          sourcePath: input.sourcePath,
          targetPath: input.targetPath,
        },
      )
    }

    const loadedByPath = normalizeLoadedDocuments(this.store, this.rootPath)
    const sourceContents = new Map<WorkspacePath, string>()
    const candidatePaths = new Set<WorkspacePath>(
      availablePaths.filter((path) => isReferenceDocumentPath(path)),
    )
    for (const [path] of loadedByPath) {
      if (availablePaths.includes(path)) candidatePaths.add(path)
    }

    for (const path of [...candidatePaths].sort()) {
      const loaded = loadedByPath.get(path)
      if (loaded) {
        sourceContents.set(path, loaded.markdown)
        continue
      }
      try {
        const markdown = await this.fileSystem.readFile(createDocumentPath(path))
        sourceContents.set(path, markdown)
      } catch (error) {
        throw new ReferenceRenamePreflightError(
          `Unable to read ${path} before updating incoming references: ${errorMessage(error)}`,
          {
            sourcePath: input.sourcePath,
            targetPath: input.targetPath,
            cause: error,
          },
        )
      }
    }

    const contentUpdates: ContentUpdate[] = []
    const resolution = this.resolution
    for (const [sourcePath, markdown] of sourceContents) {
      let rewritten
      try {
        rewritten = rewriteMarkdownReferences(
          sourcePath,
          markdown,
          input.sourcePath,
          input.targetPath,
          availablePaths,
          this.pathStrategy,
          resolution,
        )
      } catch (error) {
        throw new ReferenceRenamePreflightError(
          `Unable to plan reference updates in ${sourcePath}: ${errorMessage(error)}`,
          {
            sourcePath: input.sourcePath,
            targetPath: input.targetPath,
            cause: error,
          },
        )
      }
      if (rewritten.referenceCount === 0) continue
      contentUpdates.push(
        Object.freeze({
          sourcePath,
          originalMarkdown: markdown,
          updatedMarkdown: rewritten.markdown,
          referenceCount: rewritten.referenceCount,
          document: loadedByPath.get(sourcePath),
        }),
      )
    }

    const conflicts: ReferenceRenameConflict[] = []
    const touchedPaths = new Set<WorkspacePath>([
      input.sourcePath,
      ...contentUpdates.map((update) => update.sourcePath),
    ])
    for (const path of touchedPaths) {
      const document = loadedByPath.get(path)
      if (!document) continue
      if (document.dirty) {
        conflicts.push({
          kind: 'dirty-document',
          path,
          documentId: document.id,
          message: `Document ${document.id} has unsaved changes; rename was not applied`,
        })
        continue
      }
      if (!availablePaths.includes(path)) {
        conflicts.push({
          kind: 'missing-document-file',
          path,
          documentId: document.id,
          message: `Loaded document ${document.id} has no workspace file at ${path}`,
        })
        continue
      }
      try {
        const disk = await this.fileSystem.readFile(createDocumentPath(path))
        if (disk !== document.markdown) {
          conflicts.push({
            kind: 'external-change',
            path,
            documentId: document.id,
            message: `Workspace file ${path} changed outside DocumentStore; rename was not applied`,
          })
        }
      } catch (error) {
        throw new ReferenceRenamePreflightError(
          `Unable to verify loaded document ${path} before rename: ${errorMessage(error)}`,
          {
            sourcePath: input.sourcePath,
            targetPath: input.targetPath,
            cause: error,
          },
        )
      }
    }
    if (conflicts.length > 0) {
      throw new ReferenceRenameConflictError(conflicts, {
        sourcePath: input.sourcePath,
        targetPath: input.targetPath,
      })
    }

    return Object.freeze({
      operation: input.operation,
      sourcePath: input.sourcePath,
      targetPath: input.targetPath,
      availablePaths,
      sourceContents,
      loadedByPath,
      contentUpdates: Object.freeze(contentUpdates),
    })
  }

  private applyStoreMutations(
    plan: RenamePlan,
    transaction: StoreTransaction,
  ): DocumentId | undefined {
    const store = this.store
    if (!store) return undefined
    const origin = createDocumentOrigin(
      'reference-rename',
      `${plan.sourcePath}->${plan.targetPath}`,
    )
    const targetDocument = plan.loadedByPath.get(plan.sourcePath)
    if (targetDocument) {
      transaction.targetDocumentId = targetDocument.id
      transaction.originals.set(targetDocument.id, targetDocument)
      store.renamePath(
        documentById(targetDocument.id),
        createDocumentPath(plan.targetPath),
        origin,
        targetDocument.revision,
      )
    }

    for (const update of plan.contentUpdates) {
      const document = update.document
      if (!document) continue
      transaction.originals.set(document.id, document)
      const current = store.get(documentById(document.id))
      if (!current) {
        throw new Error(`Document ${document.id} is no longer loaded`)
      }
      const after = store.applyChange(documentById(document.id), {
        markdown: update.updatedMarkdown,
        origin,
        expectedRevision: document.revision,
      })
      transaction.sourceChanges.push({ before: current, after })
    }

    for (const original of transaction.originals.values()) {
      const current = store.get(documentById(original.id))
      if (!current) throw new Error(`Document ${original.id} is no longer loaded`)
      if (this.persistence && isPersistenceTracked(this.persistence, documentById(original.id))) {
        const persistenceOptions: PersistenceRebindPathOptions = {
          persistedMarkdown: current.markdown,
        }
        this.persistence.rebindPath(
          documentById(original.id),
          current.path,
          persistenceOptions,
        )
      }
      if (current.revision > current.persistedRevision) {
        store.markPersisted(
          documentById(original.id),
          current.revision,
          origin,
        )
      }
    }

    return targetDocument?.id
  }

  private rollbackStore(
    plan: RenamePlan,
    transaction: StoreTransaction,
  ): boolean {
    const store = this.store
    if (!store) return true
    let success = true
    const origin = createDocumentOrigin(
      'reference-rename-rollback',
      `${plan.targetPath}->${plan.sourcePath}`,
    )

    for (const original of [...transaction.originals.values()].reverse()) {
      const current = store.get(documentById(original.id))
      if (!current) {
        success = false
        continue
      }
      if (current.markdown !== original.markdown) {
        try {
          store.applyChange(documentById(original.id), {
            markdown: original.markdown,
            origin,
            expectedRevision: current.revision,
          })
        } catch {
          success = false
        }
      }
    }

    if (transaction.targetDocumentId) {
      const current = store.get(documentById(transaction.targetDocumentId))
      const original = transaction.originals.get(transaction.targetDocumentId)
      if (!current || !original) {
        success = false
      } else if (current.path !== original.path) {
        try {
          store.renamePath(
            documentById(transaction.targetDocumentId),
            original.path,
            origin,
            current.revision,
          )
        } catch {
          success = false
        }
      }
    }

    for (const original of transaction.originals.values()) {
      const current = store.get(documentById(original.id))
      if (!current) {
        success = false
        continue
      }
      try {
        if (this.persistence && isPersistenceTracked(this.persistence, documentById(original.id))) {
          this.persistence.rebindPath(
            documentById(original.id),
            current.path,
            { persistedMarkdown: original.markdown },
          )
        }
        if (current.revision > current.persistedRevision) {
          store.markPersisted(documentById(original.id), current.revision, origin)
        }
      } catch {
        success = false
      }
    }
    return success
  }

  private async rollbackFilesystem(
    plan: RenamePlan,
    movedPath: WorkspacePath,
    originalContents: ReadonlyMap<WorkspacePath, string>,
  ): Promise<boolean> {
    let success = true
    for (const [sourcePath, markdown] of [...originalContents.entries()].reverse()) {
      const currentPath = sourcePath === plan.sourcePath ? movedPath : sourcePath
      try {
        await this.fileSystem.writeFile(
          createDocumentPath(currentPath),
          markdown,
        )
      } catch {
        success = false
      }
    }

    try {
      const restored =
        plan.operation === 'rename'
          ? await this.fileSystem.renameEntry(
              movedPath,
              workspaceName(plan.sourcePath),
            )
          : await this.fileSystem.moveEntry(
              movedPath,
              workspaceParent(plan.sourcePath),
            )
      if (normalizePath(restored, 'Filesystem rollback result') !== plan.sourcePath) {
        success = false
      }
    } catch {
      success = false
    }
    return success
  }

  /**
   * Keeps an injected graph current without making it part of the source
   * transaction. Both old and new target paths are removed before final facts
   * are indexed, so a graph observer cannot retain a phantom old node.
   */
  private synchronizeGraph(
    plan: RenamePlan,
    transaction: StoreTransaction,
    contentMode: 'updated' | 'original',
  ): void {
    const graph = this.graph
    if (!graph) return

    const targetPath = contentMode === 'updated' ? plan.targetPath : plan.sourcePath
    const targetOldPath = plan.sourcePath
    const candidatePaths = new Set<WorkspacePath>([
      targetOldPath,
      plan.targetPath,
      ...plan.contentUpdates.map((update) => update.sourcePath),
    ])
    const existingEntries = new Map<WorkspacePath, ReferenceIndexEntry | undefined>()
    for (const path of candidatePaths) {
      existingEntries.set(path, graph.getIndex().getByPath(path))
    }
    for (const path of candidatePaths) {
      graph.getIndex().removeDocument(path)
    }

    const indexDocument = (
      path: WorkspacePath,
      markdown: string,
      existing: ReferenceIndexEntry | undefined,
      document: DocumentState | undefined,
    ): void => {
      if (!existing && !document) return
      graph.indexDocument({
        path,
        markdown,
        ...(document === undefined
          ? existing?.sourceId === undefined
            ? {}
            : { id: existing.sourceId }
          : { id: document.id }),
        revision: document?.revision ?? existing?.revision,
      })
    }

    const targetDocument =
      transaction.targetDocumentId === undefined || !this.store
        ? undefined
        : this.store.get(documentById(transaction.targetDocumentId))
    const originalTargetDocument =
      transaction.targetDocumentId === undefined
        ? undefined
        : transaction.originals.get(transaction.targetDocumentId)
    const targetMarkdown =
      contentMode === 'updated'
        ? this.updatedContent(plan, plan.sourcePath)
        : this.originalContent(plan, plan.sourcePath)
    if (targetMarkdown !== undefined) {
      indexDocument(
        targetPath,
        targetMarkdown,
        existingEntries.get(targetOldPath) ?? existingEntries.get(plan.targetPath),
        contentMode === 'updated' ? targetDocument : originalTargetDocument,
      )
    }

    for (const update of plan.contentUpdates) {
      if (update.sourcePath === plan.sourcePath) continue
      const document =
        contentMode === 'updated'
          ? update.document && this.store
            ? this.store.get(documentById(update.document.id))
            : undefined
          : update.document
      const markdown =
        contentMode === 'updated'
          ? update.updatedMarkdown
          : update.originalMarkdown
      indexDocument(
        update.sourcePath,
        markdown,
        existingEntries.get(update.sourcePath),
        document,
      )
    }

    const workspacePaths = graph.getWorkspacePaths().map((path) =>
      path === (contentMode === 'updated' ? plan.sourcePath : plan.targetPath)
        ? targetPath
        : path,
    )
    graph.setWorkspacePaths(workspacePaths)
  }

  private updatedContent(
    plan: RenamePlan,
    path: WorkspacePath,
  ): string | undefined {
    const update = plan.contentUpdates.find((candidate) => candidate.sourcePath === path)
    return update?.updatedMarkdown ?? plan.sourceContents.get(path)
  }

  private originalContent(
    plan: RenamePlan,
    path: WorkspacePath,
  ): string | undefined {
    const update = plan.contentUpdates.find((candidate) => candidate.sourcePath === path)
    return update?.originalMarkdown ?? plan.sourceContents.get(path)
  }
}

export const RenameConflictError = ReferenceRenameConflictError
export const RenameTransactionError = ReferenceRenameTransactionError
export const ReferenceLinkageService = ReferenceRenameService