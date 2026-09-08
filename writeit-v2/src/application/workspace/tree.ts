import {
  createWorkspaceDirectoryNode,
  createWorkspaceFileNode,
  createWorkspacePath,
  createWorkspaceTree,
  findWorkspaceNode,
  isWorkspacePathWithin,
  sortWorkspaceNodes,
  workspaceJoin,
  workspaceName,
  workspaceParent,
} from '../../core/workspace'
import type {
  WorkspaceDirectoryNode,
  WorkspaceEntry,
  WorkspaceNode,
  WorkspacePath,
  WorkspaceTree,
} from '../../core/workspace'
import type { WorkspaceFileSystemPort } from '../../platform/filesystem'
import {
  WorkspaceEntryNotFoundError,
  WorkspaceInvalidOperationError,
} from '../../platform/filesystem'
import {
  directoryMoveTarget,
  directoryRenameTarget,
  findOpenDocumentsWithinDirectory,
  findRecoveryPathsWithinDirectory,
  WorkspaceDirectoryOperationBlockedError,
  WorkspaceDirectorySafetyCheckError,
} from './directory-safety'
import type {
  WorkspaceDirectoryOperation,
  WorkspaceOpenDocumentBinding,
} from './directory-safety'

export interface WorkspaceTreeServiceOptions {
  /** Relative path at which the workspace tree is rooted. */
  readonly rootPath?: WorkspacePath | string
  /** Label used for the root node; it does not affect filesystem paths. */
  readonly rootName?: string
  /** Runtime DocumentStore-backed path bindings protected by directory moves. */
  readonly getOpenDocuments?: () => readonly WorkspaceOpenDocumentBinding[]
  /** Recovery paths are protected even when their Document is not loaded yet. */
  readonly getRecoveryPaths?: () => readonly (WorkspacePath | string)[]
}

export interface WorkspaceTreeSnapshot {
  readonly tree: WorkspaceTree
  /** Monotonic refresh generation, not a DocumentStore revision. */
  readonly revision: number
}

export type WorkspaceTreeListener = (
  snapshot: WorkspaceTreeSnapshot,
) => void

export type WorkspaceTreeUnsubscribe = () => void

export class WorkspaceTreeConsistencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceTreeConsistencyError'
  }
}

function requireRootName(
  name: string | undefined,
  rootPath: WorkspacePath,
): string {
  if (name === undefined) return rootPath === '' ? 'Workspace' : workspaceName(rootPath)
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError('Workspace root name must be non-empty')
  }
  return name
}

function requireListener(listener: WorkspaceTreeListener): void {
  if (typeof listener !== 'function') {
    throw new TypeError('Workspace tree listener must be a function')
  }
}

/**
 * Application service for the derived workspace tree. Filesystem mutations
 * happen first; a successful mutation is followed by a recursive refresh so
 * the published tree always describes the adapter rather than becoming a
 * second file-content authority.
 */
export class WorkspaceTreeService {
  private readonly fileSystem: WorkspaceFileSystemPort

  private readonly rootPath: WorkspacePath

  private readonly rootName: string

  private readonly getOpenDocuments:
    | (() => readonly WorkspaceOpenDocumentBinding[])
    | undefined

  private readonly getRecoveryPaths:
    | (() => readonly (WorkspacePath | string)[])
    | undefined

  private readonly listeners = new Set<WorkspaceTreeListener>()

  private snapshot: WorkspaceTreeSnapshot

  constructor(
    fileSystem: WorkspaceFileSystemPort,
    options: WorkspaceTreeServiceOptions = {},
  ) {
    this.fileSystem = fileSystem
    this.rootPath = createWorkspacePath(options.rootPath ?? '')
    this.rootName = requireRootName(options.rootName, this.rootPath)
    this.getOpenDocuments = options.getOpenDocuments
    this.getRecoveryPaths = options.getRecoveryPaths
    this.snapshot = Object.freeze({
      tree: createWorkspaceTree(this.rootPath, [], this.rootName),
      revision: 0,
    })
  }

  getRootPath(): WorkspacePath {
    return this.rootPath
  }

  getSnapshot(): WorkspaceTreeSnapshot {
    return this.snapshot
  }

  getTree(): WorkspaceTree {
    return this.snapshot.tree
  }

