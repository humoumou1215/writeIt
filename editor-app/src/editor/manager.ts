// 多标签页编辑器管理：
// 每个打开的标签持有独立的 Crepe 实例（保留各自的撤销历史/光标/滚动位置），
// 切标签只切换容器可见性；关闭标签才销毁实例。
// 数据流：文件内容只从 getMarkdown() 出来、经 replaceAll() 进去，不旁路 DOM。
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'

import { fs, useRealDirFs } from '../fs'
import { refPlugin, resolveRefs } from './ref'
import { registerRefStringify } from './ref/stringify'
import {
  registerOpenRefHandler,
  registerReSelectHandler,
  refreshBrokenState,
  resolveRefPath,
  notifyBroken,
} from './ref/app-plugin'
import { initRefTooltip } from './ref/ref-tooltip'
import { baseName } from '../fs/types'
import { state, nextTabId, toast } from '../state/store'
import { settings } from '../state/settings'
import type { Tab } from '../state/store'
import { featureConfigs } from './features'
import { templateService } from '../template/service'

interface Instance {
  crepe: Crepe
  el: HTMLDivElement
  /** 打开/保存等内部操作期间抑制脏标记误报 */
  suppressing: boolean
}

const instances = new Map<string, Instance>()

// 调试钩子：测试时可访问当前编辑器的内部（schema / doc 等）
;(window as unknown as { __editorDebug?: unknown }).__editorDebug = () => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  return inst?.crepe.editor ?? null
}
;(window as unknown as { __editorGetMarkdown?: unknown }).__editorGetMarkdown = () => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  return inst ? inst.crepe.getMarkdown() : ''
}
;(window as unknown as { __editorSetRefPath?: unknown }).__editorSetRefPath = (oldPath: string, newPath: string) => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const tr = view.state.tr
    let pos = -1
    view.state.doc.descendants((n, p) => {
      if (n.type.name === 'file_ref' && n.attrs.path === oldPath) { pos = p; return false }
      return true
    })
    if (pos < 0) return
    tr.setNodeMarkup(pos, undefined, { path: newPath })
    view.dispatch(tr)
  })
}
;(window as unknown as { __editorGoEnd?: unknown }).__editorGoEnd = () => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    const end = doc.content.size
    const tr = view.state.tr
    // 文档末尾若是嵌入块（file_block），其后没有可输入的文本 —— 补一个空段落
    const lastNode = doc.lastChild
    if (lastNode?.type.name === 'file_block') {
      tr.insert(end, tr.doc.type.schema.nodes.paragraph.create())
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(end)))
    view.dispatch(tr.scrollIntoView())
  })
}

// M3：引用 chip 悬停浮窗（自定义 tooltip，幂等初始化）
initRefTooltip()

// M3：引用 chip 点击跳转（扩展名补全 + #片段滚动到标题）
registerOpenRefHandler(async (path, fragment) => {
  const real = await resolveRefPath(path)
  if (!real) {
    notifyBroken(path)
    return
  }
  await openTab(real)
  if (fragment) await scrollToHeading(fragment)
})

// M3：断链 chip 点击 → 打开菜单重选（替换模式）
registerReSelectHandler((path) => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return
  void import('./ref/menu').then((menuMod) =>
    menuMod.openReplaceMenu(inst.crepe.editor, path)
  )
})

// M3：滚动到标题（#片段）
async function scrollToHeading(fragment: string) {
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  const inst = tab ? instances.get(tab.id) : null
  if (!inst) return
  const targetTab = tab
  await new Promise((r) => setTimeout(r, 300))
  const { editorViewCtx } = await import('@milkdown/kit/core')
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let targetPos = -1
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && node.textContent.trim() === fragment) {
        targetPos = pos
        return false
      }
      return true
    })
    if (targetPos >= 0) {
      const dom = view.domAtPos(targetPos)
      ;(dom.node as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else if (!fragment) {
      // 无锚点（对象引用未声明 fragment）→ 平滑滚动到文件顶部
      const pane = inst.el.querySelector('.editor-pane') as HTMLElement | null
      pane?.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      // 有锚点但找不到标题 → 提示
      toast(`未找到标题「${fragment}」（${targetTab?.name ?? ''}）`, 'error')
    }
  })
  // 光标移到标题
  const { TextSelection } = await import('@milkdown/kit/prose/state')
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let targetPos = -1
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && node.textContent.trim() === fragment) {
        targetPos = pos
        return false
      }
      return true
    })
    if (targetPos >= 0) {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(targetPos)))
      )
    }
  })
}

