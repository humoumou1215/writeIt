// M12：mock git 后端（浏览器演示）——内置「演示笔记」示例仓库
// 让 vite dev 环境可直接查看 git diff 预期效果（面板/文本/渲染/还原/分支切换全流程）
// 数据是内存态：discard / checkout 会修改状态（刷新页面重置）

import type {
  GitBranch,
  GitCommit,
  GitDiffResult,
  GitFileStatus,
  GitRepoInfo,
  GitShowCommit,
} from './types'

// ---------- 示例仓库内容 ----------

// 嵌入 ![[ 必须独立成段（remark-ref：fileBlock = 整段匹配）
const README_HEAD = `# 演示笔记

> 旧版本说明：这段提醒只存在于 HEAD，工作区版本中已删除（展示纯删除块的红底划线效果）。

本仓库演示 Git 工作台的全部效果：

- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比）
- 切「文本」模式查看分栏与词级高亮
- 历史区点提交查看 commit diff；Shift+点击两提交做范围对比
- 工具栏「还原…」可还原整文件或单段改动

## 需求清单

- 需求一：登录模块
- 需求二：支付模块
- 需求三：报表模块

## 流程图

\`\`\`mermaid
graph TD
  A[开始] --> B{是否有余额}
  B -- 是 --> C[支付成功]
  B -- 否 --> D[余额不足]
  D --> E[引导充值]
\`\`\`

## 嵌入笔记

![[笔记/会议记录.md]]

## 相关引用

- 参见 [[笔记/会议记录.md#议题]]
- 参见 [[README#需求清单]]`
const README_WORKTREE = `# 演示笔记

本仓库演示 Git 工作台的全部效果：

- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比 + 批注连线）
- 切「文本」模式查看分栏与**词级**高亮
- 历史区点提交查看 commit diff；Shift+点击两提交做范围对比
- 工具栏「还原…」可还原整文件或单段改动

## 需求清单

- 需求一：登录与权限模块
- 需求二：支付与退款模块
- 需求三：报表与统计模块
- 需求四：消息通知模块

## 流程图

\`\`\`mermaid
graph TD
  A[开始] --> B{是否有余额}
  B -- 是 --> C[授信成功]
  B -- 否 --> D[余额不足]
  D --> E[引导充值]
\`\`\`

## 嵌入笔记

![[笔记/会议记录.md]]

## 相关引用

- 参见 [[笔记/会议记录.md#议题]]
- 参见 [[README#需求清单]]`
const MEETING_HEAD = `# 会议记录

## 议题

1. 支付流程评审
2. 报表口径确认

> 备注：本期只做支付，不做退款。
`

const MEETING_WORKTREE = `# 会议记录

## 议题

1. 支付流程评审
2. 报表口径确认
3. 消息通知需求收集

> 备注：本期只做支付，退款下期排期。
`

const FEATURE_README = `# 演示笔记（feature 分支版本）

功能分支：仅演示切换分支后内容与 diff 状态变化。
`

// ---------- 内存状态 ----------

interface MockState {
  repo: GitRepoInfo
  branches: GitBranch[]
  status: GitFileStatus[]
  log: GitCommit[]
  showCommit: GitShowCommit
  /** 文件各分支/版本内容 */
  files: Record<string, { head: string; worktree: string; feature: string }>
}

function makeState(): MockState {
  const now = Math.floor(Date.now() / 1000)
  return {
    repo: { isRepo: true, branch: 'main', headHash: 'a1b2c3d4' },
    branches: [
      { name: 'main', isCurrent: true, remote: 'origin/main', aheadBehind: null },
      { name: 'feature/图表优化', isCurrent: false, remote: null, aheadBehind: null },
      { name: 'origin/main', isCurrent: false, remote: null, aheadBehind: null },
    ],
    status: [
      { path: 'README.md', status: 'M', added: 14, deleted: 5 },
      { path: '笔记/会议记录.md', status: 'M', added: 2, deleted: 1 },
    ],
    log: [
      {
        hash: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1',
        author: 'Alice',
        date: now - 86400 * 2,
        message: '优化流程图与需求清单',
      },
      {
        hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        author: 'Bob',
        date: now - 86400 * 5,
        message: '初始提交：演示笔记骨架',
      },
    ],
    showCommit: {
      hash: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1',
      author: 'Alice',
      date: now - 86400 * 2,
      message: '优化流程图与需求清单',
      files: [
        { path: 'README.md', status: 'M', added: 14, deleted: 5 },
        { path: '笔记/会议记录.md', status: 'M', added: 2, deleted: 1 },
      ],
    },
    files: {
      'README.md': { head: README_HEAD, worktree: README_WORKTREE, feature: FEATURE_README },
      '笔记/会议记录.md': { head: MEETING_HEAD, worktree: MEETING_WORKTREE, feature: MEETING_HEAD },
    },
  }
}

let state: MockState = makeState()

// ---------- diff hunks（README 工作区 vs HEAD） ----------

