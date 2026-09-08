import { createDocumentPath } from '../../core/document'
import {
  createWorkspacePath,
  isWorkspacePathWithin,
  workspaceJoin,
  workspaceName,
  workspaceParent,
} from '../../core/workspace'
import type {
  DocumentPath,
} from '../../core/document'
import type {
  WorkspaceEntry,
  WorkspacePath,
} from '../../core/workspace'
import type { BinaryFileSystemPort } from './binary-port'
import type { FileSystemPort } from './port'
import {
  WorkspaceDirectoryNotEmptyError,
  WorkspaceEntryAlreadyExistsError,
  WorkspaceEntryNotFoundError,
  WorkspaceInvalidOperationError,
} from './workspace-errors'
import type {
  WorkspaceDeleteOptions,
  WorkspaceFileSystemPort,
} from './workspace-port'

export class FileNotFoundError extends Error {
  readonly path: DocumentPath

  constructor(path: DocumentPath) {
    super(`File not found: ${path}`)
    this.name = 'FileNotFoundError'
    this.path = path
  }
}

export interface MemoryFileSystemOptions {
  readonly files?: Readonly<Record<string, string>>
  /** Initial binary files, copied so callers cannot mutate the adapter state. */
  readonly binaryFiles?: Readonly<Record<string, Uint8Array>>
  readonly directories?: readonly string[]
}

type MemoryFileSystemSeed =
  | Readonly<Record<string, string>>
  | MemoryFileSystemOptions

function requirePath(path: string): WorkspacePath {
  const normalized = createWorkspacePath(path)
  if (normalized === '') {
    throw new TypeError('File path must identify a file, not the workspace root')
  }
  return normalized
}

function requireDirectoryPath(path: string): WorkspacePath {
  return createWorkspacePath(path)
}

function requireContent(content: string): string {
  if (typeof content !== 'string') {
    throw new TypeError('File content must be a string')
  }
  return content
}

function requireBinaryContent(data: Uint8Array): Uint8Array {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('Binary file content must be a Uint8Array')
  }
  return new Uint8Array(data)
}

function parentDirectoryExists(
  directories: ReadonlySet<WorkspacePath>,
  path: WorkspacePath,
): boolean {
  const parent = workspaceParent(path)
  return parent === '' || directories.has(parent)
}

function isOptionsSeed(seed: MemoryFileSystemSeed): seed is MemoryFileSystemOptions {
  if (typeof seed !== 'object' || seed === null) return false

  const candidate = seed as {
    readonly files?: unknown
    readonly binaryFiles?: unknown
    readonly directories?: unknown
  }
  return (
    (candidate.files !== undefined &&
      typeof candidate.files === 'object' &&
      candidate.files !== null) ||
    (candidate.binaryFiles !== undefined &&
      typeof candidate.binaryFiles === 'object' &&
      candidate.binaryFiles !== null) ||
    Array.isArray(candidate.directories)
  )
}

function compareEntries(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1

  const leftName = left.name.toLocaleLowerCase('en-US')
  const rightName = right.name.toLocaleLowerCase('en-US')
  return (
    leftName.localeCompare(rightName, 'en-US') ||
    left.name.localeCompare(right.name, 'en-US')
  )
}

/**
 * Deterministic FileSystemPort and WorkspaceFileSystemPort implementation for
 * unit and integration tests. It has no browser, Tauri, localStorage, or
 * filesystem dependencies.
 */
