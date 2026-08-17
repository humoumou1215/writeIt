// Git 能力层（M11/M12）：proxy 后端模式
//   tauri → Rust 命令（git CLI，见 src-tauri/src/lib.rs）
//   mock  → 内置演示仓库（浏览器 vite dev 直接查看 git diff 效果）
//   web   → 真实目录模式无 git 能力（不可用）
import type {
  GitBranch,
  GitCommit,
  GitDiffResult,
  GitFileStatus,
  GitRepoInfo,
  GitShowCommit,
} from './types'
import { mockGit, resetMockGit } from './mock'
import { devGit } from './dev'
import { isDevRepoMode } from '../dev-repo'

export type {
  GitRepoInfo,
  GitBranch,
  GitFileStatus,
  GitCommit,
  GitCommitFile,
  GitShowCommit,
  DiffWord,
  DiffLine,
  DiffHunk,
  GitDiffResult,
  DiffBase,
} from './types'

export interface GitBackend {
  readonly available: boolean
  repoInfo(): Promise<GitRepoInfo>
  branches(): Promise<GitBranch[]>
  status(): Promise<GitFileStatus[]>
  log(limit?: number, branch?: string): Promise<GitCommit[]>
  showCommit(hash: string): Promise<GitShowCommit>
  diffFile(path: string, from: string | null, to: string): Promise<GitDiffResult>
  showFile(path: string, rev: string): Promise<string>
  discardFile(path: string): Promise<void>
  discardHunk(path: string, hunkIndex: number): Promise<void>
  checkoutBranch(name: string): Promise<void>
}

// ---------- tauri 后端 ----------

async function core() {
  return await import('@tauri-apps/api/core')
}

const tauriBackend: GitBackend = {
  get available() {
    return true
  },
  async repoInfo() {
    return (await core()).invoke('git_repo_info')
  },
  async branches() {
    return (await core()).invoke('git_branches')
  },
  async status() {
    return (await core()).invoke('git_status')
  },
  async log(limit = 50, branch?: string) {
    return (await core()).invoke('git_log', { limit, branch })
  },
  async showCommit(hash: string) {
    return (await core()).invoke('git_show_commit', { hash })
  },
  async diffFile(path: string, from: string | null, to: string) {
    return (await core()).invoke('git_diff_file', { path, from, to })
  },
  async showFile(path: string, rev: string) {
    return (await core()).invoke('git_show_file', { path, rev })
  },
  async discardFile(path: string) {
    return (await core()).invoke('git_discard_file', { path })
  },
  async discardHunk(path: string, hunkIndex: number) {
    return (await core()).invoke('git_discard_hunk', { path, hunkIndex })
  },
  async checkoutBranch(name: string) {
    return (await core()).invoke('git_checkout_branch', { name })
  },
}

// ---------- 后端选择（跟随 fs：tauri / dev 默认真实仓库 / mock 显式 / web 真实目录禁用） ----------

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let backend: GitBackend | null = isTauri() ? tauriBackend : isDevRepoMode() ? devGit : mockGit

/** 当前 git 后端类型：'tauri' | 'mock' | 'dev' | null（不可用） */
export function gitBackendKind(): 'tauri' | 'mock' | 'dev' | null {
  if (backend === tauriBackend) return 'tauri'
  if (backend === mockGit) return 'mock'
  if (backend === devGit) return 'dev'
  return null
}

export function isMockGit(): boolean {
  return gitBackendKind() === 'mock'
}

/** 浏览器打开真实目录（web 后端）→ git 不可用 */
export function disableGitForRealDir() {
  backend = null
}

/** 恢复 mock git（回到浏览器演示模式） */
export function resetMockGitBackend() {
  backend = mockGit
  resetMockGit()
}

export function isGitAvailable(): boolean {
  return backend !== null
}

export const git = new Proxy({} as GitBackend & { available: boolean }, {
  get: (_target, prop: string | symbol) => {
    if (prop === 'available') return backend !== null
    const b = backend
    if (!b) {
      // 不可用时的兜底：抛错由调用方 toast
      if (prop === 'resetMock') return undefined
      return async () => {
        throw new Error('Git 功能在当前模式不可用')
      }
    }
    const v = (b as unknown as Record<string | symbol, unknown>)[prop]
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(b) : v
  },
})
