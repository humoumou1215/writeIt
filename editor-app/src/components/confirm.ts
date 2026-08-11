import type { Tab } from '../state/store'
import { confirmDialog } from '../state/store'

/** 关闭有未保存修改的标签前询问（由 manager 动态引入，避免循环依赖） */
export function confirmCloseTab(tab: Tab): Promise<boolean> {
  return confirmDialog({
    title: `关闭「${tab.name}」？`,
    message: '该文件有未保存的修改，关闭将丢失这些修改。',
    confirmText: '不保存关闭',
    danger: true,
  })
}

/** 删除文件/目录前询问 */
export function confirmDelete(kind: 'file' | 'dir', name: string): Promise<boolean> {
  return confirmDialog({
    title: `删除${kind === 'dir' ? '目录' : '文件'}「${name}」？`,
    message: kind === 'dir'
      ? '目录内的所有内容将被一并删除，且无法恢复。'
      : '删除后无法恢复。',
    confirmText: '删除',
    danger: true,
  })
}
