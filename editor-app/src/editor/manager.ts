// 多标签页编辑器管理：
// 每个打开的标签持有独立的 Crepe 实例（保留各自的撤销历史/光标/滚动位置），
// 切标签只切换容器可见性；关闭标签才销毁实例。
// 数据流：文件内容只从 getMarkdown() 出来、经 replaceAll() 进去，不旁路 DOM。
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { replaceAll } from '@milkdown/kit/utils'

import { TextSelection } from '@milkdown/kit/prose/state'

import { fs, useRealDirFs } from '../fs'
import { refPlugin, resolveRefs } from './ref'
import { registerRefStringify } from './ref/stringify'
import {
  writeBackBlocks,
  broadcastBlockRefresh,
  hasBlockChanges,
  collectBlockContentsSync,
  cacheRefFileContent,
  collectSourcePaths,
} from './ref/writeback'
import {
  registerOpenRefHandler,
  registerReSelectHandler,
  refreshBrokenState,
  resolveRefPath,
  notifyBroken,
} from './ref/app-plugin'
import { initRefTooltip } from './ref/ref-tooltip'
import { baseName } from '../fs/types'
import { state, nextTabId, toast, confirmDialog } from '../state/store'
import { settings } from '../state/settings'
import type { Tab } from '../state/store'
import { featureConfigs } from './features'
import { templateService } from '../template/service'
import {
  validateEditor,
  hasStrictBlock,
  clearValidation,
} from '../validate/service'
import { annotationSchema } from '../annotations/nodes'
import { remarkAnnotation } from '../annotations/remark-annotation'
import { bindAnnotationDecorations } from '../annotations'
import { initAnnotationCard, setAnnotationCardContext } from '../annotations/card'
import { clearAnnotations } from '../annotations/service'
import { $remark } from '@milkdown/kit/utils'

interface Instance {
  crepe: Crepe
  el: HTMLDivElement
  /** 打开/保存等内部操作期间抑制脏标记误报 */
  suppressing: boolean
}

const instances = new Map<string, Instance>()

// M5：编辑防抖实时校验（1.5s；规则简单/文档小无所谓，大文档后续可配置关闭）
const validationTimers = new Map<string, ReturnType<typeof setTimeout>>()
function scheduleDebouncedValidation(tabId: string, inst: Instance) {
  const prev = validationTimers.get(tabId)
  if (prev) clearTimeout(prev)
  validationTimers.set(
    tabId,
    setTimeout(() => {
      validationTimers.delete(tabId)
      void validateEditor(inst.crepe.editor, tabId, { silent: true })
    }, 1500)
  )
}

// M5：校验面板点击违规跳转到文档位置（打开/激活标签 + 滚动到 pos）
export async function scrollToPos(tabId: string, pos: number): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab) return
  if (state.activeTabId !== tabId) {
    await openTab(tabId)
  }
  const inst = instances.get(tabId)
  if (!inst) return
  await new Promise((r) => setTimeout(r, 120))
  try {
    await inst.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const dom = view.domAtPos(Math.min(pos, view.state.doc.content.size))
      const el = (dom.node as HTMLElement)?.closest?.('td, th, p, li, h1, h2, h3, h4, pre') ?? (dom.node as HTMLElement)
      const pane = inst.el.classList.contains('editor-pane')
        ? inst.el
        : (inst.el.querySelector('.editor-pane') as HTMLElement | null)
      if (pane && el) {
        const elRect = el.getBoundingClientRect()
        const paneRect = pane.getBoundingClientRect()
        const target =
          pane.scrollTop + (elRect.top - paneRect.top) - pane.clientHeight * 0.15
        pane.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
      }
    })
  } catch {
    /* 编辑器已销毁 */
  }
}