export class MemoryFileSystem
  implements FileSystemPort, WorkspaceFileSystemPort, BinaryFileSystemPort
{
  private readonly files = new Map<WorkspacePath, string>()

  /** Binary files share the same workspace namespace as text files. */
  private readonly binaryFiles = new Map<WorkspacePath, Uint8Array>()

  /** Non-root directories, including ancestors implied by files. */
  private readonly directories = new Set<WorkspacePath>()

  constructor(initial: MemoryFileSystemSeed = {}) {
    const files = isOptionsSeed(initial) ? initial.files ?? {} : initial
    const binaryFiles = isOptionsSeed(initial)
      ? initial.binaryFiles ?? {}
      : {}
    const directories = isOptionsSeed(initial) ? initial.directories ?? [] : []

    for (const directory of directories) {
      this.registerDirectory(requireDirectoryPath(directory))
    }
    for (const [path, content] of Object.entries(files)) {
      this.registerFile(requirePath(path), requireContent(content))
    }
    for (const [path, bytes] of Object.entries(binaryFiles)) {
      this.registerBinaryFile(requirePath(path), bytes)
    }
  }

  async readFile(path: DocumentPath): Promise<string> {
    const normalizedPath = requirePath(path)
    const content = this.files.get(normalizedPath)
    if (content !== undefined) return content
    if (this.binaryFiles.has(normalizedPath)) {
      throw new WorkspaceInvalidOperationError(
        `Workspace file ${normalizedPath} contains binary data`,
      )
    }
    throw new FileNotFoundError(createDocumentPath(normalizedPath))
  }

  async readBinary(path: WorkspacePath): Promise<Uint8Array> {
    const normalizedPath = requirePath(path)
    const bytes = this.binaryFiles.get(normalizedPath)
    if (bytes !== undefined) return new Uint8Array(bytes)
    if (this.files.has(normalizedPath)) {
      throw new WorkspaceInvalidOperationError(
        `Workspace file ${normalizedPath} contains text data`,
      )
    }
    throw new FileNotFoundError(createDocumentPath(normalizedPath))
  }

  async writeFile(path: DocumentPath, content: string): Promise<void> {
    const normalizedPath = requirePath(path)
    requireContent(content)

    if (this.directories.has(normalizedPath)) {
      throw new WorkspaceInvalidOperationError(
        `Cannot write a file over directory ${normalizedPath}`,
      )
    }

    this.ensureParentDirectories(normalizedPath)
    this.binaryFiles.delete(normalizedPath)
    this.files.set(normalizedPath, content)
  }

  async writeBinary(path: WorkspacePath, data: Uint8Array): Promise<void> {
    const normalizedPath = requirePath(path)
    const bytes = requireBinaryContent(data)

    if (this.directories.has(normalizedPath)) {
      throw new WorkspaceInvalidOperationError(
        `Cannot write a file over directory ${normalizedPath}`,
      )
    }

    this.ensureParentDirectories(normalizedPath)
    this.files.delete(normalizedPath)
    this.binaryFiles.set(normalizedPath, bytes)
  }

  async deleteBinary(path: WorkspacePath): Promise<void> {
    const normalizedPath = requirePath(path)
    if (!this.binaryFiles.delete(normalizedPath)) {
      throw new FileNotFoundError(createDocumentPath(normalizedPath))
    }
  }

  async listDirectory(
    path: WorkspacePath,
  ): Promise<readonly WorkspaceEntry[]> {
    const normalizedPath = requireDirectoryPath(path)
    this.requireDirectory(normalizedPath)

    const entries = new Map<WorkspacePath, WorkspaceEntry>()
    for (const directory of this.directories) {
      if (workspaceParent(directory) !== normalizedPath) continue
      entries.set(
        directory,
        Object.freeze({
          kind: 'directory' as const,
          path: directory,
          name: workspaceName(directory),
        }),
      )
    }
    for (const file of [...this.files.keys(), ...this.binaryFiles.keys()]) {
      if (workspaceParent(file) !== normalizedPath) continue
      entries.set(
        file,
        Object.freeze({
          kind: 'file' as const,
          path: file,
          name: workspaceName(file),
        }),
      )
    }

    return Object.freeze([...entries.values()].sort(compareEntries))
  }

  async createFile(path: WorkspacePath, content = ''): Promise<void> {
    const normalizedPath = requirePath(path)
    requireContent(content)
    this.requireParentDirectory(normalizedPath)
    this.requirePathDoesNotExist(normalizedPath)
    this.files.set(normalizedPath, content)
  }

  async createDirectory(path: WorkspacePath): Promise<void> {
    const normalizedPath = requireDirectoryPath(path)
    if (normalizedPath === '') {
      throw new WorkspaceInvalidOperationError(
        'The workspace root already exists',
      )
    }

    this.requireParentDirectory(normalizedPath)
    this.requirePathDoesNotExist(normalizedPath)
    this.directories.add(normalizedPath)
  }

  async deleteEntry(
    path: WorkspacePath,
    options: WorkspaceDeleteOptions = {},
  ): Promise<void> {
    const normalizedPath = requireDirectoryPath(path)
    if (normalizedPath === '') {
      throw new WorkspaceInvalidOperationError(
        'The workspace root cannot be deleted',
      )
    }

    if (this.files.delete(normalizedPath)) return
    if (this.binaryFiles.delete(normalizedPath)) return
    if (!this.directories.has(normalizedPath)) {
      throw new WorkspaceEntryNotFoundError(normalizedPath)
    }

    const descendants = [
      ...this.directories,
      ...this.files.keys(),
      ...this.binaryFiles.keys(),
    ].filter(
      (candidate) =>
        candidate !== normalizedPath &&
        isWorkspacePathWithin(candidate, normalizedPath),
    )
    if (descendants.length > 0 && options.recursive !== true) {
      throw new WorkspaceDirectoryNotEmptyError(normalizedPath)
    }

    for (const directory of [...this.directories]) {
      if (directory === normalizedPath || isWorkspacePathWithin(directory, normalizedPath)) {
        this.directories.delete(directory)
      }
    }
    for (const file of [...this.files.keys()]) {
      if (isWorkspacePathWithin(file, normalizedPath)) this.files.delete(file)
    }
    for (const file of [...this.binaryFiles.keys()]) {
      if (isWorkspacePathWithin(file, normalizedPath)) this.binaryFiles.delete(file)
    }
  }

  async renameEntry(
    path: WorkspacePath,
    name: string,
  ): Promise<WorkspacePath> {
    const normalizedPath = requireDirectoryPath(path)
    if (normalizedPath === '') {
      throw new WorkspaceInvalidOperationError(
        'The workspace root cannot be renamed',
      )
    }
    const target = workspaceJoin(workspaceParent(normalizedPath), name)
    return this.moveEntryToTarget(normalizedPath, target)
  }

  async moveEntry(
    source: WorkspacePath,
    destinationDirectory: WorkspacePath,
  ): Promise<WorkspacePath> {
    const normalizedSource = requireDirectoryPath(source)
    const normalizedDestination = requireDirectoryPath(destinationDirectory)

    if (normalizedSource === '') {
      throw new WorkspaceInvalidOperationError(
        'The workspace root cannot be moved',
      )
    }
    this.requireDirectory(normalizedDestination)

    const sourceKind = this.entryKind(normalizedSource)
    if (sourceKind === undefined) {
      throw new WorkspaceEntryNotFoundError(normalizedSource)
    }
    if (normalizedSource === normalizedDestination) return normalizedSource
    if (
      sourceKind === 'directory' &&
      isWorkspacePathWithin(normalizedDestination, normalizedSource)
    ) {
      throw new WorkspaceInvalidOperationError(
        'A directory cannot be moved into itself or one of its descendants',
      )
    }

    const target = workspaceJoin(
      normalizedDestination,
      workspaceName(normalizedSource),
    )
    if (target === normalizedSource) return normalizedSource
    return this.moveEntryToTarget(normalizedSource, target)
  }

  hasFile(path: DocumentPath): boolean {
    const normalizedPath = requirePath(path)
    return this.files.has(normalizedPath) || this.binaryFiles.has(normalizedPath)
  }

  hasDirectory(path: WorkspacePath): boolean {
    const normalizedPath = requireDirectoryPath(path)
    return normalizedPath === '' || this.directories.has(normalizedPath)
  }

  hasEntry(path: WorkspacePath): boolean {
    const normalizedPath = requireDirectoryPath(path)
    return (
      this.files.has(normalizedPath) ||
      this.binaryFiles.has(normalizedPath) ||
      normalizedPath === '' ||
      this.directories.has(normalizedPath)
    )
  }

  /** Returns a defensive snapshot of file content for existing tests/adapters. */
  snapshot(): ReadonlyMap<DocumentPath, string> {
    return new Map(
      [...this.files.entries()].map(([path, content]) => [
        createDocumentPath(path),
        content,
      ]),
    )
  }

  snapshotDirectories(): ReadonlySet<WorkspacePath> {
    return new Set(this.directories)
  }

  /** Returns copied bytes for binary-file assertions and adapter tests. */
  snapshotBinary(): ReadonlyMap<WorkspacePath, Uint8Array> {
    return new Map(
      [...this.binaryFiles.entries()].map(([path, bytes]) => [
        path,
        new Uint8Array(bytes),
      ]),
    )
  }

  private registerDirectory(path: WorkspacePath): void {
    if (path === '') return
    if (this.files.has(path) || this.binaryFiles.has(path)) {
      throw new WorkspaceEntryAlreadyExistsError(path)
    }
    this.ensureParentDirectories(path)
    this.directories.add(path)
  }

  private registerFile(path: WorkspacePath, content: string): void {
    this.requirePathDoesNotExist(path)
    this.ensureParentDirectories(path)
    this.files.set(path, content)
  }

  private registerBinaryFile(path: WorkspacePath, data: Uint8Array): void {
    this.requirePathDoesNotExist(path)
    this.ensureParentDirectories(path)
    this.binaryFiles.set(path, requireBinaryContent(data))
  }

  private ensureParentDirectories(path: WorkspacePath): void {
    const parent = workspaceParent(path)
    if (parent === '') return

    const ancestors: WorkspacePath[] = []
    let current = parent
    while (current !== '') {
      ancestors.unshift(current)
      current = workspaceParent(current)
    }

    for (const ancestor of ancestors) {
      if (this.files.has(ancestor) || this.binaryFiles.has(ancestor)) {
        throw new WorkspaceInvalidOperationError(
          `A file blocks workspace directory ${ancestor}`,
        )
      }
      this.directories.add(ancestor)
    }
  }

  private requireParentDirectory(path: WorkspacePath): void {
    if (!parentDirectoryExists(this.directories, path)) {
      throw new WorkspaceEntryNotFoundError(workspaceParent(path))
    }
  }

  private requireDirectory(path: WorkspacePath): void {
    if (path !== '' && !this.directories.has(path)) {
      throw new WorkspaceEntryNotFoundError(path)
    }
  }

  private requirePathDoesNotExist(path: WorkspacePath): void {
    if (
      this.files.has(path) ||
      this.binaryFiles.has(path) ||
      this.directories.has(path)
    ) {
      throw new WorkspaceEntryAlreadyExistsError(path)
    }
  }

  private entryKind(path: WorkspacePath): 'file' | 'directory' | undefined {
    if (this.files.has(path) || this.binaryFiles.has(path)) return 'file'
    if (this.directories.has(path)) return 'directory'
    return undefined
  }

  private moveEntryToTarget(
    source: WorkspacePath,
    target: WorkspacePath,
  ): WorkspacePath {
    const sourceKind = this.entryKind(source)
    if (sourceKind === undefined) {
      throw new WorkspaceEntryNotFoundError(source)
    }
    if (sourceKind === 'directory' && isWorkspacePathWithin(target, source)) {
      throw new WorkspaceInvalidOperationError(
        'A directory cannot be moved into itself or one of its descendants',
      )
    }
    if (target !== source) this.requirePathDoesNotExist(target)

    if (sourceKind === 'file') {
      const content = this.files.get(source)
      if (content !== undefined) {
        this.files.delete(source)
        this.files.set(target, content)
        return target
      }
      const bytes = this.binaryFiles.get(source)
      if (bytes !== undefined) {
        this.binaryFiles.delete(source)
        this.binaryFiles.set(target, bytes)
        return target
      }
      throw new WorkspaceEntryNotFoundError(source)
    }

    const directoriesToMove = [...this.directories].filter((candidate) =>
      isWorkspacePathWithin(candidate, source),
    )
    const filesToMove = [...this.files.entries()].filter(([candidate]) =>
      isWorkspacePathWithin(candidate, source),
    )
    const binaryFilesToMove = [...this.binaryFiles.entries()].filter(
      ([candidate]) => isWorkspacePathWithin(candidate, source),
    )

    for (const directory of directoriesToMove) this.directories.delete(directory)
    for (const [file] of filesToMove) this.files.delete(file)
    for (const [file] of binaryFilesToMove) this.binaryFiles.delete(file)

    for (const directory of directoriesToMove) {
      this.directories.add(this.movePath(directory, source, target))
    }
    for (const [file, content] of filesToMove) {
      this.files.set(this.movePath(file, source, target), content)
    }
    for (const [file, bytes] of binaryFilesToMove) {
      this.binaryFiles.set(this.movePath(file, source, target), bytes)
    }

    return target
  }

  private movePath(
    path: WorkspacePath,
    source: WorkspacePath,
    target: WorkspacePath,
  ): WorkspacePath {
    const suffix = path === source ? '' : path.slice(source.length + 1)
    return createWorkspacePath(suffix === '' ? target : `${target}/${suffix}`)
  }
}