// ---------- 打开 / 激活 ----------

export async function openTab(path: string): Promise<void> {
  // 已在标签中 → 直接激活
  const existing = state.tabs.find((t) => t.path === path)
  if (existing) {
    activateTab(existing.id)
    return
  }

  let content: string
  try {
    content = await fs.readFile(path)
  } catch (e) {
    toast(`打开失败: ${(e as Error).message}`, 'error')
    return
  }

  const tab: Tab = {
    id: nextTabId(),
    path,
    name: baseName(path),
    savedContent: content,
    dirty: false,
    lastModified: Date.now(),
  }
  state.tabs.push(tab)
  state.activeTabId = tab.id
  // 容器由 EditorPane.vue 在 mount 时创建并调用 mountEditor

  // 自动收纳：打开文件后，若侧边栏未固定则收起内容列
  if (!settings.sidebarPinned) state.sidebarCollapsed = true
}

export function activateTab(id: string) {
  state.activeTabId = id
  // 等 DOM 切换完成后把焦点还给编辑器
  requestAnimationFrame(() => {
    const inst = instances.get(id)
    const viewEl = inst?.el.querySelector('.ProseMirror') as HTMLElement | null
    viewEl?.focus()
  })
}

// ---------- 挂载 / 销毁（由 EditorPane.vue 调用） ----------

export async function mountEditor(tabId: string, container: HTMLDivElement): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab || instances.has(tabId)) return

  // M4：斜杠菜单「模板」组依赖模板注册表，创建编辑器前确保扫描完成（失败也降级）
  await templateService.ready()

  const crepe = new Crepe({
    root: container,
    defaultValue: tab.savedContent,
    features: {
      [CrepeFeature.TopBar]: true,
    },
    // Mermaid + 模板：代码块预览 / 斜杠菜单分组
    featureConfigs: featureConfigs(),
  })
  // 注册引用机制自定义节点与 stringify handler（必须在 create 之前）
  crepe.editor.use(refPlugin)
  crepe.editor.config((ctx) => {
    registerRefStringify(ctx)
  })
  await crepe.create()

  // 两段式解析：异步物化引用（容错：失败不影响编辑器）
  void resolveRefs(crepe.editor)
  void refreshBrokenState(crepe.editor)

  const inst: Instance = { crepe, el: container, suppressing: false }
  instances.set(tabId, inst)

  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, md) => {
      if (inst.suppressing) return
      const t = state.tabs.find((x) => x.id === tabId)
      if (!t) return
      const nowDirty = md !== t.savedContent
      if (t.dirty !== nowDirty) t.dirty = nowDirty
      t.lastModified = Date.now()
    })
  })

  // 关键：用 Crepe 规范化后的序列化结果作为基准，
  // 避免原始 Markdown 与编辑器 round-trip 差异导致打开即“脏”
  tab.savedContent = crepe.getMarkdown()

  // 打开后把焦点还给编辑器，便于直接输入
  requestAnimationFrame(() => {
    const viewEl = container.querySelector('.ProseMirror') as HTMLElement | null
    viewEl?.focus()
  })
}

export function unmountEditor(tabId: string) {
  const inst = instances.get(tabId)
  if (!inst) return
  inst.crepe.destroy().catch(() => undefined)
  inst.el.remove()
  instances.delete(tabId)
}

// ---------- 保存 ----------

export async function saveTab(tabId: string): Promise<boolean> {
  const inst = instances.get(tabId)
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab) return false
  if (!inst) {
    // 容器尚未挂载（极早期）——直接写 savedContent
    tab.dirty = false
    return true
  }
  const md = inst.crepe.getMarkdown()
  try {
    await fs.writeFile(tab.path, md)
  } catch (e) {
    toast(`保存失败: ${(e as Error).message}`, 'error')
    return false
  }
  inst.suppressing = true
  tab.savedContent = md
  tab.dirty = false
  tab.lastModified = Date.now()
  // 等一帧再解除抑制，避免保存后的 markdownUpdated 误判
  setTimeout(() => (inst.suppressing = false), 0)
  return true
}