// M5：手动重新校验活动标签（面板 ⟳ 按钮）
export async function refreshValidation(): Promise<void> {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return
  const res = await validateEditor(inst.crepe.editor, state.activeTabId!, { silent: true })
  const n = res.violations.length
  if (n === 0) toast('校验通过：未发现违规', 'success')
  else toast(`校验完成：${n} 项违规（${res.violations.filter((v) => v.level === 'error').length} 错误）`, 'error')
}

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
;(window as unknown as { __editorGoBlockEnd?: unknown }).__editorGoBlockEnd = (pathSubstr: string) => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    let blockPos = -1
    doc.descendants((n, p) => {
      if (n.type.name === 'file_block' && (n.attrs.path as string).includes(pathSubstr)) {
        blockPos = p
        return false
      }
      return true
    })
    if (blockPos < 0) return 'no-block'
    const node = doc.nodeAt(blockPos)
    if (!node) return 'no-node'
    const end = blockPos + node.nodeSize - 1
    const sel = TextSelection.near(doc.resolve(end), -1)
    const tr = view.state.tr.setSelection(sel)
    view.dispatch(tr)
    ;(view.dom as HTMLElement)?.focus?.()
    return JSON.stringify({ blockPos, end, selFrom: sel.from, selTo: sel.to, node: node.type.name })
  })
  return inst
}
;(window as unknown as { __editorBlockAppend?: unknown }).__editorBlockAppend = (pathSubstr: string, text: string) => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return 'no-inst'
  let res = 'no-block'
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    let blockPos = -1
    doc.descendants((n, p) => {
      if (n.type.name === 'file_block' && (n.attrs.path as string).includes(pathSubstr)) {
        blockPos = p
        return false
      }
      return true
    })
    if (blockPos < 0) return
    const node = doc.nodeAt(blockPos)
    if (!node) return
    const end = blockPos + node.nodeSize - 1
    // 块内末尾插入新段落
    const para = view.state.schema.nodes.paragraph.create(null, view.state.schema.text(text))
    const tr = view.state.tr.insert(end, para)
    view.dispatch(tr)
    res = 'inserted'
  })
  return res
}
;(window as unknown as { __editorOpenPath?: unknown }).__editorOpenPath = (path: string) => {
  void openTab(path)
}
;(window as unknown as { __writebackDiag?: unknown }).__writebackDiag = async () => {
  // 诊断：输出所有标签的完整状态机 + 每个块「当前内容 vs 快照」对比（决定性证据）
  const out: unknown[] = []
  for (const t of state.tabs) {
    const inst = instances.get(t.id)
    let mdLen = -1
    let cur = ''
    let currentBlocks: Record<string, { len: number; head: string; eqSnapshot: boolean }> = {}
    if (inst) {
      cur = inst.crepe.getMarkdown()
      mdLen = cur.length
      try {
        const now = collectBlockContentsSync(inst.crepe.editor)
        for (const [p, v] of now) {
          const snap = t.blockSnapshot?.get(p)
          currentBlocks[p] = { len: v.length, head: v.slice(0, 50), eqSnapshot: v === snap }
        }
      } catch (e) {
        currentBlocks = { err: { len: -1, head: String(e), eqSnapshot: false } }
      }
    }
    out.push({
      tab: t.path,
      dirty: t.dirty,
      mdLen,
      savedContentLen: t.savedContent.length,
      curEqSaved: cur === t.savedContent,
      userEditedAt: t.userEditedAt,
      lastExternalSyncAt: t.lastExternalSyncAt,
      noUserEditsSinceSync: t.userEditedAt <= t.lastExternalSyncAt,
      snapshotLen: t.blockSnapshot ? Object.fromEntries([...(t.blockSnapshot.entries())].map(([k, v]) => [k, v.length])) : {},
      currentBlocks,
      lastModified: t.lastModified,
    })
  }
  const diag = { tabs: out, fsKind: (await import('../fs')).fs.kind }
  console.log('[diag]', JSON.stringify(diag, null, 1))
  return diag
}
;(window as unknown as { __editorWatchMutations?: unknown }).__editorWatchMutations = () => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return 'no-inst'
  let out: unknown = 'no-view'
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const ob = (view as unknown as { domObserver?: unknown }).domObserver as {
      constructor: { prototype: { registerMutation?: (mut: unknown, added: unknown[]) => unknown } }
    } | null
    if (ob && ob.constructor?.prototype?.registerMutation) {
      const proto = ob.constructor.prototype as { registerMutation?: (mut: unknown, added: unknown[]) => unknown }
      const orig = proto.registerMutation
      if (orig) {
        const bound = orig.bind(ob)
        ;(window as unknown as { __mutReg: unknown[] }).__mutReg = []
        proto.registerMutation = (mut: unknown, added: unknown[]) => {
          const r = bound(mut, added)
          const m = mut as { type?: string; target?: { nodeName?: string } }
          ;(window as unknown as { __mutReg: unknown[] }).__mutReg.push({ type: m.type, target: m.target?.nodeName, result: r })
          return r
        }
        out = 'patched'
      } else {
        out = 'no-register'
      }
    } else {
      out = 'no-prototype'
    }
  })
  return out
}
;(window as unknown as { __editorDescInfo?: unknown }).__editorDescInfo = () => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return 'no-inst'
  let out: unknown = null
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const docView = (view as unknown as { docView?: unknown }).docView as {
      children?: unknown[]
    } | null
    const findDesc = (desc: unknown, depth: number): unknown => {
      const d = desc as {
        node?: { type?: { name?: string } }
        children?: unknown[]
        dirty?: number
        contentDOM?: HTMLElement | null
      }
      if (d?.node?.type?.name === 'file_block') {
        return {
          dirty: d.dirty,
          childrenCount: d.children?.length ?? -1,
          contentDOMChildren: d.contentDOM?.childNodes.length ?? -1,
        }
      }
      if (depth < 8) {
        for (const c of d?.children ?? []) {
          const r = findDesc(c, depth + 1)
          if (r) return r
        }
      }
      return null
    }
    const walkAll = (desc: unknown, depth: number, acc: string[]) => {
      const d = desc as { node?: { type?: { name?: string } }; children?: unknown[]; dirty?: number }
      if (!d) return
      const name = d.node?.type?.name ?? (d as { type?: string }).type ?? '?'
      const kids = d.children?.length ?? 0
      acc.push(`${name}(kids=${kids}${d.dirty !== undefined ? ',dirty=' + d.dirty : ''})`)
      if (depth < 6) for (const c of d.children ?? []) walkAll(c, depth + 1, acc)
    }
    const tree: string[] = []
    walkAll(docView, 0, tree)
    out = { tree: tree.slice(0, 60), find: findDesc(docView?.children?.[0], 0) }
  })
  return out
}
;(window as unknown as { __editorForceSync?: unknown }).__editorForceSync = () => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return 'no-inst'
  let out: unknown = 'no-view'
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const ob = (view as unknown as { domObserver?: { flush?: () => void } }).domObserver
    if (ob?.flush) {
      ob.flush()
      out = 'flushed'
    } else {
      out = 'no-flush'
    }
  })
  return out
}
;(window as unknown as { __editorPosAtDOM?: unknown }).__editorPosAtDOM = (pathSubstr: string) => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return 'no-inst'
  let out: unknown = null
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find((x) =>
      (x.querySelector('.ref-file-block-path')?.textContent || '').includes(pathSubstr)
    )
    const li = b?.querySelector('.ref-file-block-content li')
    out = {
      hasLi: !!li,
      posAtDOM: li ? view.posAtDOM(li as HTMLElement, 0) : -2,
      posAtDOMText: li?.firstChild && li.firstChild.nodeType === 3 ? view.posAtDOM(li.firstChild as Node, 0) : -3,
      docLen: view.state.doc.content.size,
    }
  })
  return out
}
;(window as unknown as { __editorDocNodes?: unknown }).__editorDocNodes = () => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return 'no-inst'
  let out: unknown = null
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const names: string[] = []
    view.state.doc.descendants((n, p) => {
      if (p === 0 || (view.state.doc.nodeAt(p - 1) === n)) names.push(`${n.type.name}:${n.textContent.slice(0, 15)}`)
      return true
    })
    out = { activeTab: state.activeTabId, topNames: names.slice(0, 30) }
  })
  return out
}
;(window as unknown as { __editorSelection?: unknown }).__editorSelection = () => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return 'no-inst'
  let out: unknown = null
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const sel = view.state.selection
    // 找 selection 是否在块内
    let inBlock = false
    let blockPath = ''
    view.state.doc.descendants((n, p) => {
      if (n.type.name === 'file_block' && p < sel.from && sel.from < p + n.nodeSize) {
        inBlock = true
        blockPath = n.attrs.path as string
        return false
      }
      return true
    })
    out = {
      from: sel.from,
      to: sel.to,
      docLen: view.state.doc.content.size,
      inBlock,
      blockPath,
      focusEl: (document.activeElement as HTMLElement | null)?.className?.slice?.(0, 40) ?? 'none',
    }
  })
  return out
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
// M6：批注卡（点击展开/收起，幂等初始化）
initAnnotationCard()

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

