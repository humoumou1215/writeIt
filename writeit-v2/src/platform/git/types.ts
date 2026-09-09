import type { WorkspacePath } from '../../core/workspace'

export type GitFileStatusKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export interface GitRepositoryInfo {
  readonly isGitRepository: boolean
  readonly rootPath?: WorkspacePath
  readonly head?: string
  readonly branch?: string
  readonly branches: readonly string[]
}

export interface GitFileStatus {
  readonly path: WorkspacePath
  readonly status: GitFileStatusKind
  readonly staged: boolean
  readonly oldPath?: WorkspacePath
}

export interface GitCommit {
  readonly id: string
  readonly authorName: string
  readonly authorEmail?: string
  readonly authorTime: string
  readonly summary: string
  readonly parentIds: readonly string[]
}

export type GitDiffTarget =
  | { readonly kind: 'worktree-vs-head'; readonly path: WorkspacePath }
  | { readonly kind: 'commit'; readonly commitId: string; readonly path: WorkspacePath }
  | { readonly kind: 'range'; readonly fromCommit: string; readonly toCommit: string; readonly path: WorkspacePath }

export interface GitDiffLine {
  readonly kind: 'context' | 'added' | 'removed'
  readonly text: string
  readonly oldLine?: number
  readonly newLine?: number
}

export interface GitDiffHunk {
  readonly id: string
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  readonly lines: readonly GitDiffLine[]
}

export interface GitDiffResult {
  readonly target: GitDiffTarget
  readonly before: string
  readonly after: string
  readonly hunks: readonly GitDiffHunk[]
  readonly rawChangeCount: number
}

export interface GitBlameLine {
  readonly line: number
  readonly kind: 'committed' | 'uncommitted' | 'unknown'
  readonly commitId?: string
  readonly authorName?: string
  readonly authorEmail?: string
  readonly authorTime?: string
  readonly summary?: string
  readonly originalPath?: WorkspacePath
  readonly originalLine?: number
}

export interface GitFileHistoryEntry extends GitCommit {
  readonly path: WorkspacePath
  readonly previousPath?: WorkspacePath
}

export interface GitRepositoryPort {
  repositoryInfo(): Promise<GitRepositoryInfo>
  switchBranch(branch: string): Promise<void>
  listFileStatuses(): Promise<readonly GitFileStatus[]>
  listHistory(path: WorkspacePath, limit?: number): Promise<readonly GitCommit[]>
  readFileAt(ref: string, path: WorkspacePath): Promise<string>
  diff(target: GitDiffTarget): Promise<GitDiffResult>
  discardFile(path: WorkspacePath): Promise<void>
  discardHunk(path: WorkspacePath, hunkId: string): Promise<void>
}

export interface GitBlamePort {
  blame(path: WorkspacePath): Promise<readonly GitBlameLine[]>
  fileHistory(path: WorkspacePath, limit?: number): Promise<readonly GitFileHistoryEntry[]>
}

export class GitPortError extends Error {
  readonly code: 'not-git' | 'command-failed' | 'conflict' | 'invalid-target'

  constructor(code: GitPortError['code'], message: string) {
    super(message)
    this.name = 'GitPortError'
    this.code = code
  }
}
