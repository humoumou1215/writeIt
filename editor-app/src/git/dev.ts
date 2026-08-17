// dev git 后端（M15）：真实仓库模式 —— git CLI 由 Vite Node 中间件执行（child_process）
//   /__repo/git/*，返回结构对齐 tauri 后端（GitDiffResult / GitCommit.parents 等）
import type {
  GitBranch,
  GitCommit,
  GitDiffResult,
  GitFileStatus,
  GitRepoInfo,
  GitShowCommit,
} from './types'

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
  diffFile(path: string, from: string | null, to: string): Promise<GitDiffResult> {
    return call<GitDiffResult>('diff-file', { path, from, to })
  },
  showFile(path: string, rev: string): Promise<string> {
    return call<string>('show-file', { path, rev })
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
}