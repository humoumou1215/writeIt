import type {
  WorkspaceEntry,
  WorkspacePath,
} from '../../core/workspace'
import type { FileSystemPort } from './port'

export interface WorkspaceDeleteOptions {
  /** Directories require an explicit recursive acknowledgement by default. */
  readonly recursive?: boolean
}

/**
 * Filesystem operations needed by the workspace tree. The tree is a derived
 * view of this port; it is refreshed after a successful mutation rather than
 * becoming a second source of file contents. File rename/move adapters must
 * preserve a text file's logical version token when they relocate unchanged
 * content, so a planned conditional write can safely address the new path.
 */
export interface WorkspaceFileSystemPort extends FileSystemPort {
  listDirectory(path: WorkspacePath): Promise<readonly WorkspaceEntry[]>
  createFile(path: WorkspacePath, content?: string): Promise<void>
  createDirectory(path: WorkspacePath): Promise<void>
  renameEntry(path: WorkspacePath, name: string): Promise<WorkspacePath>
  deleteEntry(
    path: WorkspacePath,
    options?: WorkspaceDeleteOptions,
  ): Promise<void>
  /** Moves an entry below a destination directory and returns its new path. */
  moveEntry(
    source: WorkspacePath,
    destinationDirectory: WorkspacePath,
  ): Promise<WorkspacePath>
}

/** Short alias for application code that treats the port as a workspace port. */
export type WorkspacePort = WorkspaceFileSystemPort
