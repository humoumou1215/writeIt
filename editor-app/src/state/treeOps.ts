// 文件树操作：新建 / 重命名 / 删除 / 展开 / 拖拽移动 / 瞄准定位，并与已打开的标签页联动
import { reactive } from 'vue'
import { fs } from '../fs'
import { joinPath, baseName, dirName, type FsEntry } from '../fs/types'
import { state, toast } from './store'
import { confirmDelete } from '../components/confirm'
import { onFileRenamed, onFileDeleted, refreshTree, updateRefsAfterRename, refreshBrokenAll } from '../editor/manager'

// ---------- 拖拽移动（M7-Drag） ----------

/** 拖拽落点位置：into = 移入目录；before/after = 与目标同级、插到目标前/后 */
export type DropPosition = 'into' | 'before' | 'after'

export const dragState = reactive({
  active: false,
  sourcePath: '',
  sourceKind: 'file' as 'file' | 'dir',
  sourceName: '',
  targetPath: null as null | string,
  targetKind: null as null | 'file' | 'dir',
  position: 'into' as DropPosition,
  invalid: false,
})

/** 悬停目录自动展开的计时器（module 级，避免递归组件各自计时） */
let expandTimer: ReturnType<typeof setTimeout> | null = null

/** 拖拽源信息是否属于当前拖拽（防止 dataTransfer 缺失时误判） */
export function beginDrag(path: string, kind: 'file' | 'dir', name: string) {
  dragState.active = true
  dragState.sourcePath = path
  dragState.sourceKind = kind
  dragState.sourceName = name
  dragState.targetPath = null
  dragState.targetKind = null
  dragState.position = 'into'
  dragState.invalid = false
}

/** 更新悬停目标；返回当前是否合法 */
export function dragOver(targetPath: string, targetKind: 'file' | 'dir', position: DropPosition): boolean {
  if (!dragState.active) return false
  dragState.targetPath = targetPath
  dragState.targetKind = targetKind
  dragState.position = position
  dragState.invalid = !isValidDrop()
  // 悬停目录中间 → 计时自动展开（进入深层目录更顺手）
  if (expandTimer) {
    clearTimeout(expandTimer)
    expandTimer = null
  }
  if (position === 'into' && targetKind === 'dir' && targetPath !== '' && !state.expanded.has(targetPath)) {
    expandTimer = setTimeout(() => {
      state.expanded.add(targetPath)
    }, 500)
  }
  return !dragState.invalid
}

/** 离开目标：清除自动展开计时 */
export function dragLeaveTarget() {
  if (expandTimer) {
    clearTimeout(expandTimer)
    expandTimer = null
  }
}

function isValidDrop(): boolean {
  const { sourcePath, sourceKind, targetPath, targetKind, position } = dragState
  if (targetPath === null) return false
  if (sourceKind === 'dir' && (targetPath === sourcePath || targetPath.startsWith(sourcePath + '/')))
    return false // 循环：拖进自己或后代
  if (position === 'into') {
    if (targetKind !== 'dir') return false
    if (targetPath === dirName(sourcePath)) return false // 拖回原父目录 = 空操作
    return true
  }
  // before / after：与目标同级插入
  if (targetPath === sourcePath) return false
  if (sourceKind === 'dir' && targetPath.startsWith(sourcePath + '/')) return false
  return true
}

/** 计算移动后的目标路径（不含冲突检测） */
export function computeTargetPath(): string | null {
  const { sourcePath, targetPath, position } = dragState
  if (targetPath === null) return null
  if (position === 'into') return joinPath(targetPath, baseName(sourcePath))
  const parent = dirName(targetPath)
  return joinPath(parent, baseName(sourcePath))
}

/** 执行移动：校验 + fs.rename + 标签/引用联动 */
export async function moveNode(): Promise<void> {
  const { sourcePath, sourceKind, targetPath, invalid } = dragState
  if (!dragState.active || invalid || targetPath === null) return
  const newPath = computeTargetPath()
  if (!newPath || newPath === sourcePath) return
  // 预检冲突：目标已存在于树中（文件或目录）
  const conflict = findInTree(state.tree, newPath)
  if (conflict) {
    toast(`无法移动：目标已存在「${baseName(newPath)}」`, 'error')
    return
  }
  try {
    await fs.rename(sourcePath, newPath)
    onFileRenamed(sourcePath, newPath, sourceKind)
    updateRefsAfterRename(sourcePath, newPath, sourceKind)
    void refreshBrokenAll()
    toast(
      sourceKind === 'dir'
        ? `已移动目录 → ${baseName(newPath)}`
        : `已移动 → ${newPath}`,
      'success'
    )
  } catch (e) {
    toast(`移动失败: ${(e as Error).message}`, 'error')
  }
  await refreshTree()
}

function findInTree(nodes: FsEntry[], path: string): FsEntry | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children) {
      const hit = findInTree(n.children, path)
      if (hit) return hit
    }
  }
  return null
}

/** 拖拽结束（drop 后 / 取消） */
export function endDrag() {
  dragState.active = false
  dragState.targetPath = null
  dragState.targetKind = null
  dragState.position = 'into'
  dragState.invalid = false
  dragLeaveTarget()
}

// ---------- 瞄准定位（M7-Reveal） ----------

let revealTimer: ReturnType<typeof setTimeout> | null = null

/** 在文件树中定位并高亮一个文件：展开祖先链 + 高亮 + 滚动到可视区 */
export function revealInTree(path: string) {
  if (!path) return
  // 展开所有祖先目录
  const parts = path.split('/')
  parts.pop()
  let acc = ''
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p
    state.expanded.add(acc)
  }
  state.revealPath = path
  if (revealTimer) clearTimeout(revealTimer)
  revealTimer = setTimeout(() => {
    state.revealPath = null
  }, 2400)
}

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

/** M4：基于模板新建文件（先选模板，再输入文件名） */
export function startNewFileWithTemplate(parentPath: string, doctype: string) {
  state.editing = { path: parentPath, kind: 'file', mode: 'new', template: doctype }
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
      let full = ed.path ? joinPath(ed.path, target) : target
      if (ed.kind === 'file' && ed.template && !full.toLowerCase().match(/\.(md|markdown|txt)$/)) {
        // 模板文件必然是 markdown：未带扩展名时自动补 .md
        full = full + '.md'
      }
      if (ed.kind === 'file') {
        if (ed.template) {
          // M4：从模板复制内容（继承 doctype → 关联 rules/suggest）
          const { templateService } = await import('../template/service')
          await templateService.createFromTemplate(full, ed.template)
          toast(`已基于模板创建文件`, 'success')
        } else {
          await fs.createFile(full)
          toast(`已创建文件`, 'success')
        }
        // 新建后自动打开
        const { openTab } = await import('../editor/manager')
        await openTab(full)
      } else {
        await fs.createDir(full)
        state.expanded.add(ed.path)
        toast(`已创建文件夹`, 'success')
      }
    } else {
      const newPath = ed.path.includes('/')
        ? joinPath(ed.path.slice(0, ed.path.lastIndexOf('/')), target)
        : target
      if (newPath === ed.path) return
      await fs.rename(ed.path, newPath)
      onFileRenamed(ed.path, newPath, ed.kind)
      updateRefsAfterRename(ed.path, newPath, ed.kind)
      void refreshBrokenAll()
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
    void refreshBrokenAll()
    toast('已删除', 'success')
  } catch (e) {
    toast(`删除失败: ${(e as Error).message}`, 'error')
  }
  await refreshTree()
}