  subscribe(listener: WorkspaceTreeListener): WorkspaceTreeUnsubscribe {
    requireListener(listener)
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  async refresh(): Promise<WorkspaceTreeSnapshot> {
    const root = await this.readDirectory(this.rootPath, this.rootName)
    const next = Object.freeze({
      tree: createWorkspaceTree(this.rootPath, root.children, this.rootName),
      revision: this.snapshot.revision + 1,
    })
    this.snapshot = next
    this.notify()
    return next
  }

  async createFile(
    parentPath: WorkspacePath,
    name: string,
    content = '',
  ): Promise<WorkspacePath> {
    const parent = this.requireManagedPath(parentPath)
    const target = workspaceJoin(parent, name)
    await this.fileSystem.createFile(target, content)
    await this.refresh()
    return target
  }

  async createDirectory(
    parentPath: WorkspacePath,
    name: string,
  ): Promise<WorkspacePath> {
    const parent = this.requireManagedPath(parentPath)
    const target = workspaceJoin(parent, name)
    await this.fileSystem.createDirectory(target)
    await this.refresh()
    return target
  }

  async rename(path: WorkspacePath, name: string): Promise<WorkspacePath> {
    const source = this.requireManagedEntryPath(path)
    const target = directoryRenameTarget(source, name)
    if (target !== source) {
      await this.assertDirectoryOperationSafe('rename', source, target)
    }
    const renamed = await this.fileSystem.renameEntry(source, name)
    await this.refresh()
    return renamed
  }

  async delete(
    path: WorkspacePath,
    options: { readonly recursive?: boolean } = { recursive: true },
  ): Promise<void> {
    const target = this.requireManagedEntryPath(path)
    await this.fileSystem.deleteEntry(target, {
      recursive: options.recursive ?? true,
    })
    await this.refresh()
  }

  /** Explicit alias for callers that avoid the JavaScript `delete` keyword. */
  async deleteEntry(
    path: WorkspacePath,
    options: { readonly recursive?: boolean } = { recursive: true },
  ): Promise<void> {
    await this.delete(path, options)
  }

  async move(
    source: WorkspacePath,
    destinationDirectory: WorkspacePath,
  ): Promise<WorkspacePath> {
    const normalizedSource = this.requireManagedEntryPath(source)
    const normalizedDestination = this.requireManagedPath(destinationDirectory)

    if (
      isWorkspacePathWithin(normalizedDestination, normalizedSource) &&
      normalizedSource !== normalizedDestination
    ) {
      throw new WorkspaceInvalidOperationError(
        'A directory cannot be moved into itself or one of its descendants',
      )
    }

    const target = directoryMoveTarget(
      normalizedSource,
      normalizedDestination,
    )
    if (target !== normalizedSource) {
      await this.assertDirectoryOperationSafe('move', normalizedSource, target)
    }

    const moved = await this.fileSystem.moveEntry(
      normalizedSource,
      normalizedDestination,
    )
    await this.refresh()
    return moved
  }

  /**
   * Checks directory path bindings before any filesystem mutation. File
   * operations retain their existing path through this service; P4-06 owns
   * their reference-aware application path.
   */
  private async assertDirectoryOperationSafe(
    operation: WorkspaceDirectoryOperation,
    sourcePath: WorkspacePath,
    targetPath: WorkspacePath,
  ): Promise<void> {
    if (!this.getOpenDocuments && !this.getRecoveryPaths) return

    // A refreshed tree gives the normal UI path a synchronous preflight,
    // which also prevents an unrelated scheduled persistence callback from
    // interleaving with a blocked operation. If the projection is stale or
    // does not contain the entry, confirm through the read-only filesystem
    // listing before deciding whether the safety check applies.
    const knownNode = findWorkspaceNode(this.snapshot.tree, sourcePath)
    const sourceKind =
      knownNode?.kind === 'directory'
        ? knownNode.kind
        : await this.readEntryKind(sourcePath)
    if (sourceKind !== 'directory') return

    let openDocuments: ReturnType<typeof findOpenDocumentsWithinDirectory> =
      Object.freeze([])
    let recoveryPaths: ReturnType<typeof findRecoveryPathsWithinDirectory> =
      Object.freeze([])
    try {
      openDocuments = this.getOpenDocuments
        ? findOpenDocumentsWithinDirectory(
            sourcePath,
            this.getOpenDocuments(),
          )
        : Object.freeze([])
      recoveryPaths = this.getRecoveryPaths
        ? findRecoveryPathsWithinDirectory(
            sourcePath,
            this.getRecoveryPaths(),
          )
        : Object.freeze([])
    } catch (error) {
      throw new WorkspaceDirectorySafetyCheckError({
        operation,
        sourcePath,
        targetPath,
        cause: error,
      })
    }

    if (openDocuments.length === 0 && recoveryPaths.length === 0) return
    throw new WorkspaceDirectoryOperationBlockedError({
      operation,
      sourcePath,
      targetPath,
      affectedDocuments: openDocuments,
      affectedRecoveryPaths: recoveryPaths,
    })
  }

  private async readEntryKind(
    path: WorkspacePath,
  ): Promise<WorkspaceEntry['kind']> {
    const entries = await this.fileSystem.listDirectory(workspaceParent(path))
    const entry = entries.find((candidate) => candidate.path === path)
    if (!entry) throw new WorkspaceEntryNotFoundError(path)
    return entry.kind
  }

  private async readDirectory(
    path: WorkspacePath,
    name: string,
  ): Promise<WorkspaceDirectoryNode> {
    const entries = await this.fileSystem.listDirectory(path)
    const seen = new Set<WorkspacePath>()
    const children: WorkspaceNode[] = []

    for (const entry of entries) {
      const normalizedEntry = this.validateEntry(path, entry)
      if (seen.has(normalizedEntry.path)) {
        throw new WorkspaceTreeConsistencyError(
          `Filesystem returned duplicate workspace entry ${normalizedEntry.path}`,
        )
      }
      seen.add(normalizedEntry.path)

      if (normalizedEntry.kind === 'directory') {
        children.push(
          await this.readDirectory(normalizedEntry.path, normalizedEntry.name),
        )
      } else {
        children.push(
          createWorkspaceFileNode(normalizedEntry.path, normalizedEntry.name),
        )
      }
    }

    return createWorkspaceDirectoryNode(
      path,
      sortWorkspaceNodes(children),
      name,
    )
  }

  private validateEntry(
    parentPath: WorkspacePath,
    entry: WorkspaceEntry,
  ): WorkspaceEntry {
    if (entry === null || typeof entry !== 'object') {
      throw new WorkspaceTreeConsistencyError(
        `Filesystem returned an invalid entry under ${parentPath || '.'}`,
      )
    }
    if (entry.kind !== 'file' && entry.kind !== 'directory') {
      throw new WorkspaceTreeConsistencyError(
        `Filesystem returned an invalid entry kind under ${parentPath || '.'}`,
      )
    }

    let path: WorkspacePath
    try {
      path = createWorkspacePath(entry.path)
    } catch {
      throw new WorkspaceTreeConsistencyError(
        `Filesystem returned an invalid entry path under ${parentPath || '.'}`,
      )
    }

    if (path === '' || workspaceParent(path) !== parentPath) {
      throw new WorkspaceTreeConsistencyError(
        `Filesystem entry ${path || '.'} is not a direct child of ${parentPath || '.'}`,
      )
    }
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      throw new WorkspaceTreeConsistencyError(
        `Filesystem entry ${path} has an invalid name`,
      )
    }
    if (entry.name !== workspaceName(path)) {
      throw new WorkspaceTreeConsistencyError(
        `Filesystem entry ${path} has a name that does not match its path`,
      )
    }

    return Object.freeze({
      kind: entry.kind,
      path,
      name: entry.name,
    })
  }

  private requireManagedPath(path: WorkspacePath): WorkspacePath {
    const normalizedPath = createWorkspacePath(path)
    if (!isWorkspacePathWithin(normalizedPath, this.rootPath)) {
      throw new WorkspaceInvalidOperationError(
        `Workspace path ${normalizedPath} is outside the workspace root`,
      )
    }
    return normalizedPath
  }

  private requireManagedEntryPath(path: WorkspacePath): WorkspacePath {
    const normalizedPath = this.requireManagedPath(path)
    if (normalizedPath === this.rootPath) {
      throw new WorkspaceInvalidOperationError(
        'The workspace root is not a mutable entry',
      )
    }
    return normalizedPath
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener(this.snapshot)
  }
}
