// M12：mock git 后端（浏览器演示）——内置「Git演示」示例仓库（M14：数据来自真实 git diff）
// 让 vite dev 环境可直接查看 git diff 预期效果（面板/文本/渲染/还原/分支切换全流程）
// 数据源：mock-data.ts（tests/scratch/gen-mock-git.js 用真实 git 仓库生成，勿手改）
// 仓库结构：Git演示/README.md（mermaid/嵌入/词级/纯删除）+ 笔记/会议纪要.md（嵌入块内容调整）+ 数据/需求表.md（表格单元格级）
// 内存态：discard / checkout 会修改状态（刷新页面重置）

import type {
  GitBranch,
  GitCommit,
  GitDiffResult,
  GitFileStatus,
  GitRepoInfo,
  GitShowCommit,
} from './types'
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
    },
  }
}

let state: MockState = makeState()

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
    return state.status.map((s) => ({ ...s }))
  },

  async log(limit = 50, branch?: string): Promise<GitCommit[]> {
    const list = branch && branch !== state.repo.branch ? state.log.slice(0, 1) : state.log
    return list.slice(0, limit).map((c) => ({ ...c }))
  },

  async showCommit(_hash: string): Promise<GitShowCommit> {
    return { ...state.showCommit, files: state.showCommit.files.map((f) => ({ ...f })) }
  },

  async diffFile(path: string, from: string | null, to: string): Promise<GitDiffResult> {
    // 工作区 vs HEAD
    if (from === null && to === 'HEAD') {
      const hunks =
        path === DEMO_PATHS.README ? README_HUNKS
        : path === DEMO_PATHS.MEETING ? MEETING_HUNKS
        : path === DEMO_PATHS.TABLE ? TABLE_HUNKS
        : []
      const stats =
        path === DEMO_PATHS.README ? { added: 8, deleted: 9 }
        : path === DEMO_PATHS.MEETING ? { added: 2, deleted: 1 }
        : path === DEMO_PATHS.TABLE ? { added: 2, deleted: 1 }
        : { added: 0, deleted: 0 }
      return { hunks, added: stats.added, deleted: stats.deleted, exists: true }
    }
    // commit vs 父提交：README 有内容（初始骨架 → 完整版），其余文件该提交无差异
    if (from && from.endsWith('^')) {
      if (path === DEMO_PATHS.README) {
        return { hunks: README_COMMIT_HUNKS, added: 16, deleted: 1, exists: true }
      }
      return { hunks: [], added: 0, deleted: 0, exists: true }
    }
    // 范围对比：v1 简化返回无改动（文本/渲染空态即可验证流程）
    return { hunks: [], added: 0, deleted: 0, exists: true }
  },

  async showFile(path: string, rev: string): Promise<string> {
    const f = state.files[path]
    if (!f) throw new Error(`文件不存在：${path}`)
    if (rev === 'WORKTREE') return f.worktree
    if (rev === 'HEAD' || rev === DEMO_REPO.headHash) return f.v2
    // 父提交 / 初始提交 → v1
    return f.v1
  },

  async discardFile(path: string): Promise<void> {
    const f = state.files[path]
    if (f) f.worktree = f.v2
    state.status = state.status.filter((s) => s.path !== path)
  },

  async discardHunk(path: string, _hunkIndex: number): Promise<void> {
    const f = state.files[path]
    if (f) f.worktree = f.v2
    state.status = state.status.filter((s) => s.path !== path)
  },

  async checkoutBranch(name: string): Promise<void> {
    state.repo.branch = name
    if (name === 'feature/图表优化') {
      // 切到功能分支：工作区 = feature 版本，无未提交改动
      state.files[DEMO_PATHS.README].worktree = state.files[DEMO_PATHS.README].feature
      state.files[DEMO_PATHS.MEETING].worktree = state.files[DEMO_PATHS.MEETING].feature
      state.files[DEMO_PATHS.TABLE].worktree = state.files[DEMO_PATHS.TABLE].feature
      state.status = []
      state.log = [state.log[0]]
    } else {
      state = makeState()
    }
  },
}

/** 重置 mock 状态（演示数据恢复初始） */
export function resetMockGit() {
  state = makeState()
}
