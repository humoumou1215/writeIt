// Git 数据类型（M11/M12）：mock 与 tauri 后端共用
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
  /** M15：父提交 hash 列表（提交图画分叉/合并线；首提交为空） */
  parents: string[]
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

