// 全局应用状态（轻量 reactive，不引入 pinia）
import { reactive } from 'vue'
import type { FsEntry } from '../fs/types'
import type { DiffBase, GitBranch, GitCommit, GitCommitFile, GitFileStatus, GitRepoInfo } from '../git'

export type ViewMode = 'wysiwyg' | 'source' | 'diff'

export interface Tab {
  id: string
  path: string
  name: string
  /** M16：标签来源——'editor'=文件树/正文打开；'git'=Git SCM/“打开更改”打开（两种标签互不占用） */
  kind: 'editor' | 'git'
  savedContent: string
  dirty: boolean
  lastModified: number
  /** §6.7：可编辑 file_block 内容快照（保存时记录；脏检测第二条件用） */
  blockSnapshot: Map<string, string> | null
  /** §6.7：用户真实输入时间戳（区分用户编辑 vs 程序化刷新；0 = 无用户编辑） */
  userEditedAt: number
  /** §6.7：最近一次外部联动/写回刷新时间戳（保存/联动时判断用户是否编辑过） */
  lastExternalSyncAt: number
  /** M11：视图模式——wysiwyg = Crepe / source = 源码 textarea / diff = Git diff 视图 */
  viewMode: ViewMode
  /** M11：diff 视图数据（viewMode==='diff' 时有效） */
  diff: null | {
    path: string
    base: DiffBase
    hunks: import('../git').DiffHunk[]
    added: number
    deleted: number
    exists: boolean
    loading: boolean
    /** M11c：渲染/文本模式（默认渲染，见设计 D4） */
    mode: 'render' | 'text'
    /** M11c：渲染模式数据（懒加载：首次切渲染模式才拉取） */
    renderData: null | { oldMd: string; newMd: string }
    /** M18 §4.6：内容指纹（磁盘外部变化自动刷新依据）；null = 未加载/已失效 */
    freshToken: null | { oldHash: string; nextHash: string }
    renderLoading: boolean
    renderError: string | null
    /** M16：diff 滚动位置记忆（切标签保持，像 editor 标签一样） */
    scrollTop: number
  }
}

/** Git 面板状态（M11） */
export interface GitPanelState {
  /** content-col 面板：文件树 / Git / 全局搜索 */
  tab: 'files' | 'git' | 'search'
  repo: GitRepoInfo | null
  branches: GitBranch[]
  status: GitFileStatus[]
  log: GitCommit[]
  /** 展开中的提交 hash（显示其变更文件列表） */
  selectedCommit: string | null
  commitFiles: GitCommitFile[]
  /** 范围对比：Shift+点击两提交 → {a, b} */
  range: null | { a: string; b: string }
  /** 分支筛选（null = 当前分支全部历史）（M16：常驻分支区块已删，保留字段兼容） */
  branchFilter: string | null
  loading: boolean
  /** 面板加载失败原因（非 git 仓库等） */
  error: string | null
  /** 内容/分支变化后递增，GitPanel watch 刷新 */
  version: number
  // M16 SCM：
  commitMessage: string
  viewMode: 'flat' | 'tree'
  aheadBehind: null | { ahead: number; behind: number }
  hasRemote: boolean
}

export interface TabContextMenuRequest {
  x: number
  y: number
  tabId: string
  path: string
}

