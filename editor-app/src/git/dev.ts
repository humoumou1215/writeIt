// dev git 后端（M15/M16）：真实仓库模式 —— git CLI 由 Vite Node 中间件执行（child_process）
//   /__repo/git/*，返回结构对齐 tauri 后端（GitDiffResult / GitCommit.parents 等）
import type {
  GitBranch,
  GitCommit,
  GitDiffResult,
  GitFileStatus,
  GitRepoInfo,
  GitShowCommit,
  ShowFilesResult,
} from './types'
import type { DiffBase } from './types'

async function call<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/__repo/git/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string }
  if (!json.ok) throw new Error(json.error || `dev git ${action} 失败`)
  return json.data as T
}

export const devGit = {
  get available() {
    return true
  },

  repoInfo(): Promise<GitRepoInfo> {
    return call<GitRepoInfo>('repo-info')
  },
  branches(): Promise<GitBranch[]> {
    return call<GitBranch[]>('branches')
  },
  status(): Promise<GitFileStatus[]> {
    return call<GitFileStatus[]>('status')
  },
  log(limit = 50, branch?: string): Promise<GitCommit[]> {
    return call<GitCommit[]>('log', { limit, branch: branch ?? null })
  },
  showCommit(hash: string): Promise<GitShowCommit> {
    return call<GitShowCommit>('show-commit', { hash })
  },
  diffFile(path: string, base: DiffBase): Promise<GitDiffResult> {
    if (base.kind === 'range') {
      return call<GitDiffResult>('diff-file', { path, kind: 'range', from: base.from, to: base.to })
    }
    return call<GitDiffResult>('diff-file', { path, kind: base.kind, from: null, to: null })
  },
  showFile(path: string, rev: string): Promise<string> {
    return call<string>('show-file', { path, rev })
  },
  showFiles(paths: string[], base: DiffBase): Promise<ShowFilesResult> {
    if (base.kind === 'range') {
      return call<ShowFilesResult>('show-files', { paths, kind: 'range', from: base.from, to: base.to })
    }
    return call<ShowFilesResult>('show-files', { paths, kind: base.kind, from: null, to: null })
  },
  discardFile(path: string): Promise<void> {
    return call<void>('discard-file', { path })
  },
  discardHunk(path: string, hunkIndex: number): Promise<void> {
    return call<void>('discard-hunk', { path, hunkIndex })
  },
  checkoutBranch(name: string): Promise<void> {
    return call<void>('checkout-branch', { name })
  },
  // M16 SCM
  stage(paths: string[]): Promise<void> {
    return call<void>('stage', { paths })
  },
  unstage(paths: string[]): Promise<void> {
    return call<void>('unstage', { paths })
  },
  commit(message: string, opts?: { amend?: boolean; stageAll?: boolean }): Promise<{ hash: string }> {
    return call<{ hash: string }>('commit', {
      message,
      amend: opts?.amend ?? false,
      stageAll: opts?.stageAll ?? false,
    })
  },
  revertToHead(paths: string[]): Promise<void> {
    return call<void>('revert-to-head', { paths })
  },
  fetch(): Promise<void> {
    return call<void>('fetch')
  },
  pull(): Promise<void> {
    return call<void>('pull')
  },
  push(): Promise<void> {
    return call<void>('push')
  },
  aheadBehind(): Promise<{ ahead: number; behind: number } | null> {
    return call<{ ahead: number; behind: number } | null>('ahead-behind')
  },
  createBranch(name: string, from?: string): Promise<void> {
    return call<void>('create-branch', { name, from: from ?? null })
  },
  renameBranch(from: string, to: string): Promise<void> {
    return call<void>('rename-branch', { from, to })
  },
  deleteBranch(name: string): Promise<void> {
    return call<void>('delete-branch', { name })
  },
  ignore(path: string): Promise<void> {
    return call<void>('ignore', { path })
  },
}