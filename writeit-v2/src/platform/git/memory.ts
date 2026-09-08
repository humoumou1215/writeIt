import type {
  GitBlameLine,
  GitBlamePort,
  GitCommit,
  GitDiffResult,
  GitDiffTarget,
  GitFileHistoryEntry,
  GitFileStatus,
  GitRepositoryInfo,
  GitRepositoryPort,
} from './types'
import { GitPortError } from './types'
import type { WorkspacePath } from '../../core/workspace'

export interface MemoryGitSnapshot {
  readonly info?: Partial<GitRepositoryInfo>
  readonly statuses?: readonly GitFileStatus[]
  readonly history?: Readonly<Record<string, readonly GitCommit[]>>
  readonly content?: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly diffs?: Readonly<Record<string, GitDiffResult>>
  readonly blame?: Readonly<Record<string, readonly GitBlameLine[]>>
  readonly fileHistory?: Readonly<Record<string, readonly GitFileHistoryEntry[]>>
}

export class MemoryGitAdapter implements GitRepositoryPort, GitBlamePort {
  private readonly snapshot: MemoryGitSnapshot
  private failure: GitPortError | undefined
  readonly discarded: WorkspacePath[] = []

  constructor(snapshot: MemoryGitSnapshot = {}) {
    this.snapshot = snapshot
  }

  failNext(error: GitPortError = new GitPortError('command-failed', 'Git command failed')): void {
    this.failure = error
  }

  async repositoryInfo(): Promise<GitRepositoryInfo> {
    this.throwFailure()
    return {
      isGitRepository: this.snapshot.info?.isGitRepository ?? true,
      rootPath: this.snapshot.info?.rootPath,
      head: this.snapshot.info?.head ?? 'HEAD',
      branch: this.snapshot.info?.branch ?? 'main',
      branches: Object.freeze([...(this.snapshot.info?.branches ?? ['main'])]),
    }
  }

  async listFileStatuses(): Promise<readonly GitFileStatus[]> {
    this.throwFailure()
    return Object.freeze([...(this.snapshot.statuses ?? [])])
  }

  async switchBranch(_branch: string): Promise<void> {
    this.throwFailure()
  }

  async listHistory(path: WorkspacePath, limit = 50): Promise<readonly GitCommit[]> {
    this.throwFailure()
    return Object.freeze([...(this.snapshot.history?.[path] ?? [])].slice(0, limit))
  }

  async readFileAt(ref: string, path: WorkspacePath): Promise<string> {
    this.throwFailure()
    const content = this.snapshot.content?.[ref]?.[path]
    if (content === undefined) throw new GitPortError('command-failed', `No Git content for ${ref}:${path}`)
    return content
  }

  async diff(target: GitDiffTarget): Promise<GitDiffResult> {
    this.throwFailure()
    const key = targetKey(target)
    const result = this.snapshot.diffs?.[key]
    if (!result) throw new GitPortError('command-failed', `No diff fixture for ${key}`)
    return result
  }

  async discardFile(path: WorkspacePath): Promise<void> {
    this.throwFailure()
    this.discarded.push(path)
  }

  async discardHunk(path: WorkspacePath, _hunkId: string): Promise<void> {
    this.throwFailure()
    this.discarded.push(path)
  }

  async blame(path: WorkspacePath): Promise<readonly GitBlameLine[]> {
    this.throwFailure()
    return Object.freeze([...(this.snapshot.blame?.[path] ?? [])])
  }

  async fileHistory(path: WorkspacePath, limit = 50): Promise<readonly GitFileHistoryEntry[]> {
    this.throwFailure()
    return Object.freeze([...(this.snapshot.fileHistory?.[path] ?? [])].slice(0, limit))
  }

  private throwFailure(): void {
    if (!this.failure) return
    const error = this.failure
    this.failure = undefined
    throw error
  }
}

export function targetKey(target: GitDiffTarget): string {
  if (target.kind === 'worktree-vs-head') return `worktree:${target.path}`
  if (target.kind === 'commit') return `commit:${target.commitId}:${target.path}`
  return `range:${target.fromCommit}:${target.toCommit}:${target.path}`
}
