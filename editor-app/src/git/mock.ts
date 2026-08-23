// M12/M16：mock git 后端（浏览器演示）——内置「Git演示」示例仓库
// 内存态：stage/unstage/commit/checkout 会改状态（刷新页面重置）
// 数据源：mock-data.ts（tests/scratch/gen-mock-git.js 用真实 git 仓库生成，勿手改）
// M16 SCM：新增暂存/提交/同步/分支接口的内存实现（语义保真即可，不做严格 git 模拟）

import type {
  GitBranch,
  GitCommit,
  GitDiffResult,
  GitFileStatus,
  GitRepoInfo,
  GitShowCommit,
  ShowFileEntry,
  ShowFilesResult,
} from './types'
import type { DiffBase } from './types'
import { contentHash } from './hash'
import {
  DEMO_BRANCHES,
  DEMO_LOG,
  DEMO_REPO,
  DEMO_SHOW_COMMIT,
  DEMO_STATUS,
  FEATURE_README,
  MEETING_HUNKS,
  MEETING_V1,
  MEETING_V2,
  MEETING_WORKTREE,
  README_COMMIT_HUNKS,
  README_HUNKS,
  README_V1,
  README_V2,
  README_WORKTREE,
  TABLE_HUNKS,
  TABLE_V1,
  TABLE_V2,
  TABLE_WORKTREE,
  CYCLE_HUNKS,
  CYCLE_A_V1,
  CYCLE_A_V2,
  CYCLE_B,
} from './mock-data'

// ---------- 内存状态 ----------

export const DEMO_PATHS = {
  README: 'Git演示/README.md',
  MEETING: 'Git演示/笔记/会议纪要.md',
  TABLE: 'Git演示/数据/需求表.md',
} as const

interface MockState {
  repo: GitRepoInfo
  branches: GitBranch[]
  status: GitFileStatus[]
  log: GitCommit[]
  showCommit: GitShowCommit
  /** 文件各版本内容：v1=初始提交 / v2=HEAD / worktree=工作区 / feature=功能分支 */
  files: Record<string, { v1: string; v2: string; worktree: string; feature: string }>
  /** 已暂存的路径集合（staged diff 演示用） */
  stagedPaths: Set<string>
  /** 尚未创建的提交栈（commit 后插入 log 头部）：{hash, message} */
  pendingCommits: { hash: string; message: string }[]
  commitSeq: number
  /** 远程同步演示：空操作；ahead/behind 返回固定演示值 */
  aheadBehind: { ahead: number; behind: number } | null
  hasRemote: boolean
}

function makeState(): MockState {
  return {
    repo: { ...DEMO_REPO },
    branches: DEMO_BRANCHES.map((b) => ({ ...b })),
    status: DEMO_STATUS.map((s) => ({ ...s })),
    log: DEMO_LOG.map((c) => ({ ...c })),
    showCommit: { ...DEMO_SHOW_COMMIT, files: DEMO_SHOW_COMMIT.files.map((f) => ({ ...f })) },
    files: {
      [DEMO_PATHS.README]: { v1: README_V1, v2: README_V2, worktree: README_WORKTREE, feature: FEATURE_README },
      [DEMO_PATHS.MEETING]: { v1: MEETING_V1, v2: MEETING_V2, worktree: MEETING_WORKTREE, feature: MEETING_V2 },
      [DEMO_PATHS.TABLE]: { v1: TABLE_V1, v2: TABLE_V2, worktree: TABLE_WORKTREE, feature: TABLE_V2 },
      // R1 演示集虚拟文件：双态（staged+worktree 两区同现）、staged-only、rename 新路径
      'Git演示/双态.md': { v1: '', v2: '# 双态\n\n基线内容\n', worktree: '# 双态\n\n基线内容\n\n工作区第二次修改\n', feature: '# 双态\n\n基线内容\n' },
      'Git演示/staged-only.md': { v1: '', v2: '', worktree: '# 仅暂存文件\n\n第一行\n第二行\n第三行\n', feature: '' },
      'Git演示/改名后.md': { v1: '', v2: '# 改名后的文档\n\n内容保持不变\n', worktree: '# 改名后的文档\n\n内容保持不变\n', feature: '' },
      'Git演示/改名前的旧名字.md': { v1: '# 旧名字内容\n', v2: '', worktree: '', feature: '' },
      // M18 fixture：循环嵌入（A 嵌 B 嵌 A）
      'Git演示/环测试/甲.md': { v1: CYCLE_A_V1, v2: CYCLE_A_V1, worktree: CYCLE_A_V2, feature: CYCLE_A_V2 },
      'Git演示/环测试/乙.md': { v1: CYCLE_B, v2: CYCLE_B, worktree: CYCLE_B, feature: CYCLE_B },
    },
    stagedPaths: new Set(),
    pendingCommits: [],
    commitSeq: 0,
    aheadBehind: { ahead: 0, behind: 0 },
    hasRemote: true,
  }
}