// 等待编辑器实例挂载（mountEditor 异步；标签刚打开时实例可能还没建）
function waitForInstance(tabId: string, timeout = 5000): Promise<Instance | null> {
  return new Promise((resolve) => {
    const start = Date.now()
    const check = () => {
      const inst = instances.get(tabId)
      if (inst) return resolve(inst)
      if (Date.now() - start > timeout) return resolve(null)
      setTimeout(check, 100)
    }
    check()
  })
}

// M3：滚动到标题（#片段）
async function scrollToHeading(fragment: string) {
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  if (!tab) return
  const inst = await waitForInstance(tab.id)
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
      // 手动计算滚动位置：精确滚动唯一的滚动容器（.editor-pane），
      // 目标 = 标题在可视区顶部下方 15%（偏上，而非居中）——scrollIntoView 在多层滚动容器下不可靠
      const titleDOM = view.nodeDOM(targetPos) as HTMLElement | null
      // 滚动容器：inst.el 本身是 .editor-pane（EditorPane.vue 创建）；querySelector 只查子元素会漏掉自身
      const pane = (
        inst.el.classList.contains('editor-pane')
          ? inst.el
          : inst.el.querySelector('.editor-pane')
      ) as HTMLElement | null
      if (pane && titleDOM) {
        const paneRect = pane.getBoundingClientRect()
        const titleRect = titleDOM.getBoundingClientRect()
        const target = pane.scrollTop + (titleRect.top - paneRect.top) - pane.clientHeight * 0.15
        pane.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
      } else {
        titleDOM?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    } else if (!fragment) {
      // 无锚点（对象引用未声明 fragment）→ 平滑滚动到文件顶部
      const pane = (
        inst.el.classList.contains('editor-pane')
          ? inst.el
          : inst.el.querySelector('.editor-pane')
      ) as HTMLElement | null
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
    blockSnapshot: null,
    userEditedAt: 0,
    lastExternalSyncAt: 0,
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
  // M6：批注插件（<mark data-note> 节点 + 运行时批注 decorations，绑定当前标签）
  crepe.editor.use($remark('annotationRemark', () => remarkAnnotation as never))
  crepe.editor.use(annotationSchema)
  crepe.editor.use(bindAnnotationDecorations(tabId))
  crepe.editor.config((ctx) => {
    registerRefStringify(ctx)
  })
  await crepe.create()
  // M6：批注卡上下文（tabId + 编辑器引用）
  setAnnotationCardContext(tabId, crepe.editor)

  // 两段式解析：异步物化引用（容错：失败不影响编辑器）
  void resolveRefs(crepe.editor).then(() => {
    // §6.7：物化完成后建立初始块快照（此后嵌入编辑通过双条件脏检测识别）
    const t = state.tabs.find((x) => x.id === tabId)
    if (t) {
      t.blockSnapshot = collectBlockContentsSync(crepe.editor)
      // 打开时的物化 dispatch 不是用户编辑——重置时间戳基线
      t.userEditedAt = 0
    }
  })
  void refreshBrokenState(crepe.editor)
  // M5：打开文档时异步校验（hint/strict 均由 rules.ts 声明；失败降级不中断）
  void validateEditor(crepe.editor, tabId, { silent: true })

  const inst: Instance = { crepe, el: container, suppressing: false }
  instances.set(tabId, inst)
  // §6.7：真实用户输入（键盘/粘贴/IME）→ 记录时间戳。
  // 用 DOM input 事件而非 markdownUpdated（校验空事务/物化等程序化 dispatch 不触发 input）
  const onInput = () => {
    const t = state.tabs.find((x) => x.id === tabId)
    if (t) t.userEditedAt = Date.now()
  }
  container.addEventListener('input', onInput)

  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, md) => {
      if (inst.suppressing) return
      const t = state.tabs.find((x) => x.id === tabId)
      if (!t) return
      // §6.7 脏检测双条件：markdown 变化 || 可编辑嵌入内容 ≠ 保存时快照
      const blockDirty = hasBlockChanges(inst.crepe.editor, t.blockSnapshot)
      const nowDirty = md !== t.savedContent || blockDirty
      if (t.dirty !== nowDirty) t.dirty = nowDirty
      t.lastModified = Date.now()
      // §6.7：块编辑 → 源文件标签联动刷新（防抖）
      if (blockDirty) scheduleExternalSync(tabId)
      // M5：编辑防抖实时校验（§5.1 默认关闭；v1 内置 1.5s 防抖，后续可加开关）
      scheduleDebouncedValidation(tabId, inst)
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

// ---------- §6.7 源文件联动（嵌入块编辑 → 源标签刷新/脏联动）----------

/** 把标签内容替换为指定 markdown（replaceAll）+ 重新物化引用。
 * diskUpdated=true（保存写回后）：replaceAll → canonical（round-trip 稳定值）→ 以 canonical 落盘
 *   → savedContent = canonical + 脏灭（保证 磁盘 == 编辑器内容，彻底消除 round-trip 差异）；
 * diskUpdated=false（联动预览）：仅 replaceAll + 脏亮（savedContent 保持旧磁盘值，待保存）。
 * 两种都在 suppressing 期内完成（否则 markdownUpdated 误标用户编辑）。
 */
async function refreshTabToContent(
  srcInst: Instance,
  srcTab: Tab,
  content: string,
  diskUpdated: boolean
): Promise<void> {
  srcInst.suppressing = true
  try {
    srcInst.crepe.editor.action(replaceAll(content))
    // replaceAll 后块标记行重新出现——重新物化引用；物化 dispatch 需在 suppressing 期内
    await resolveRefs(srcInst.crepe.editor)
    const canonical = srcInst.crepe.getMarkdown()
    if (diskUpdated) {
      try {
        await fs.writeFile(srcTab.path, canonical)
      } catch (e) {
        console.warn('[sync] 应然内容落盘失败:', srcTab.path, e)
      }
      srcTab.savedContent = canonical
      srcTab.dirty = false
      srcTab.lastExternalSyncAt = Date.now()
    } else {
      // 磁盘还是旧内容：A 内容 ≠ 磁盘 → 脏（保存后才写盘）
      srcTab.dirty = canonical !== srcTab.savedContent
      srcTab.lastExternalSyncAt = Date.now()
    }
    srcTab.blockSnapshot = collectBlockContentsSync(srcInst.crepe.editor)
    srcTab.lastModified = Date.now()
  } catch (e) {
    console.warn('[sync] 源标签刷新失败:', srcTab.path, e)
  } finally {
    setTimeout(() => (srcInst.suppressing = false), 0)
  }
}

/** 广播物化刷新后：目标标签块快照同步 + 脏重算（块脏灭；自身编辑保持） */
function syncBlockSnapshots(tabIds: string[]): void {
  for (const tid of tabIds) {
    const t = state.tabs.find((x) => x.id === tid)
    const inst = instances.get(tid)
    if (!t || !inst) continue
    t.blockSnapshot = collectBlockContentsSync(inst.crepe.editor)
    const blockDirty = hasBlockChanges(inst.crepe.editor, t.blockSnapshot)
    const md = inst.crepe.getMarkdown()
    t.dirty = md !== t.savedContent || blockDirty
  }
}

/** 块编辑防抖联动：本标签块变更 → 源文件标签实时刷新（源标签无自身编辑时） */
const externalSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()
function scheduleExternalSync(tabId: string) {
  const prev = externalSyncTimers.get(tabId)
  if (prev) clearTimeout(prev)
  externalSyncTimers.set(
    tabId,
    setTimeout(() => {
      externalSyncTimers.delete(tabId)
      void syncSourceTabs(tabId)
    }, 600)
  )
}

/** B 块编辑 → 源文件 A 标签（打开且无自身编辑）内容刷新为最新（块内容 = A 应然内容） */
async function syncSourceTabs(tabId: string): Promise<void> {
  const inst = instances.get(tabId)
  if (!inst) return
  try {
    const sources = await collectSourcePaths(inst.crepe.editor)
    for (const path of sources) {
      const srcTab = state.tabs.find((t) => t.id !== tabId && t.path === path)
      if (!srcTab) continue
      const srcInst = instances.get(srcTab.id)
      if (!srcInst) continue
      // A 有自身编辑 → 不刷新（最后保存者胜）；无编辑 → 刷新为块内容（本标签同源块的最新内容）
      if (srcInst.crepe.getMarkdown() !== srcTab.savedContent) continue
      const blockContent = collectBlockContentsSync(inst.crepe.editor)
      const content = [...blockContent.entries()].find(([p]) => sameSourceCheck(p, path))?.[1]
      if (content === undefined) continue
      if (srcInst.crepe.getMarkdown() === content) continue // 已是最新
      await refreshTabToContent(srcInst, srcTab, content, false)
    }
  } catch (e) {
    console.warn('[sync] 源标签联动失败:', e)
  }
}

function sameSourceCheck(a: string, b: string): boolean {
  if (a === b) return true
  const norm = (p: string) => p.replace(/\.(md|markdown|txt)$/i, '')
  return norm(a) === norm(b)
}

export async function saveTab(tabId: string): Promise<boolean> {
  const inst = instances.get(tabId)
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab) return false
  if (!inst) {
    // 容器尚未挂载（极早期）——直接写 savedContent
    tab.dirty = false
    return true
  }
  // M5 strict 门禁：先确保校验结果新鲜（文档可能已编辑），mode strict + error 违规 → 需确认
  const result = await validateEditor(inst.crepe.editor, tabId, { silent: true })
  if (hasStrictBlock(result)) {
    const errs = result.violations.filter((v) => v.level === 'error')
    const ok = await confirmDialog({
      title: '校验失败，确定保存？',
      message: `存在 ${errs.length} 个错误级违规（模式：strict）。\n${errs
        .slice(0, 3)
        .map((v) => `• ${v.message}`)
        .join('\n')}${errs.length > 3 ? `\n…等 ${errs.length} 项` : ''}`,
      confirmText: '仍然保存',
      danger: true,
    })
    if (!ok) return false
  }
  const md = inst.crepe.getMarkdown()
  // IME 防御：组合输入未提交时先强制上屏（blur→focus 触发 compositionend），
  // 否则组合文本不在 doc 里——保存/写回都会丢用户输入
  try {
    const view = inst.crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    if (view.composing) {
      view.dom.blur()
      ;(view.dom as HTMLElement).focus()
      await new Promise((r) => setTimeout(r, 60))
    }
  } catch {
    /* 编辑器可能未就绪 */
  }
  // §6.7 写回事务：可编辑 file_block 内容写回源文件（失败降级不阻断保存）
  const written = await writeBackBlocks(inst.crepe.editor)
  try {
    await fs.writeFile(tab.path, md)
  } catch (e) {
    toast(`保存失败: ${(e as Error).message}`, 'error')
    return false
  }
  inst.suppressing = true
  tab.savedContent = md
  // §6.7：保存后记录块内容快照（脏检测第二条件）
  tab.blockSnapshot = collectBlockContentsSync(inst.crepe.editor)
  tab.dirty = false
  tab.lastModified = Date.now()
  // 等一帧再解除抑制，避免保存后的 markdownUpdated 误判
  setTimeout(() => (inst.suppressing = false), 0)
  // 广播①：写回的源文件 → 源标签（若打开且无自身编辑）刷新为最新 + 脏灭；其他引用标签块物化刷新
  for (const [p, content] of written) {
    const srcTab = state.tabs.find((t) => t.id !== tabId && t.path === p)
    if (srcTab) {
      const srcInst = instances.get(srcTab.id)
      // A 无用户编辑：userEditedAt <= lastExternalSyncAt（联动/写回刷新后无用户输入）或从未编辑（0）。
      // 用时间戳区分用户编辑（内容比较会被 round-trip 差异坑）
      const noUserEdits =
        srcInst !== null && srcInst !== undefined && srcTab.userEditedAt <= srcTab.lastExternalSyncAt
      if (noUserEdits) {
        // replaceAll(块内容) → canonical 落盘 → savedContent 同步 + 脏灭
        await refreshTabToContent(srcInst, srcTab, content, true)
      }
      // A 有用户编辑 → 不刷新（最后保存者胜，脏保持）
    }
    void broadcastBlockRefresh(p, tabId, instances)
  }
  // 广播②：本文档保存后，若它是某嵌入块的源文件 → 其他标签的块刷新物化 + 更新缓存 + 块快照同步
  cacheRefFileContent(tab.path, md)
  const refreshed = await broadcastBlockRefresh(tab.path, tabId, instances)
  syncBlockSnapshots(refreshed)
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
  // 关闭标签时清理校验结果（订阅面板/报告不残留）
  clearValidation(tabId)
  clearAnnotations(tabId)
  setAnnotationCardContext(tabId, null)
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
