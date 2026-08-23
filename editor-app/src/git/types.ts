// Git 数据类型（M11/M12/M16）：mock 与 tauri 后端共用
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

/** M16 SCM：XY 双码（git status --porcelain=v1 -z 保留两码） */
export interface GitFileStatus {
  path: string
  /** 兼容字段 = worktree 有码则 worktree 码，否则 index 码（旧角标/树 UI 仍可用） */
  status: string
  /** X 码：index vs HEAD（' ' = 未暂存；'?' 永不进 staged） */
  indexStatus: string
  /** Y 码：worktree vs index（' ' = 无工作区改动） */
  worktreeStatus: string
  /** R/C：旧路径（-z 下第二段记录；显示 "旧 → 新"） */
  renameFrom?: string
  /** Changes 区行数 = index..worktree numstat；未跟踪 = 磁盘行数 */
  added: number
  deleted: number
  /** staged 行数 = HEAD..index numstat（仅 staged 区显示用） */
  indexAdded: number
  indexDeleted: number
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

/**
 * M18 §4.7：批量端点单文件结果（预取层消费）——一次往返取回
 * 「旧内容 + 新内容 + hunks 非空标志 + 内容 hash」，消掉逐源 diffFile/showFile 往返。
 * rev：旧版本取 'HEAD'/base.from，新版本取 ''（index）/base.to/'WORKTREE'。
 */
export interface ShowFileEntry {
  /** 请求的引用写法（![[path]] 原文；writePath→realPath 映射完整） */
  write: string
  /** 解析后的真实路径（候选扩展名/宿主相对目录探测后的命中路径） */
  realPath: string
  /** 旧版本内容（该版本不存在 → null（新文件）） */
  old: string | null
  /** 新版本内容（读取失败 → null（断链/文件缺失）） */
  next: string | null
  /** 该文件在新版本中是否存在（磁盘/index 有文件） */
  exists: boolean
  /** 新旧内容是否有差异（hunks 非空标志；null = 无法判定） */
  changed: boolean | null
  /** 内容指纹（§4.6 新鲜度契约）：old/next 的稳定 hash */
  hash: { old: string; next: string } | null
}

export interface ShowFilesResult {
  entries: ShowFileEntry[]
}

/**
 * M16 SCM：diff 对比基准随分区变化（本次改造核心，见 docs/git-scm-redesign.md §4.1）
 * - unstaged:  index..worktree（Changes 区点击）
 * - staged:    HEAD..index（Staged 区点击）
 * - worktree:  HEAD..worktree（旧入口：文件树角标/标签右键——兼容保留）
 * - range:     from..to（历史 commit / Shift+点击范围）
 */
export type DiffBase =
  | { kind: 'unstaged'; label: string }
  | { kind: 'staged'; label: string }
  | { kind: 'worktree'; label: string }
  | { kind: 'range'; from: string; to: string; label: string }

/** diff 的 stage 层语义（backends 组装 rev 参数用） */
export function isDiffEditable(base: DiffBase): boolean {
  return base.kind === 'unstaged' || base.kind === 'worktree'
}