let state: MockState = makeState()

// ---------- 工具 ----------

function isConflict(f: GitFileStatus): boolean {
  return f.indexStatus.includes('U') || f.worktreeStatus.includes('U') ||
    (f.indexStatus === 'A' && f.worktreeStatus === 'A') ||
    (f.indexStatus === 'D' && f.worktreeStatus === 'D')
}

function copyStatus(): GitFileStatus[] {
  return state.status.map((s) => ({ ...s }))
}

/** 文件当前分区状态：'staged' | 'changes' | 'none' | 'conflict' */
function sectionOf(f: GitFileStatus): 'staged' | 'changes' | 'none' | 'conflict' {
  if (isConflict(f)) return 'conflict'
  if (f.indexStatus !== ' ' && f.indexStatus !== '?') return 'staged'
  return 'changes'
}

function nextHash(): string {
  state.commitSeq += 1
  return `mock-${Date.now().toString(16)}-${state.commitSeq}${state.commitSeq.toString(16).padStart(2, '0')}`
}

// ---------- 后端实现 ----------

export const mockGit = {
  get available() {
    return true
  },

  async repoInfo(): Promise<GitRepoInfo> {
    return { ...state.repo }
  },

  async branches(): Promise<GitBranch[]> {
    return state.branches.map((b) => ({ ...b, isCurrent: b.name === state.repo.branch }))
  },

  async status(): Promise<GitFileStatus[]> {
    const list = copyStatus()
    // 合并共有 staged + worktree 状态的本地改码：演示仓库初始双码已来自 DEMO_STATUS
    return list
  },

  async log(limit = 50, _branch?: string): Promise<GitCommit[]> {
    const list = [...state.pendingCommits.map((c) => ({
      hash: c.hash,
      parents: [state.log[0]?.hash ?? ''],
      author: 'You',
      date: Math.floor(Date.now() / 1000),
      message: c.message,
    })), ...state.log.map((c) => ({ ...c }))]
    return list.slice(0, limit)
  },

  async showCommit(_hash: string): Promise<GitShowCommit> {
    const pending = state.pendingCommits.find((c) => _hash === c.hash)
    if (pending) {
      const files = state.status
        .filter((s) => sectionOf(s) !== 'none')
        .map((s) => ({
          path: s.path,
          status: (s.status === '?' ? 'A' : s.status) as 'M' | 'A' | 'D' | 'R' | 'C',
          added: Math.max(s.added, 0) + Math.max(s.indexAdded, 0),
          deleted: Math.max(s.deleted, 0) + Math.max(s.indexDeleted, 0),
        }))
        .filter((f) => !(f.added === 0 && f.deleted === 0))
      return {
        hash: pending.hash,
        author: 'You',
        date: Math.floor(Date.now() / 1000),
        message: pending.message,
        files,
      }
    }
    return { ...state.showCommit, files: state.showCommit.files.map((f) => ({ ...f })) }
  },

  async diffFile(path: string, base: DiffBase): Promise<GitDiffResult> {
    const f = state.files[path]
    const st = state.status.find((s) => s.path === path)
    // 冲突文件：演示返回空（前端走 combined 语义在真实后端；mock 仅验证流程）
    if (st && sectionOf(st) === 'conflict') {
      return { hunks: [], added: 0, deleted: 0, exists: true }
    }
    // range / worktree：沿用存量 worktree hunks
    if (base.kind === 'range') {
      if (path === DEMO_PATHS.README && base.to !== 'HEAD') {
        return { hunks: README_COMMIT_HUNKS, added: 16, deleted: 1, exists: true }
      }
      return { hunks: [], added: 0, deleted: 0, exists: true }
    }
    // staged：已暂存 → 演示用 worktree hunks（近似 staged 内容）；未暂存 → 空
    if (base.kind === 'staged') {
      const staged = st && st.indexStatus !== ' ' && st.indexStatus !== '?'
      if (!staged) return { hunks: [], added: 0, deleted: 0, exists: true }
      const hunks =
        path === DEMO_PATHS.README ? README_HUNKS
        : path === DEMO_PATHS.MEETING ? MEETING_HUNKS
        : path === DEMO_PATHS.TABLE ? TABLE_HUNKS
        : []
      const stats =
        path === DEMO_PATHS.README ? { added: 8, deleted: 9 }
        : path === DEMO_PATHS.MEETING ? { added: 2, deleted: 1 }
        : { added: 2, deleted: 1 }
      return { hunks, added: stats.added, deleted: stats.deleted, exists: true }
    }
    // unstaged / worktree：存在 worktree 改动才显示
    if (!f) return { hunks: [], added: 0, deleted: 0, exists: false }
    if (f.worktree === f.v2) return { hunks: [], added: 0, deleted: 0, exists: true }
    const hunks =
      path === DEMO_PATHS.README ? README_HUNKS
      : path === DEMO_PATHS.MEETING ? MEETING_HUNKS
      : path === DEMO_PATHS.TABLE ? TABLE_HUNKS
      : path === 'Git演示/环测试/甲.md' ? CYCLE_HUNKS
      : []
    const stats =
      path === DEMO_PATHS.README ? { added: 8, deleted: 9 }
      : path === DEMO_PATHS.MEETING ? { added: 2, deleted: 1 }
      : { added: 2, deleted: 1 }
    return { hunks, added: stats.added, deleted: stats.deleted, exists: true }
  },

  async showFile(path: string, rev: string): Promise<string> {
    const f = state.files[path]
    if (!f) throw new Error(`文件不存在：${path}`)
    if (rev === 'WORKTREE') return f.worktree
    if (rev === '') return f.worktree // index blob（演示近似：未暂存时 = worktree）
    if (rev === 'HEAD' || rev === DEMO_REPO.headHash) return f.v2
    return f.v1
  },

  // M18 §4.7：批量端点（mock 最先实现——它同时是 e2e fixture 的运行后端）。
  // 一次往返解析候选路径 + 取旧/新内容 + hunks 标志 + 内容 hash。
  async showFiles(reqPaths: string[], base: DiffBase): Promise<ShowFilesResult> {
    const entries: ShowFileEntry[] = []
    // 每次请求产一个 entry（writePath→realPath 映射完整性；同一 realPath 重复请求由
    // 消费者（sourceMap 按 realPath 去重）负责，兄弟重复嵌入合法）
    for (const req of reqPaths) {
      // 候选扩展名探测（同 resolveRefFilePath 语义，移后端一次完成）
      const cands = [req, `${req}.md`, `${req}.markdown`, `${req}.txt`]
      let realPath: string | null = null
      for (const c of cands) {
        if (state.files[c]) {
          realPath = c
          break
        }
      }
      if (!realPath) {
        entries.push({ write: req, realPath: req, old: null, next: null, exists: false, changed: null, hash: null })
        continue
      }
      const f = state.files[realPath]
      // 旧版本 rev
      // 旧版本 rev（range 取 from；其余 HEAD）
      let oldRev = 'HEAD'
      if (base.kind === 'range') oldRev = base.from || 'HEAD'
      // 新版本 rev（worktree/index/range.to）
      let newRev: string
      if (base.kind === 'worktree' || base.kind === 'unstaged') newRev = 'WORKTREE'
      else if (base.kind === 'staged') newRev = ''
      else newRev = base.to || 'HEAD'
      let old: string | null
      try {
        old = await this.showFile(realPath, oldRev)
      } catch {
        old = null // 新文件：旧版本不存在
      }
      let next: string | null
      try {
        next = await this.showFile(realPath, newRev)
      } catch {
        next = null // 断链
      }
      const exists = Boolean(f && next != null)
      const changed = old != null && next != null ? old !== next : old == null && next != null ? true : null
      entries.push({
        write: req,
        realPath,
        old,
        next,
        exists,
        changed,
        hash: old == null && next == null ? null : { old: contentHash(old ?? ''), next: contentHash(next ?? '') },
      })
    }
    return { entries }
  },

  async discardFile(path: string): Promise<void> {
    const f = state.files[path]
    if (f) f.worktree = f.v2
    state.status = state.status.filter((s) => s.path !== path)
    state.stagedPaths.delete(path)
  },

  async discardHunk(path: string, _hunkIndex: number): Promise<void> {
    return this.discardFile(path)
  },

  async checkoutBranch(name: string): Promise<void> {
    state.repo.branch = name
    if (name === 'feature/图表优化') {
      state.files[DEMO_PATHS.README].worktree = state.files[DEMO_PATHS.README].feature
      state.files[DEMO_PATHS.MEETING].worktree = state.files[DEMO_PATHS.MEETING].feature
      state.files[DEMO_PATHS.TABLE].worktree = state.files[DEMO_PATHS.TABLE].feature
      state.status = []
      state.stagedPaths.clear()
      state.log = [state.log[0]]
    } else {
      state = makeState()
    }
  },

  // ---- M16 SCM ----
  async stage(paths: string[]): Promise<void> {
    for (const p of paths) {
      const f = state.status.find((s) => s.path === p)
      if (!f) continue
      if (f.worktreeStatus !== ' ') {
        // Y → X（暂存）；未跟踪 → A
        if (f.worktreeStatus === '?') {
          f.indexStatus = 'A'
          f.worktreeStatus = ' '
          f.status = 'A'
          f.indexAdded = f.added
          f.indexDeleted = 0
        } else {
          f.indexStatus = f.worktreeStatus
          f.worktreeStatus = ' '
          f.status = f.indexStatus
          f.indexAdded = f.added >= 0 ? f.added : 0
          f.indexDeleted = f.deleted >= 0 ? f.deleted : 0
          f.added = 0
          f.deleted = 0
        }
        state.stagedPaths.add(p)
      } else if (f.indexStatus !== ' ') {
        // 已暂存（chill）
        state.stagedPaths.add(p)
      }
    }
  },

  async unstage(paths: string[]): Promise<void> {
    for (const p of paths) {
      const f = state.status.find((s) => s.path === p)
      if (!f) continue
      if (f.indexStatus !== ' ') {
        f.worktreeStatus = f.indexStatus === 'A' ? '?' : 'M'
        f.indexStatus = ' '
        f.status = f.worktreeStatus
        f.added = f.indexAdded >= 0 ? f.indexAdded : 0
        f.deleted = f.indexDeleted >= 0 ? f.indexDeleted : 0
        f.indexAdded = -1
        f.indexDeleted = -1
        state.stagedPaths.delete(p)
      }
    }
  },

  async commit(message: string, opts?: { amend?: boolean; stageAll?: boolean }): Promise<{ hash: string }> {
    if (opts?.stageAll) {
      const all = state.status.filter((s) => sectionOf(s) === 'changes' || s.worktreeStatus === '?')
      await this.stage(all.map((s) => s.path))
    }
    const hash = nextHash()
    // 落盘：worktree → v2（staged 内容近似 worktree）
    for (const p of state.stagedPaths) {
      const f = state.files[p]
      if (f) f.v2 = f.worktree
    }
    state.status = state.status.filter((s) => !state.stagedPaths.has(s.path))
    state.stagedPaths.clear()
    state.pendingCommits.unshift({ hash, message })
    state.repo.headHash = hash
    return { hash }
  },

  async revertToHead(paths: string[]): Promise<void> {
    for (const p of paths) {
      const f = state.files[p]
      if (f) f.worktree = f.v2
    }
    state.status = state.status.filter((s) => !paths.includes(s.path))
    for (const p of paths) state.stagedPaths.delete(p)
  },

  async fetch(): Promise<void> { /* 演示空操作 */ },
  async pull(): Promise<void> { /* 演示空操作 */ },
  async push(): Promise<void> { state.aheadBehind = { ahead: 0, behind: 0 } },

  async aheadBehind(): Promise<{ ahead: number; behind: number } | null> {
    return state.aheadBehind ? { ...state.aheadBehind } : null
  },

  async createBranch(name: string, _from?: string): Promise<void> {
    state.branches.push({ name, isCurrent: false, remote: null, aheadBehind: null })
  },

  async renameBranch(from: string, to: string): Promise<void> {
    const b = state.branches.find((x) => x.name === from)
    if (b) b.name = to
  },

  async deleteBranch(name: string): Promise<void> {
    state.branches = state.branches.filter((b) => b.name !== name)
  },

  async ignore(_path: string): Promise<void> { /* 演示空操作 */ },
}

/** 重置 mock 状态（演示数据恢复初始） */
export function resetMockGit() {
  state = makeState()
}