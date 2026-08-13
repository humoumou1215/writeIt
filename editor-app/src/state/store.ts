// 全局应用状态（轻量 reactive，不引入 pinia）
import { reactive } from 'vue'
import type { FsEntry } from '../fs/types'

export interface Tab {
  id: string
  path: string
  name: string
  savedContent: string
  dirty: boolean
  lastModified: number
  /** §6.7：可编辑 file_block 内容快照（保存时记录；脏检测第二条件用） */
  blockSnapshot: Map<string, string> | null
  /** §6.7：内容是否来自外部嵌入块联动刷新（区分用户编辑；保存源标签时用） */
  externallySynced: boolean
  /** §6.7：联动刷新后的应然内容（round-trip 稳定值；B 保存时以此落盘与源标签对齐） */
  syncedValue: string | null
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

  settingsOpen: false,
  /** 侧边栏内容列是否收纳（打开文件时若未固定则自动收纳） */
  sidebarCollapsed: false,
  /** 基于模板新建：等待选择模板的目标目录 */
  templatePick: null as null | string,
  contextMenu: null as null | MenuRequest,
  confirm: null as null | ConfirmRequest,
  toasts: [] as Toast[],
  treeVersion: 0,
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