export interface Toast {
  id: number
  text: string
  type: 'info' | 'success' | 'error'
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

/** M16：SCM 文件行右键菜单请求（GitFileContextMenu） */
export interface ScmMenuRequest {
  x: number
  y: number
  section: 'staged' | 'changes' | 'merge'
  path: string
}

/** M16：单行文本输入弹窗（PromptDialog，分支名等） */
export interface PromptRequest {
  title: string
  placeholder?: string
  value?: string
  resolve: (value: string | null) => void
}

/** 剪贴板授权申请弹窗（写入被浏览器/WebView 拦截时弹出；含手动复制兜底） */
export interface ClipboardAuthRequest {
  text: string
  /** 用户完成复制 → resolve(true)；关闭/取消 → resolve(false) */
  resolve: (ok: boolean) => void
}

export interface MenuRequest {
  x: number
  y: number
  path: string
  kind: 'file' | 'dir'
}

export const state = reactive({
  fsName: '',
  rootName: '',
  tree: [] as FsEntry[],
  /** 展开的目录路径集合 */
  expanded: new Set<string>(),
  /** 正在重命名/新建输入中的路径（key）与类型；新建可携带模板 doctype */
  editing: null as null | {
    path: string
    kind: 'file' | 'dir'
    mode: 'new' | 'rename'
    template?: string
  },

  tabs: [] as Tab[],
  activeTabId: null as null | string,

  /** M11：Git 面板状态 */
  gitPanel: {
    tab: 'files',
    repo: null,
    branches: [],
    status: [],
    log: [],
    selectedCommit: null,
    commitFiles: [],
    range: null,
    branchFilter: null,
    loading: false,
    error: null,
    version: 0,
    // M16 SCM：
    commitMessage: '',
    viewMode: 'flat' as 'flat' | 'tree',
    aheadBehind: null as null | { ahead: number; behind: number },
    hasRemote: false,
  } as GitPanelState,

  /** M15：主文件树 git 角标（工作区改动）。files: path→状态；dirs: 目录路径→聚合状态（仅含有改动子级的目录） */
  gitMark: { files: {} as Record<string, GitFileStatus>, dirs: {} as Record<string, string> },

  settingsOpen: false,
  /** 导出弹窗（图标列 📤 独立入口） */
  exportOpen: false,
  /** 诊断弹窗（图标列 🩺 / 状态栏入口） */
  diagOpen: false,
  /** 侧边栏内容列是否收纳（点击编辑区时若未固定则自动收纳；打开文件不收纳） */
  sidebarCollapsed: false,
  /** 基于模板新建：等待选择模板的目标目录 */
  templatePick: null as null | string,
  contextMenu: null as null | MenuRequest,
  /** M11d：标签页右键菜单 */
  tabContextMenu: null as null | TabContextMenuRequest,
  /** M16：SCM 文件行右键菜单 */
  scmMenu: null as null | ScmMenuRequest,
  /** M16：分支名等单行输入弹窗 */
  prompt: null as null | PromptRequest,
  confirm: null as null | ConfirmRequest,
  /** 剪贴板授权申请弹窗（复制要点被拦截时弹出） */
  clipboardAuth: null as null | ClipboardAuthRequest,
  toasts: [] as Toast[],
  treeVersion: 0,
  /** 瞄准定位：文件树中待高亮的文件路径（定位后自动清除） */
  revealPath: null as null | string,
})

let tabSeq = 0
export function nextTabId(): string {
  return `tab-${++tabSeq}`
}

let toastSeq = 0
export function toast(text: string, type: Toast['type'] = 'info') {
  const id = ++toastSeq
  state.toasts.push({ id, text, type })
  setTimeout(() => {
    const i = state.toasts.findIndex((t) => t.id === id)
    if (i >= 0) state.toasts.splice(i, 1)
  }, 2600)
}

export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    state.confirm = { ...opts, resolve }
  })
}

/** M16：显示单行输入弹窗，resolve(value | null，取消) */
export function promptDialog(opts: Omit<PromptRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    state.prompt = { ...opts, resolve }
  })
}

/** 弹出剪贴板授权申请（复制写入被拦截时）；resolve(true) = 用户完成复制 */
export function openClipboardAuth(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    state.clipboardAuth = { text, resolve }
  })
}

/** 关闭剪贴板授权弹窗（ok = 用户是否完成了复制） */
export function closeClipboardAuth(ok: boolean): void {
  const req = state.clipboardAuth
  if (req) req.resolve(ok)
  state.clipboardAuth = null
}
