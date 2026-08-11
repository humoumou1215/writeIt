// 文件树操作：新建 / 重命名 / 删除 / 展开，并与已打开的标签页联动
import { fs } from '../fs'
import { joinPath, baseName } from '../fs/types'
import { state, toast } from './store'
import { confirmDelete } from '../components/confirm'
import { onFileRenamed, onFileDeleted, refreshTree } from '../editor/manager'

export function toggleExpand(path: string) {
  if (state.expanded.has(path)) state.expanded.delete(path)
  else state.expanded.add(path)
}

export function isExpanded(path: string): boolean {
  return state.expanded.has(path)
}

/** 开始新建文件：在 parentPath 目录下 */
export function startNewFile(parentPath: string) {
  state.editing = { path: parentPath, kind: 'file', mode: 'new' }
}

/** 开始新建文件夹：在 parentPath 目录下 */
export function startNewDir(parentPath: string) {
  state.editing = { path: parentPath, kind: 'dir', mode: 'new' }
}

export function startRename(path: string) {
  state.editing = { path, kind: path.includes('.') ? 'file' : 'dir', mode: 'rename' }
}

export function cancelEditing() {
  state.editing = null
}

function validateName(name: string): string | null {
  const n = name.trim()
  if (!n) return '名称不能为空'
  if (n.includes('/') || n.includes('\\')) return '名称不能包含路径分隔符'
  return null
}

export async function commitEditing(name: string): Promise<void> {
  const ed = state.editing
  if (!ed) return
  state.editing = null
  const err = validateName(name)
  if (err) {
    toast(err, 'error')
    return
  }
  const target = name.trim()
  try {
    if (ed.mode === 'new') {
      const full = ed.path ? joinPath(ed.path, target) : target
      if (ed.kind === 'file') {
        await fs.createFile(full)
        // 新建后自动打开
        const { openTab } = await import('../editor/manager')
        await openTab(full)
      } else {
        await fs.createDir(full)
        state.expanded.add(ed.path)
      }
      toast(`已创建 ${ed.kind === 'file' ? '文件' : '文件夹'}`, 'success')
    } else {
      const newPath = ed.path.includes('/')
        ? joinPath(ed.path.slice(0, ed.path.lastIndexOf('/')), target)
        : target
      if (newPath === ed.path) return
      await fs.rename(ed.path, newPath)
      onFileRenamed(ed.path, newPath, ed.kind)
      toast('已重命名', 'success')
    }
  } catch (e) {
    toast(`操作失败: ${(e as Error).message}`, 'error')
  }
  await refreshTree()
}

export async function removeNode(path: string, kind: 'file' | 'dir') {
  const ok = await confirmDelete(kind, baseName(path))
  if (!ok) return
  try {
    await fs.remove(path)
    onFileDeleted(path)
    toast('已删除', 'success')
  } catch (e) {
    toast(`删除失败: ${(e as Error).message}`, 'error')
  }
  await refreshTree()
}