const README_HUNKS: GitDiffResult['hunks'] = [
  {
    oldStart: 1,
    oldLines: 17,
    newStart: 1,
    newLines: 17,
    lines: [
      { kind: 'ctx', text: '# 演示笔记' },
      { kind: 'ctx', text: '' },
      { kind: 'del', text: '> 旧版本说明：这段提醒只存在于 HEAD，工作区版本中已删除（展示纯删除块的红底划线效果）。' },
      { kind: 'ctx', text: '' },
      { kind: 'ctx', text: '本仓库演示 Git 工作台的全部效果：' },
      { kind: 'ctx', text: '' },
      { kind: 'del', text: '- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比）', words: [{ kind: 'ctx', text: '- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比' }, { kind: 'del', text: '）' }] },
      { kind: 'add', text: '- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比 + 批注连线）', words: [{ kind: 'ctx', text: '- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比' }, { kind: 'add', text: ' + 批注连线）' }] },
      { kind: 'del', text: '- 切「文本」模式查看分栏与词级高亮', words: [{ kind: 'ctx', text: '- 切「文本」模式查看分栏与' }, { kind: 'del', text: '词级' }, { kind: 'ctx', text: '高亮' }] },
      { kind: 'add', text: '- 切「文本」模式查看分栏与**词级**高亮', words: [{ kind: 'ctx', text: '- 切「文本」模式查看分栏与' }, { kind: 'add', text: '**词级**' }, { kind: 'ctx', text: '高亮' }] },
      { kind: 'ctx', text: '- 历史区点提交查看 commit diff；Shift+点击两提交做范围对比' },
      { kind: 'ctx', text: '- 工具栏「还原…」可还原整文件或单段改动' },
      { kind: 'ctx', text: '' },
      { kind: 'ctx', text: '## 需求清单' },
      { kind: 'ctx', text: '' },
      { kind: 'del', text: '- 需求一：登录模块' },
      { kind: 'add', text: '- 需求一：登录与权限模块' },
      { kind: 'del', text: '- 需求二：支付模块' },
      { kind: 'add', text: '- 需求二：支付与退款模块' },
      { kind: 'del', text: '- 需求三：报表模块' },
      { kind: 'add', text: '- 需求三：报表与统计模块' },
      { kind: 'add', text: '- 需求四：消息通知模块' },
    ],
  },
  {
    oldStart: 18,
    oldLines: 9,
    newStart: 18,
    newLines: 9,
    lines: [
      { kind: 'ctx', text: '## 流程图' },
      { kind: 'ctx', text: '' },
      { kind: 'ctx', text: '```mermaid' },
      { kind: 'ctx', text: 'graph TD' },
      { kind: 'ctx', text: '  A[开始] --> B{是否有余额}' },
      { kind: 'del', text: '  B -- 是 --> C[支付成功]' },
      { kind: 'add', text: '  B -- 是 --> C[授信成功]' },
      { kind: 'ctx', text: '  B -- 否 --> D[余额不足]' },
      { kind: 'ctx', text: '  D --> E[引导充值]' },
      { kind: 'ctx', text: '```' },
    ],
  },
]
const MEETING_HUNKS: GitDiffResult['hunks'] = [
  {
    oldStart: 5,
    oldLines: 7,
    newStart: 5,
    newLines: 8,
    lines: [
      { kind: 'ctx', text: '1. 支付流程评审' },
      { kind: 'ctx', text: '2. 报表口径确认' },
      { kind: 'add', text: '3. 消息通知需求收集' },
      { kind: 'ctx', text: '' },
      { kind: 'del', text: '> 备注：本期只做支付，不做退款。' },
      { kind: 'add', text: '> 备注：本期只做支付，退款下期排期。' },
    ],
  },
]

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

  async showCommit(hash: string): Promise<GitShowCommit> {
    return { ...state.showCommit, files: state.showCommit.files.map((f) => ({ ...f })) }
  },

  async diffFile(path: string, from: string | null, to: string): Promise<GitDiffResult> {
    // 工作区 vs HEAD
    if (from === null && to === 'HEAD') {
      if (path === 'README.md') {
        return { hunks: README_HUNKS, added: 14, deleted: 5, exists: true }
      }
      if (path === '笔记/会议记录.md') {
        return { hunks: MEETING_HUNKS, added: 2, deleted: 1, exists: true }
      }
      return { hunks: [], added: 0, deleted: 0, exists: true }
    }
    // commit diff / 范围对比：简化返回无改动（示例仓库两提交内容已在渲染模式体现）
    return { hunks: [], added: 0, deleted: 0, exists: true }
  },

  async showFile(path: string, rev: string): Promise<string> {
    const f = state.files[path]
    if (!f) throw new Error(`文件不存在：${path}`)
    if (rev === 'WORKTREE') return f.worktree
    if (rev === 'HEAD') return f.head
    return f.worktree
  },

  async discardFile(path: string): Promise<void> {
    const f = state.files[path]
    if (f) f.worktree = f.head
    state.status = state.status.filter((s) => s.path !== path)
  },

  async discardHunk(path: string, hunkIndex: number): Promise<void> {
    const f = state.files[path]
    if (f) f.worktree = f.head
    state.status = state.status.filter((s) => s.path !== path)
  },

  async checkoutBranch(name: string): Promise<void> {
    state.repo.branch = name
    if (name === 'feature/图表优化') {
      // 切到功能分支：工作区 = feature 版本，无未提交改动
      state.files['README.md'].worktree = state.files['README.md'].feature
      state.files['笔记/会议记录.md'].worktree = MEETING_HEAD
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
