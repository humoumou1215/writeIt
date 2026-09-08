import {
  createWorkspacePath,
  isWorkspacePathWithin,
  workspaceJoin,
  workspaceName,
  workspaceParent,
} from '../../core/workspace'
import type { WorkspacePath } from '../../core/workspace'
import { WorkspaceInvalidOperationError } from '../../platform/filesystem'

export type WorkspaceDirectoryOperation = 'rename' | 'move'

/**
 * A runtime path binding that must not be moved behind the application's
 * back. The application supplies Store-backed Documents; the optional dirty
 * bit is included in diagnostics so the user can see why the operation is
 * blocked.
 */
export interface WorkspaceOpenDocumentBinding {
  readonly documentId: string
  readonly path: WorkspacePath | string
  readonly dirty: boolean
}

export interface WorkspaceDirectoryOpenDocumentConflict {
  readonly documentId: string
  readonly path: WorkspacePath
  readonly dirty: boolean
}

export const WORKSPACE_DIRECTORY_OPERATION_BLOCKED_REASON =
  'open-document-path-binding' as const

export type WorkspaceDirectoryOperationBlockedReason =
  typeof WORKSPACE_DIRECTORY_OPERATION_BLOCKED_REASON

function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return 'Unknown workspace directory safety failure'
  }
}

function normalizePath(value: WorkspacePath | string, name: string): WorkspacePath {
  try {
    return createWorkspacePath(value)
  } catch (error) {
    throw new TypeError(`${name} is invalid: ${errorMessage(error)}`)
  }
}

function requireBindings(
  bindings: readonly WorkspaceOpenDocumentBinding[],
): readonly WorkspaceOpenDocumentBinding[] {
  if (!Array.isArray(bindings)) {
    throw new TypeError('Open document bindings must be an array')
  }
  return bindings
}

/**
 * Returns only documents at `directory` or below it. Workspace path
 * containment is segment-aware, so a sibling such as `notes-archive` is not
 * treated as a descendant of `notes`.
 */
export function findOpenDocumentsWithinDirectory(
  directory: WorkspacePath | string,
  bindings: readonly WorkspaceOpenDocumentBinding[],
): readonly WorkspaceDirectoryOpenDocumentConflict[] {
  const normalizedDirectory = normalizePath(directory, 'Directory safety source')
  const conflicts: WorkspaceDirectoryOpenDocumentConflict[] = []
  const seen = new Set<string>()

  for (const [index, binding] of requireBindings(bindings).entries()) {
    if (binding === null || typeof binding !== 'object') {
      throw new TypeError(`Open document binding at index ${index} is invalid`)
    }
    if (
      typeof binding.documentId !== 'string' ||
      binding.documentId.trim().length === 0
    ) {
      throw new TypeError(
        `Open document binding at index ${index} has an invalid documentId`,
      )
    }
    if (typeof binding.dirty !== 'boolean') {
      throw new TypeError(
        `Open document binding ${binding.documentId} has an invalid dirty state`,
      )
    }

    const path = normalizePath(
      binding.path,
      `Open document binding ${binding.documentId} path`,
    )
    if (path === '') {
      throw new TypeError(
        `Open document binding ${binding.documentId} cannot point to the workspace root`,
      )
    }
    if (!isWorkspacePathWithin(path, normalizedDirectory)) continue

    // A healthy Store has one path per Document. Deduplicating malformed or
    // repeated provider output keeps the diagnostic deterministic without
    // hiding a second distinct DocumentId at the same path.
    const key = `${binding.documentId}\u0000${path}`
    if (seen.has(key)) continue
    seen.add(key)
    conflicts.push(
      Object.freeze({
        documentId: binding.documentId,
        path,
        dirty: binding.dirty,
      }),
    )
  }

  conflicts.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.documentId.localeCompare(right.documentId),
  )
  return Object.freeze(conflicts)
}

/**
 * Recovery stores paths rather than DocumentIds. They are protected as a
 * second class of live path binding so a session that has not been restored
 * yet cannot silently point at the old directory after a move.
 */
export function findRecoveryPathsWithinDirectory(
  directory: WorkspacePath | string,
  paths: readonly (WorkspacePath | string)[],
): readonly WorkspacePath[] {
  const normalizedDirectory = normalizePath(directory, 'Directory safety source')
  if (!Array.isArray(paths)) {
    throw new TypeError('Recovery paths must be an array')
  }

  const matches = new Set<WorkspacePath>()
  for (const [index, candidate] of paths.entries()) {
    const path = normalizePath(candidate, `Recovery path at index ${index}`)
    if (path !== '' && isWorkspacePathWithin(path, normalizedDirectory)) {
      matches.add(path)
    }
  }

  return Object.freeze([...matches].sort((left, right) => left.localeCompare(right)))
}

