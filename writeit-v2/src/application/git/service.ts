import type { WorkspacePath } from '../../core/workspace'
import { diffMarkdownSource, type RawDiffResult } from '../../core/diff'
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
} from '../../platform/git'

export class GitWorkbenchService {
  private infoCache: GitRepositoryInfo | undefined
  private statusesCache: readonly GitFileStatus[] | undefined

  constructor(
    private readonly repository: GitRepositoryPort,
    private readonly blamePort?: GitBlamePort,
  ) {}

  async repositoryInfo(force = false): Promise<GitRepositoryInfo> {
    if (!force && this.infoCache) return this.infoCache
    this.infoCache = await this.repository.repositoryInfo()
    return this.infoCache
  }

  async fileStatuses(force = false): Promise<readonly GitFileStatus[]> {
    if (!force && this.statusesCache) return this.statusesCache
    this.statusesCache = await this.repository.listFileStatuses()
    return this.statusesCache
  }

  async switchBranch(branch: string): Promise<void> {
    await this.repository.switchBranch(branch)
    this.invalidate()
  }

  async history(path: WorkspacePath, limit?: number): Promise<readonly GitCommit[]> {
    return this.repository.listHistory(path, limit)
  }

  async diff(target: GitDiffTarget): Promise<GitDiffResult> {
    return this.repository.diff(target)
  }

  async rawDiff(target: GitDiffTarget): Promise<RawDiffResult> {
    const result = await this.repository.diff(target)
    return diffMarkdownSource(result.before, result.after)
  }

  async blame(path: WorkspacePath, force = false): Promise<readonly GitBlameLine[]> {
    return this.blameCache.get(path) && !force ? this.blameCache.get(path)! : this.cacheBlame(path)
  }

  async fileHistory(path: WorkspacePath, limit?: number): Promise<readonly GitFileHistoryEntry[]> {
    if (!this.blamePort) throw new Error('Git blame port is not configured')
    return this.blamePort.fileHistory(path, limit)
  }

  invalidate(): void {
    this.infoCache = undefined
    this.statusesCache = undefined
    this.blameCache.clear()
  }

  async discardFile(path: WorkspacePath): Promise<void> {
    await this.repository.discardFile(path)
    this.invalidate()
  }

  async discardHunk(path: WorkspacePath, hunkId: string): Promise<void> {
    await this.repository.discardHunk(path, hunkId)
    this.invalidate()
  }

  private readonly blameCache = new Map<string, readonly GitBlameLine[]>()

  private async cacheBlame(path: WorkspacePath): Promise<readonly GitBlameLine[]> {
    if (!this.blamePort) throw new Error('Git blame port is not configured')
    const value = await this.blamePort.blame(path)
    this.blameCache.set(path, value)
    return value
  }
}