export async function saveActiveTab(): Promise<boolean> {
  if (!state.activeTabId) return false
  const ok = await saveTab(state.activeTabId)
  if (ok) toast('已保存', 'success')
  return ok
}

// ---------- 关闭 ----------

export async function closeTab(tabId: string): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab) return
  if (tab.dirty) {
    const ok = await confirmDiscard(tab)
    if (!ok) return
  }
  const idx = state.tabs.findIndex((t) => t.id === tabId)
  state.tabs.splice(idx, 1)
  unmountEditor(tabId)
  if (state.activeTabId === tabId) {
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)]
    state.activeTabId = next ? next.id : null
  }
}

function confirmDiscard(tab: Tab): Promise<boolean> {
  // 循环依赖规避：由组件层实现确认框
  return import('../components/confirm').then((m) => m.confirmCloseTab(tab))
}

// ---------- 文件树联动 ----------

/** M3：重命名后更新所有打开文档中的引用节点路径 */
export function updateRefsAfterRename(oldPath: string, newPath: string, kind: 'file' | 'dir') {
  const strip = (p: string) => p.replace(/\.(md|markdown|txt)$/i, '')
  const oldStripped = strip(oldPath)
  const newStripped = strip(newPath)
  // 遍历每个打开文档，更新引用节点路径（静态导入，避免异步 action 竞态）
  for (const inst of instances.values()) {
    inst.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const tr = view.state.tr
      let changed = false
      view.state.doc.descendants((node, pos) => {
        const isRef =
          node.type.name === 'file_ref' ||
          node.type.name === 'file_block' ||
          node.type.name === 'object_ref'
        if (!isRef) return true
        // 跳过只读嵌入块（不可修改；重命名后自然断链，提示重选）
        if (node.type.name === 'file_block' && node.attrs.readonly) return true
        const p = node.attrs.path as string
        const matches =
          kind === 'file'
            ? p === oldStripped || p === oldPath
            : p === oldStripped || p.startsWith(oldStripped + '/')
        if (matches) {
          const newP =
            kind === 'file'
              ? newStripped
              : newStripped + p.slice(oldStripped.length)
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, path: newP })
          changed = true
        }
        return true
      })
      if (changed) view.dispatch(tr)
    })
  }
}

/** M3：刷新所有打开文档的断链状态（删除/重命名后调用） */
export function refreshBrokenAll() {
  for (const inst of instances.values()) {
    void refreshBrokenState(inst.crepe.editor)
  }
}

export function onFileRenamed(oldPath: string, newPath: string, kind: 'file' | 'dir' = 'file') {
  for (const tab of state.tabs) {
    if (kind === 'file' && tab.path === oldPath) {
      tab.path = newPath
      tab.name = baseName(newPath)
    } else if (kind === 'dir' && (tab.path === oldPath || tab.path.startsWith(oldPath + '/'))) {
      const rel = tab.path.slice(oldPath.length)
      tab.path = newPath + rel
      tab.name = baseName(tab.path)
    }
  }
}

export function onFileDeleted(path: string) {
  const affected = state.tabs.filter(
    (t) => t.path === path || t.path.startsWith(path + '/')
  )
  for (const tab of affected) closeTab(tab.id)
}

// ---------- 自动保存 ----------

let autoSaveTimer: ReturnType<typeof setInterval> | null = null

export function ensureAutoSaveLoop() {
  if (autoSaveTimer) return
  autoSaveTimer = setInterval(() => {
    if (!settings.autoSave) return
    for (const tab of state.tabs) {
      if (
        tab.dirty &&
        Date.now() - tab.lastModified >= settings.autoSaveDelay &&
        instances.has(tab.id)
      ) {
        saveTab(tab.id)
      }
    }
  }, 500)
}

// ---------- 打开目录 / 刷新树 ----------

export async function openDirectory(): Promise<void> {
  // 浏览器：从 mock 示例切换到真实目录实现
  useRealDirFs()
  const ok = await fs.openDirectory()
  if (!ok) return
  state.rootName = fs.rootName
  state.expanded = new Set()
  await refreshTree()
  toast(`已打开目录: ${state.rootName}`, 'success')
}

export async function refreshTree() {
  try {
    state.tree = await fs.readTree(settings.showAllFiles)
    state.rootName = fs.rootName
    state.treeVersion++
  } catch (e) {
    toast(`读取目录失败: ${(e as Error).message}`, 'error')
  }
}
