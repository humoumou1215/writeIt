// Git 能力层（M11）：tauri 后端可用；mock/web 返回不可用
// 数据源 = Rust 命令（git CLI），见 src-tauri/src/lib.rs

export interface GitRepoInfo {
  isRepo: boolean
  branch: string | null
  headHash: string | null
}

export interface GitBranch {
  name: string
  isCurrent: boolean
  remote: string | null
  aheadBehind: string | null
}

export interface GitFileStatus {
  path: string
  status: 'M' | 'A' | 'D' | 'U' | '?' | 'R' | 'C'
  added: number
  deleted: number
}

export interface GitCommit {
  hash: string
  author: string
  date: number
  message: string
}

export interface GitCommitFile {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | 'C'
  added: number
  deleted: number
}

export interface GitShowCommit {
  hash: string
  author: string
  date: number
  message: string
  files: GitCommitFile[]
}

export interface DiffWord {
  kind: 'add' | 'del' | 'ctx'
  text: string
}

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx'
  text: string
  /** M11b：词级高亮（修改对中 common 词 kind=ctx，变更词 kind=add/del）；无则整行着色 */
  words?: DiffWord[] | null
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface GitDiffResult {
  hunks: DiffHunk[]
  added: number
  deleted: number
  exists: boolean
}

/** diff 对比基准：from=null → 工作区 vs HEAD；from=sha → sha..to */
export interface DiffBase {
  from: string | null
  to: string
  label: string
}

export function isGitAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function core() {
  return await import('@tauri-apps/api/core')
}

export const git = {
  get available() {
    return isGitAvailable()
  },

  async repoInfo(): Promise<GitRepoInfo> {
    return (await core()).invoke('git_repo_info')
  },

  async branches(): Promise<GitBranch[]> {
    return (await core()).invoke('git_branches')
  },

  async status(): Promise<GitFileStatus[]> {
    return (await core()).invoke('git_status')
  },

  async log(limit = 50, branch?: string): Promise<GitCommit[]> {
    return (await core()).invoke('git_log', { limit, branch })
  },

  async showCommit(hash: string): Promise<GitShowCommit> {
    return (await core()).invoke('git_show_commit', { hash })
  },

  /** from=null → 工作区 vs HEAD；from=sha → sha..to */
  async diffFile(path: string, from: string | null, to: string): Promise<GitDiffResult> {
    return (await core()).invoke('git_diff_file', { path, from, to })
  },

  /** 取某版本的文件内容（渲染模式旧版本）：rev = 'HEAD' / '<sha>' / '<sha>^' */
  async showFile(path: string, rev: string): Promise<string> {
    return (await core()).invoke('git_show_file', { path, rev })
  },

  /** 还原整文件到 HEAD（丢弃全部未提交改动） */
  async discardFile(path: string): Promise<void> {
    return (await core()).invoke('git_discard_file', { path })
  },

  /** 还原单个 hunk（仅工作区 diff） */
  async discardHunk(path: string, hunkIndex: number): Promise<void> {
    return (await core()).invoke('git_discard_hunk', { path, hunkIndex })
  },

  /** 切换分支 */
  async checkoutBranch(name: string): Promise<void> {
    return (await core()).invoke('git_checkout_branch', { name })
  },
}
