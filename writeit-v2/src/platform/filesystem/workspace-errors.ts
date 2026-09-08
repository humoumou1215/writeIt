import type { WorkspacePath } from '../../core/workspace'

export class WorkspaceEntryNotFoundError extends Error {
  readonly path: WorkspacePath

  constructor(path: WorkspacePath) {
    super(`Workspace entry not found: ${path || '.'}`)
    this.name = 'WorkspaceEntryNotFoundError'
    this.path = path
  }
}

export class WorkspaceEntryAlreadyExistsError extends Error {
  readonly path: WorkspacePath

  constructor(path: WorkspacePath) {
    super(`Workspace entry already exists: ${path || '.'}`)
    this.name = 'WorkspaceEntryAlreadyExistsError'
    this.path = path
  }
}

export class WorkspaceDirectoryNotEmptyError extends Error {
  readonly path: WorkspacePath

  constructor(path: WorkspacePath) {
    super(`Workspace directory is not empty: ${path || '.'}`)
    this.name = 'WorkspaceDirectoryNotEmptyError'
    this.path = path
  }
}

export class WorkspaceInvalidOperationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceInvalidOperationError'
  }
}