export function directoryRenameTarget(
  source: WorkspacePath | string,
  name: string,
): WorkspacePath {
  const normalizedSource = normalizePath(source, 'Directory rename source')
  return workspaceJoin(workspaceParent(normalizedSource), name)
}

export function directoryMoveTarget(
  source: WorkspacePath | string,
  destinationDirectory: WorkspacePath | string,
): WorkspacePath {
  const normalizedSource = normalizePath(source, 'Directory move source')
  const normalizedDestination = normalizePath(
    destinationDirectory,
    'Directory move destination',
  )
  if (normalizedSource === normalizedDestination) return normalizedSource
  return workspaceJoin(normalizedDestination, workspaceName(normalizedSource))
}

export class WorkspaceDirectoryOperationBlockedError extends WorkspaceInvalidOperationError {
  readonly code = 'workspace-directory-operation-blocked' as const
  readonly reason: WorkspaceDirectoryOperationBlockedReason =
    WORKSPACE_DIRECTORY_OPERATION_BLOCKED_REASON
  readonly operation: WorkspaceDirectoryOperation
  readonly sourcePath: WorkspacePath
  readonly targetPath: WorkspacePath
  readonly affectedDocuments: readonly WorkspaceDirectoryOpenDocumentConflict[]
  readonly affectedRecoveryPaths: readonly WorkspacePath[]
  readonly affectedPaths: readonly WorkspacePath[]
  readonly blockingReason: string

  constructor(input: {
    readonly operation: WorkspaceDirectoryOperation
    readonly sourcePath: WorkspacePath
    readonly targetPath: WorkspacePath
    readonly affectedDocuments: readonly WorkspaceDirectoryOpenDocumentConflict[]
    readonly affectedRecoveryPaths?: readonly WorkspacePath[]
  }) {
    const affectedDocuments = Object.freeze(
      [...input.affectedDocuments].map((document) => Object.freeze({ ...document })),
    )
    const documentPaths = new Set(
      affectedDocuments.map((document) => document.path),
    )
    const affectedRecoveryPaths = Object.freeze(
      [...new Set(input.affectedRecoveryPaths ?? [])]
        .filter((path) => !documentPaths.has(path))
        .sort((left, right) => left.localeCompare(right)),
    )
    const affectedPaths = Object.freeze([
      ...new Set([
        ...affectedDocuments.map((document) => document.path),
        ...affectedRecoveryPaths,
      ]),
    ].sort((left, right) => left.localeCompare(right)))
    const sourceLabel = input.sourcePath || '.'
    const targetLabel = input.targetPath || '.'
    const documentDetails = affectedDocuments.map(
      (document) =>
        `${document.path}${document.dirty ? ' (dirty)' : ''} [${document.documentId}]`,
    )
    const recoveryDetails = affectedRecoveryPaths.map(
      (path) => `${path} [recovery]`,
    )
    const details = [...documentDetails, ...recoveryDetails].join(', ')
    const retryHint =
      affectedDocuments.length > 0
        ? 'Close or unload the affected Document before retrying'
        : 'Clear or update the affected recovery session before retrying'

    const blockingReason =
      'open Document path bindings would disconnect DocumentStore/tabs/persistence/recovery from the workspace tree'
    super(
      `Cannot ${input.operation} directory "${sourceLabel}" to "${targetLabel}": ${blockingReason}. Affected: ${details}. ${retryHint}.`,
    )
    this.name = 'WorkspaceDirectoryOperationBlockedError'
    this.operation = input.operation
    this.sourcePath = input.sourcePath
    this.targetPath = input.targetPath
    this.affectedDocuments = affectedDocuments
    this.affectedRecoveryPaths = affectedRecoveryPaths
    this.affectedPaths = affectedPaths
    this.blockingReason = blockingReason
  }
}

export class WorkspaceDirectorySafetyCheckError extends WorkspaceInvalidOperationError {
  readonly code = 'workspace-directory-safety-check-failed' as const
  readonly operation: WorkspaceDirectoryOperation
  readonly sourcePath: WorkspacePath
  readonly targetPath: WorkspacePath
  readonly cause: unknown

  constructor(input: {
    readonly operation: WorkspaceDirectoryOperation
    readonly sourcePath: WorkspacePath
    readonly targetPath: WorkspacePath
    readonly cause: unknown
  }) {
    super(
      `Unable to verify directory ${input.sourcePath || '.'} before ${input.operation} to ${input.targetPath || '.'}; operation was not applied: ${errorMessage(input.cause)}`,
    )
    this.name = 'WorkspaceDirectorySafetyCheckError'
    this.operation = input.operation
    this.sourcePath = input.sourcePath
    this.targetPath = input.targetPath
    this.cause = input.cause
  }
}