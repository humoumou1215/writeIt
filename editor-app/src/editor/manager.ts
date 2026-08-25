// 多标签页编辑器管理：
// 每个打开的标签持有独立的 Crepe 实例（保留各自的撤销历史/光标/滚动位置），
// 切标签只切换容器可见性；关闭标签才销毁实例。
// 数据流：文件内容只从 getMarkdown() 出来、经 replaceAll() 进去，不旁路 DOM。
import { reactive, watch } from 'vue'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { replaceAll } from '@milkdown/kit/utils'
// M7：inline-code 的 Mod-e 与源码模式 Ctrl+E 冲突 → 改绑 Ctrl+Shift+E
import { inlineCodeKeymap } from '@milkdown/kit/preset/commonmark'

import { TextSelection, AllSelection, Plugin } from '@milkdown/kit/prose/state'

import { fs, useRealDirFs } from '../fs'
import { contentHash } from '../git/hash'
import { refPlugin, resolveRefs, refConfigCtx, getRefConfig } from './ref'
import type { RefConfig } from './ref/config'
import { registerRefStringify } from './ref/stringify'
import {
  writeBackBlocks,
  hasBlockChanges,
  collectBlockContentsSync,
  serializeBlockContent,
  resolveRealPath,
} from './ref/writeback'
import { fillBlockContent, genBlockId, resolveBlockRefs } from './ref/resolve'
import {
  setRegistryBroadcastHandler,
  getEntry,
  getView,
  setTruth,
  updateViewContent,
  scheduleBroadcast,
  flushBroadcast as registryFlushBroadcast,
  registerView as registryRegisterView,
  unregisterTab as registryUnregisterTab,
  registryDiag,
} from './ref/registry'
import {
  refreshBrokenState,
  resolveRefPath,
} from './ref/app-plugin'
import { initRefTooltip } from './ref/ref-tooltip'
import { createRefFooter, type RefFooterHandle } from './references'
import { baseName } from '../fs/types'
import { state, nextTabId, toast, confirmDialog } from '../state/store'
import { settings, saveSettings } from '../state/settings'
import type { Tab, ViewMode } from '../state/store'
// 诊断埋点（D2）：操作轨迹 + 业务日志（tab/save/git/view）
import { diag, diagEvent } from '../diagnostics/logger'
// D2.5：渲染计数（markdownUpdated 节奏，探针取数）——直接依赖 monitor，避免 index↔manager 循环
import { markEditorRender } from '../diagnostics/monitor'
import { git, type DiffBase, isDiffEditable } from '../git'
import { featureConfigs } from './features'
import {
  tableEnhancePlugin,
  tableConfigCtx,
  buildTableConfig,
} from './table'
import { registerMermaidRefDeps } from './mermaid-ref'
import { templateService } from '../template/service'
import {
  validateEditor,
  hasStrictBlock,
  clearValidation,
} from '../validate/service'
import { validatePlugin, validateConfigCtx, clearValidationTimer } from '../validate/plugin'
import { annotationPlugin, annotationConfigCtx } from '../annotations'
import { initAnnotationCard, setAnnotationCardContext } from '../annotations/card'
import { getRuntimeAnnotations, clearAnnotations } from '../annotations/service'
import { outlinePlugin, outlineStore, clearOutline } from './outline'
import {
  searchHighlightPlugin,
  setSearchHighlights,
  setSearchHighlightWidget,
} from './search-highlight'

interface Instance {
  crepe: Crepe
  el: HTMLDivElement
  /** 打开/保存等内部操作期间抑制脏标记误报 */
  suppressing: boolean
  /** M7：源码模式 textarea（懒创建；源码编辑不经过 ProseMirror doc） */
  srcTa: HTMLTextAreaElement | null
  /** M16：Crepe topbar 元素与原生位置（移入工作区顶行槽位后，可随时归还） */
  topbar: null | { el: HTMLElement; parent: HTMLElement; next: Node | null }
  /** 引用/被引用 底部展示区（非编辑） */
  refsFooter: null | RefFooterHandle
  /** 隐藏前保存的滚动位置（display:none 会清空 scrollTop，重新显示时手动还原） */
  scrollTop: number
}

const instances = new Map<string, Instance>()
/** 诊断探针：当前已挂载的编辑器实例数（多标签健康） */
export function getInstanceCount(): number {
  return instances.size
}

// 调试钩子：查看各标签保存的滚动位置（切 tab 滚动保持排查用）
;(window as any).__scrollDbg = () => {
  const out: Record<string, any> = {}
  instances.forEach((i, id) => {
    const t = state.tabs.find((x) => x.id === id)
    out[id] = { name: t?.name, active: state.activeTabId === id, saved: i.scrollTop, elTop: i.el.scrollTop, disp: i.el.style.display, scrollH: i.el.scrollHeight, clientH: i.el.clientHeight }
  })
  return out
}

// M14：编辑器挂载完成通知（批注抽屉在标签切换后等实例就绪再刷新）
const mountListeners = new Set<(tabId: string) => void>()
export function onEditorMounted(fn: (tabId: string) => void): () => void {
  mountListeners.add(fn)
  return () => mountListeners.delete(fn)
}
function notifyEditorMounted(tabId: string) {
  mountListeners.forEach((fn) => {
    try {
      fn(tabId)
    } catch {
      /* ignore */
    }
  })
}

// M14：diff 渲染模式 Crepe 实例注册（批注抽屉在 diff 模式下用它做定位/连线）
const renderInstances = new Map<string, Crepe>()
export function registerRenderInstance(tabId: string, crepe: Crepe | null): void {
  if (crepe) renderInstances.set(tabId, crepe)
  else renderInstances.delete(tabId)
}
export function getRenderInstance(tabId: string): Crepe | null {
  return renderInstances.get(tabId) ?? null
}

/** M6：源码模式 textarea 访问（批注抽屉在源码视图下做连线定位/点击滚动） */
export function getSourceTextarea(tabId: string): HTMLTextAreaElement | null {
  return instances.get(tabId)?.srcTa ?? null
}

// ---------- M7：源码查看模式（Ctrl+E 切换） ----------
// 每标签独立视图模式：源码 = 容器内 textarea 覆盖层（不销毁 Crepe 实例），
// 进入时 getMarkdown()（canonical）填入，退出时 replaceAll() 解析回 doc。
// 源码编辑不触发 markdownUpdated（doc 不变）→ 脏标记由 textarea input 自行维护；
// 保存/校验等读 doc 的操作前调 ensureDocSynced 把源码同步进 doc。

function ensureSourceTa(inst: Instance, tabId: string): HTMLTextAreaElement {
  if (inst.srcTa) return inst.srcTa
  const ta = document.createElement('textarea')
  ta.className = 'source-ta'
  ta.setAttribute('data-source-ta', '')
  ta.spellcheck = false
  ta.placeholder = 'Markdown 源码（Ctrl+E 切回所见即所得）'
  ta.addEventListener('input', () => {
    const t = state.tabs.find((x) => x.id === tabId)
    if (!t) return
    // 源码编辑 = 真实用户输入（§6.7 时间戳机制复用，容器 onInput 也会置 userEditedAt）
    t.userEditedAt = Date.now()
    const nowDirty = ta.value !== t.savedContent
    if (t.dirty !== nowDirty) t.dirty = nowDirty
    t.lastModified = Date.now()
  })
  // Tab 键插入两个空格（原生 textarea 的 Tab 会跳焦点）
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      const s = ta.selectionStart
      const en = ta.selectionEnd
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en)
      ta.setSelectionRange(s + 2, s + 2)
    }
  })
  inst.el.appendChild(ta)
  inst.srcTa = ta
  return ta
}

/** 源码模式 → 把 textarea 最新内容解析回 ProseMirror doc（不切换模式）。
 *  保存/校验/定位等读 doc 的操作前调用；非源码模式或内容未变时无操作。
 *  不 suppressing：replaceAll 触发 markdownUpdated → 脏检测/防抖校验正常走。 */
async function ensureDocSynced(tabId: string): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  const inst = instances.get(tabId)
  if (!tab || !inst || tab.viewMode !== 'source' || !inst.srcTa) return
  const ta = inst.srcTa
  const current = inst.crepe.getMarkdown()
  if (ta.value === current) return
  inst.crepe.editor.action(replaceAll(ta.value))
  await resolveRefs(inst.crepe.editor)
  void refreshBrokenState(inst.crepe.editor)
}

/** 视图切换（M11：wysiwyg / source / diff 三态）。
 *  - 进入 source：getMarkdown() 填入 textarea，隐藏 .milkdown，焦点末尾
 *  - 进入 diff：隐藏 .milkdown（diff 面板由 DiffView.vue 渲染，v-show 跟随 viewMode）
 *  - 回 wysiwyg：source 先 ensureDocSynced；diff 直接恢复可见性
 * 保留 diff 数据（tab.diff 不清除，切回再进入秒开）。 */
async function setViewMode(tabId: string, mode: ViewMode): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  const inst = instances.get(tabId)
  if (!tab || !inst || tab.viewMode === mode) return
  const milkdownEl = inst.el.querySelector('.milkdown') as HTMLElement | null
  if (mode === 'source') {
    // 从 diff 切源码：先恢复 milkdown 可见（diff 面板 v-show 自行隐藏）
    if (tab.viewMode === 'diff' && milkdownEl) milkdownEl.style.display = 'block'
    const ta = ensureSourceTa(inst, tabId)
    ta.value = inst.crepe.getMarkdown()
    ta.style.display = 'block'
    if (milkdownEl) milkdownEl.style.display = 'none'
    inst.el.classList.add('source-mode')
    inst.el.classList.remove('diff-mode')
    tab.viewMode = 'source'
    // 光标放末尾，便于继续输入
    ta.focus()
    const len = ta.value.length
    ta.setSelectionRange(len, len)
  } else if (mode === 'diff') {
    // 从源码切 diff：先同步（此时 viewMode 仍为 source，ensureDocSynced 才会执行）再隐藏
    if (tab.viewMode === 'source') await ensureDocSynced(tabId)
    const ta = inst.srcTa
    if (ta) ta.style.display = 'none'
    if (milkdownEl) milkdownEl.style.display = 'none'
    inst.el.classList.add('diff-mode')
    inst.el.classList.remove('source-mode')
    tab.viewMode = 'diff'
  } else {
    // 回 wysiwyg
    if (tab.viewMode === 'source') {
      await ensureDocSynced(tabId)
      const ta = inst.srcTa
      if (ta) ta.style.display = 'none'
    }
    if (milkdownEl) milkdownEl.style.display = 'block'
    inst.el.classList.remove('source-mode', 'diff-mode')
    tab.viewMode = 'wysiwyg'
    // 焦点还给编辑器
    requestAnimationFrame(() => {
      const viewEl = inst.el.querySelector('.ProseMirror') as HTMLElement | null
      viewEl?.focus()
    })
  }
  syncActiveTopbar()
  syncRefsFooterVisibility(tabId)
}

export async function toggleSourceMode(tabId: string): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab) return
  const next = tab.viewMode === 'source' ? 'wysiwyg' : 'source'
  diagEvent('view:source-toggle', { target: tab.path, data: { to: next } })
  await setViewMode(tabId, next)
}

// ---------- M11：Git diff 视图 ----------

/** 工作区文件内容（mock 演示仓库 = mockGit worktree；否则 = fs 磁盘）
 * 文件不存在/已删除（如 D 状态或演示虚拟文件）→ 返回空串，不抛未处理异常 */
async function readWorktreeFile(path: string): Promise<string> {
  const { isMockGit } = await import('../git')
  try {
    return isMockGit() ? await git.showFile(path, 'WORKTREE') : await fs.readFile(path)
  } catch {
    return ''
  }
}

/** 打开某文件的 Git diff（工作区 vs HEAD / commit vs 父提交 / a..b）。
 *  进入前自动保存该文件（git diff 反映磁盘状态）；保留已加载的 diff 数据（切回秒开）。 */
export async function openGitDiff(path: string, base: DiffBase): Promise<void> {
  if (!git.available) {
    toast('Git 功能仅在桌面应用中可用', 'info')
    return
  }
  diagEvent('git:open-diff', { target: path, data: { base } })
  // M16：git 标签（kind='git'）与文件树打开的 editor 标签互不占用。
  // 该 git 标签已有未保存改动 → 先保存（保证磁盘 == 编辑器所见）
  let tab = state.tabs.find((t) => t.path === path && t.kind === 'git')
  if (tab) {
    if (tab.dirty) {
      const ok = await saveTab(tab.id)
      if (!ok) return
    }
    activateTab(tab.id)
  } else {
    await openTab(path, await readWorktreeFile(path), 'git')
    tab = state.tabs.find((x) => x.path === path && x.kind === 'git') ?? null
  }
  const t = tab ?? state.tabs.find((x) => x.path === path)
  if (!t) return
  await waitForInstance(t.id)
  // base 相同且有数据 → 直接切视图（range 额外比对 from/to）；M18：切回时轻量复核内容指纹
  const sameBase =
    t.diff &&
    t.diff.base.kind === base.kind &&
    (base.kind !== 'range' || (t.diff.base.kind === 'range' && t.diff.base.from === base.from && t.diff.base.to === base.to)) &&
    !t.diff.loading
  if (sameBase) {
    await recheckDiffFreshness(t.id)
    await setViewMode(t.id, 'diff')
    return
  }
  t.diff = {
    path,
    base,
    hunks: [],
    added: 0,
    deleted: 0,
    exists: true,
    loading: true,
    mode: 'render',
    renderData: null,
    renderLoading: false,
    renderError: null,
    scrollTop: 0,
  }
  await setViewMode(t.id, 'diff')
  try {
    const res = await git.diffFile(path, base)
    const cur = state.tabs.find((x) => x.id === t.id)
    if (cur && cur.diff) {
      cur.diff.hunks = res.hunks
      cur.diff.added = res.added
      cur.diff.deleted = res.deleted
      cur.diff.exists = res.exists
      cur.diff.loading = false
    }
    diagEvent('git:diff-loaded', { target: path, ok: true, data: { added: res.added, deleted: res.deleted } })
  } catch (e) {
    toast(`加载 diff 失败: ${(e as Error).message}`, 'error')
    diag('error', 'git-diff', `加载 diff 失败: ${(e as Error).message}`)
    diagEvent('git:diff-loaded', { target: path, ok: false, data: { error: (e as Error).message } })
    const cur = state.tabs.find((x) => x.id === t.id)
    if (cur && cur.diff) cur.diff.loading = false
  }
}

/** M11c/M16：懒加载渲染模式所需的两版本内容（随 DiffBase kind 决定基准） */
export async function loadRenderData(tabId: string): Promise<void> {
  const t = state.tabs.find((x) => x.id === tabId)
  const d = t?.diff
  if (!d || d.renderData || d.renderLoading) return
  d.renderLoading = true
  d.renderError = null
  try {
    // 新版本
    let newMd: string
    if (d.base.kind === 'worktree' || d.base.kind === 'unstaged') {
      newMd = await readWorktreeFile(d.path)
    } else if (d.base.kind === 'staged') {
      // index blob：git show :path（rev='' 时后端拼成 `:path`）
      newMd = await git.showFile(d.path, '')
    } else {
      // range：提交中新增/删除的文件在端点可能不存在（git show fatal）→ 降级为空文档
      try {
        newMd = await git.showFile(d.path, d.base.to)
      } catch {
        newMd = ''
      }
    }
    // 旧版本
    let oldMd: string
    if (d.base.kind === 'unstaged') {
      // 旧 = index blob；未跟踪新文件 → 旧版本为空文档
      try {
        oldMd = await git.showFile(d.path, '')
      } catch {
        oldMd = ''
      }
    } else if (d.base.kind === 'staged' || d.base.kind === 'worktree') {
      // 新文件（A）不在 HEAD：git show HEAD:path 报 fatal → 旧版本降级为空文档
      try {
        oldMd = await git.showFile(d.path, 'HEAD')
      } catch {
        oldMd = ''
      }
    } else {
      try {
        oldMd = await git.showFile(d.path, d.base.from)
      } catch {
        oldMd = ''
      }
    }
    const cur = state.tabs.find((x) => x.id === tabId)
    if (cur?.diff) {
      cur.diff.renderData = { oldMd, newMd }
      // M18 §4.6：内容指纹（磁盘外部变化自动刷新依据；hash 零额外成本）
      cur.diff.freshToken = { oldHash: contentHash(oldMd), nextHash: contentHash(newMd) }
    }
  } catch (e) {
    toast(`加载渲染数据失败: ${(e as Error).message}`, 'error')
    const cur = state.tabs.find((x) => x.id === tabId)
    if (cur?.diff) cur.diff.renderError = (e as Error).message
  } finally {
    const cur = state.tabs.find((x) => x.id === tabId)
    if (cur?.diff) cur.diff.renderLoading = false
  }
}

/** M18 §4.6 新鲜度复核：进入 diff 视图/切回标签时轻量检查新版本内容指纹，
 *  磁盘外部变化（应用外 git 提交/外部编辑器改文件）→ 自动重算 + toast */
export async function recheckDiffFreshness(tabId: string): Promise<boolean> {
  const tab = state.tabs.find((t) => t.id === tabId)
  const d = tab?.diff
  if (!d || !d.renderData || !d.freshToken || d.loading) return false
  try {
    let newMd: string
    if (d.base.kind === 'worktree' || d.base.kind === 'unstaged') {
      newMd = await readWorktreeFile(d.path)
    } else if (d.base.kind === 'staged') {
      newMd = await git.showFile(d.path, '')
    } else {
      try {
        newMd = await git.showFile(d.path, d.base.to)
      } catch {
        return false
      }
    }
    if (contentHash(newMd) === d.freshToken.nextHash) return false
    // 失效：清空渲染数据强制重算 + 刷新 hunks
    const cur = state.tabs.find((x) => x.id === tabId)
    if (cur?.diff) {
      cur.diff.renderData = null
      cur.diff.freshToken = null
      cur.diff.hunks = []
    }
    toast('内容已变化，diff 已刷新', 'info')
    void loadRenderData(tabId)
    return true
  } catch {
    return false
  }
}

/** 渲染模式引用 chip 点击打开目标（复用正文 handleOpenRef 逻辑）；hostPath 供嵌入链环检测链根 */
export function buildRenderRefCfg(hostPath?: string | null): import('./ref/config').RefConfig {
  return {
    fs: {
      readFile: async (p: string) => readWorktreeFile(p),
      readTree: (showAll?: boolean) => fs.readTree(Boolean(showAll)),
      writeFile: (p: string, c: string) => fs.writeFile(p, c),
    },
    toast,
    hostPath: hostPath ?? null,
    openFile: (path, fragment) => {
      void openRefTarget(path, fragment)
    },
    reSelect: () => undefined,
    getTreeVersion: () => state.treeVersion,
    templateService,
  }
}

/** 引用 chip 点击 → 解析真实路径 → 打开标签 → #片段滚动 */
export async function openRefTarget(path: string, fragment: string | null): Promise<void> {
  const refCfg = buildRenderRefCfg()
  const real = await resolveRefPath(refCfg, path)
  if (!real) {
    toast(`文件不存在：${path}`, 'error')
    return
  }
  await openTab(real)
  if (fragment) await scrollToHeading(fragment)
}

/** 退出 diff 视图（回到 wysiwyg；diff 数据保留） */
export async function closeGitDiff(tabId: string): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  // M16：git 标签（SCM/Git 改动打开的独立标签）→ 关闭标签本身；editor 标签 → 回到编辑器视图
  if (tab?.kind === 'git' && tab.viewMode === 'diff') {
    await closeTab(tab.id)
    return
  }
  await setViewMode(tabId, 'wysiwyg')
}

/** 当前活动文件打开 Git 改动（快捷键/文件树右键入口） */
export async function openActiveGitDiff(): Promise<void> {
  if (!git.available) {
    toast('Git 功能仅在桌面应用中可用', 'info')
    return
  }
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  if (!tab) {
    toast('当前没有打开的文件', 'info')
    return
  }
  await openGitDiff(tab.path, { kind: 'worktree', label: '工作区 vs HEAD' })
}

/** Git 面板刷新钩子（还原/切换分支后调用） */
export function refreshGitPanel() {
  state.gitPanel.version++
}

/** M15：全局替换落盘后同步已打开的标签。
 * 仅刷新「无自身编辑」的标签（savedContent 与磁盘一致时）；
 * 有未保存编辑的标签跳过（保留用户内容，磁盘已被替换），返回跳过的路径。
 * diff 视图标签也跳过（内容由 git 数据渲染，避免状态错乱）。 */
export async function syncTabsAfterReplace(updated: Map<string, string>): Promise<string[]> {
  const skipped: string[] = []
  for (const [path, content] of updated) {
    const tab = state.tabs.find((t) => t.path === path)
    if (!tab || tab.viewMode === 'diff') continue
    const inst = instances.get(tab.id)
    if (!inst) continue
    // 有自身编辑 → 不覆盖
    if (tab.dirty) {
      skipped.push(path)
      continue
    }
    // 源码模式先退出（否则 textarea 残留旧内容）
    if (tab.viewMode === 'source') await setViewMode(tab.id, 'wysiwyg')
    inst.suppressing = true
    try {
      inst.crepe.editor.action(replaceAll(content))
      await resolveRefs(inst.crepe.editor)
      tab.savedContent = inst.crepe.getMarkdown()
      tab.dirty = false
      tab.blockSnapshot = collectBlockContentsSync(inst.crepe.editor)
      tab.lastSyncBlocks = new Map(tab.blockSnapshot ?? [])
      tab.lastModified = Date.now()
    } finally {
      setTimeout(() => (inst.suppressing = false), 0)
    }
  }
  return skipped
}

/** 从磁盘重载标签内容（还原后同步编辑器；不写盘） */
async function reloadTabFromDisk(tabId: string): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  const inst = instances.get(tabId)
  if (!tab || !inst) return
  try {
    const content = await readWorktreeFile(tab.path)
    // 源码模式先退出（否则 textarea 残留旧内容）
    if (tab.viewMode === 'source') await setViewMode(tabId, 'wysiwyg')
    inst.suppressing = true
    inst.crepe.editor.action(replaceAll(content))
    await resolveRefs(inst.crepe.editor)
    tab.savedContent = inst.crepe.getMarkdown()
    tab.dirty = false
    tab.blockSnapshot = collectBlockContentsSync(inst.crepe.editor)
    tab.lastSyncBlocks = new Map(tab.blockSnapshot ?? [])
    tab.lastModified = Date.now()
    // diff 数据过期：清空重新加载（base 不变时 openGitDiff 会复用 → 强制失效）
    if (tab.diff) tab.diff = null
    inst.suppressing = false
  } catch (e) {
    inst.suppressing = false
    toast(`刷新文件内容失败: ${(e as Error).message}`, 'error')
  }
}

/** 还原整文件（仅 Changes 区语义：worktree ← index；危险操作带确认） */
export async function discardFileDiff(tabId: string): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  const d = tab?.diff
  if (!d || !isDiffEditable(d.base) || !d.exists) return
  const ok = await confirmDialog({
    title: '还原整个文件？',
    message: `将丢弃「${d.path}」的全部未提交改动（${d.added} 增 / ${d.deleted} 删），恢复到已暂存/HEAD 版本。\n\n此操作不可撤销。`,
    confirmText: '还原文件',
    danger: true,
  })
  if (!ok) return
  try {
    await git.discardFile(d.path)
    // 该文件的打开标签同步为磁盘内容；git 标签（SCM 打开的独立标签）→ 关闭
    if (state.tabs.find((t) => t.path === d.path)) {
      await reloadTabFromDisk(tab.id)
      if (tab.kind === 'git') {
        await closeTab(tab.id)
      } else {
        await setViewMode(tab.id, 'wysiwyg')
      }
    }
    refreshGitPanel()
    toast('已还原文件改动', 'success')
  } catch (e) {
    toast(`还原失败: ${(e as Error).message}`, 'error')
  }
}

/** 还原单个 hunk（仅 Changes 区，index..worktree 层） */
export async function discardHunkDiff(tabId: string, hunkIdx: number): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  const d = tab?.diff
  if (!d || !isDiffEditable(d.base)) return
  const hunk = d.hunks[hunkIdx]
  if (!hunk) return
  const ok = await confirmDialog({
    title: '还原这段改动？',
    message: `将丢弃第 ${hunkIdx + 1} 处改动（@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@），恢复到 HEAD 版本。\n\n此操作不可撤销。`,
    confirmText: '还原此段',
    danger: true,
  })
  if (!ok) return
  try {
    await git.discardHunk(d.path, hunkIdx)
    if (state.tabs.find((t) => t.path === d.path)) {
      await reloadTabFromDisk(tab.id)
      if (tab.kind === 'git') {
        await closeTab(tab.id)
      } else {
        await setViewMode(tab.id, 'wysiwyg')
      }
    }
    refreshGitPanel()
    toast('已还原该处改动', 'success')
  } catch (e) {
    toast(`还原失败: ${(e as Error).message}`, 'error')
  }
}

/** 切换分支（未提交改动确认 + 关闭旧分支打开的文件） */
export async function switchGitBranch(name: string): Promise<void> {
  const g = state.gitPanel
  if (!g.repo?.isRepo || g.repo.branch === name) return
  const dirtyCount = g.status.length
  const ok = await confirmDialog({
    title: `切换到分支「${name}」？`,
    message:
      dirtyCount > 0
        ? `当前有 ${dirtyCount} 个文件的未提交改动，切换分支可能导致冲突（未提交改动会随分支保留）。\n\n建议先提交或还原未提交改动。`
        : `切换到分支「${name}」，工作区内容将更新为该分支版本，已打开的文件会重新加载。`,
    confirmText: '切换分支',
    danger: dirtyCount > 0,
  })
  if (!ok) return
  try {
    await git.checkoutBranch(name)
    // 关闭所有打开标签（内容属于旧分支）→ 刷新文件树 + Git 面板
    const openTabs = [...state.tabs]
    for (const t of openTabs) {
      await closeTab(t.id)
    }
    state.treeVersion++
    await refreshTree()
    refreshGitPanel()
    toast(`已切换到分支 ${name}`, 'success')
  } catch (e) {
    toast(`切换分支失败: ${(e as Error).message}`, 'error')
  }
}

// M5：校验面板点击违规跳转到文档位置（打开/激活标签 + 滚动到 pos）
export async function scrollToPos(tabId: string, pos: number): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab) return
  // M7：源码模式下定位 → 先切回所见即所得（用户要看到位置）
  if (tab.viewMode === 'source') await setViewMode(tabId, 'wysiwyg')
  if (state.activeTabId !== tabId) {
    await openTab(tabId)
  }
  const inst = instances.get(tabId)
  if (!inst) return
  await new Promise((r) => setTimeout(r, 120))
  // 目标标题停在视口顶部附近（小偏移，滚动充分，不留下方大片空白）
  const TOP_OFFSET = 10
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
          pane.scrollTop + (elRect.top - paneRect.top) - TOP_OFFSET
        pane.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
      }
    })
  } catch {
    /* 编辑器已销毁 */
  }
  // 保险：动画结束后复查——若目标仍明显偏离（大表格/嵌入块撑高导致位移/滚动被打断），补一次精确定位
  setTimeout(() => {
    const cur = instances.get(tabId)
    if (!cur) return
    void cur.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const dom = view.domAtPos(Math.min(pos, view.state.doc.content.size))
      const el = (dom.node as HTMLElement)?.closest?.('td, th, p, li, h1, h2, h3, h4, pre') ?? (dom.node as HTMLElement)
      const pane = cur.el.classList.contains('editor-pane')
        ? cur.el
        : (cur.el.querySelector('.editor-pane') as HTMLElement | null)
      if (!pane || !el) return
      const off = el.getBoundingClientRect().top - pane.getBoundingClientRect().top
      if (off > 48 || off < -4) {
        pane.scrollTo({ top: pane.scrollTop + off - TOP_OFFSET, behavior: 'smooth' })
      }
    })
  }, 460)
}

// M5：手动重新校验活动标签（面板 ⟳ 按钮）
export async function refreshValidation(): Promise<void> {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return
  // M7：源码模式下先用 textarea 最新内容同步 doc，再校验（保证校验结果对应源码）
  if (state.activeTabId) await ensureDocSynced(state.activeTabId)
  const res = await validateEditor(inst.crepe.editor, state.activeTabId!, { silent: true })
  const n = res.violations.length
  if (n === 0) toast('校验通过：未发现违规', 'success')
  else toast(`校验完成：${n} 项违规（${res.violations.filter((v) => v.level === 'error').length} 错误）`, 'error')
}

/** M8.1：全选（Mod-a）产生 AllSelection——crepe 工具栏只认 TextSelection（全选时工具栏隐藏，
 * 添加批注/加粗等点击失效）。把 AllSelection 规范化为等价的 TextSelection(0, size)：
 * 复制/加粗/批注行为一致，工具栏可正常显示（Ctrl+R 等键盘入口本就可用）。 */
const selectionNormalizePlugin = new Plugin({
  view: (view) => ({
    update: (view) => {
      const sel = view.state.selection
      if (sel instanceof AllSelection && view.editable) {
        const size = view.state.doc.content.size
        if (size > 0) {
          view.dispatch(
            view.state.tr.setSelection(TextSelection.create(view.state.doc, 0, size))
          )
        }
      }
    },
  }),
})

/** 当前活动标签的编辑器实例（抽屉/批注卡读取 doc 用） */
export function getActiveInstance(): Instance | null {
  return state.activeTabId ? (instances.get(state.activeTabId) ?? null) : null
}

/** 当前活动标签的 markdown（导出/诊断用；源码模式返回 textarea 最新内容，同 __editorGetMarkdown） */
export function getActiveTabMarkdown(): string | null {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return null
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  if (tab?.viewMode === 'source' && inst.srcTa) return inst.srcTa.value
  return inst.crepe.getMarkdown()
}

/** 按路径取已打开标签的 markdown（批量导出用；未打开返回 null） */
export function getTabMarkdownByPath(path: string): string | null {
  const tab = state.tabs.find((t) => t.path === path)
  if (!tab) return null
  const inst = instances.get(tab.id)
  if (!inst) return null
  if (tab.viewMode === 'source' && inst.srcTa) return inst.srcTa.value
  return inst.crepe.getMarkdown()
}

// 调试钩子：测试时可访问当前编辑器的内部（schema / doc 等）
;(window as unknown as { __editorDebug?: unknown }).__editorDebug = () => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  return inst?.crepe.editor ?? null
}
;(window as unknown as { __editorGetMarkdown?: unknown }).__editorGetMarkdown = () => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return ''
  // M7：源码模式下返回 textarea 最新内容（doc 是同步前的旧内容）
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  if (tab?.viewMode === 'source' && inst.srcTa) return inst.srcTa.value
  return inst.crepe.getMarkdown()
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
;(window as unknown as { __editorBlockAppend?: unknown }).__editorBlockAppend = (pathSubstr: string, text: string, idx = 0) => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return 'no-inst'
  let res = 'no-block'
  inst.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    const matches: number[] = []
    doc.descendants((n, p) => {
      if (n.type.name === 'file_block' && (n.attrs.path as string).includes(pathSubstr)) {
        matches.push(p)
      }
      return true
    })
    const blockPos = matches[idx]
    if (blockPos === undefined) {
      res = 'no-block@' + matches.length
      return
    }
    const node = doc.nodeAt(blockPos)
    if (!node) return
    const end = blockPos + node.nodeSize - 1
    // 块内末尾插入新段落
    const para = view.state.schema.nodes.paragraph.create(null, view.state.schema.text(text))
    const tr = view.state.tr.insert(end, para)
    view.dispatch(tr)
    res = 'inserted@' + matches.length
  })
  return res
}
;(window as unknown as { __registryDiag?: unknown }).__registryDiag = () => {
  return registryDiag()
}
;(window as unknown as { __editorOpenPath?: unknown }).__editorOpenPath = (path: string) => {
  void openTab(path)
}
;(window as unknown as { __editorReplaceAll?: unknown }).__editorReplaceAll = (md: string) => {
  const inst = state.activeTabId ? instances.get(state.activeTabId) : null
  if (!inst) return 'no-inst'
  inst.suppressing = true
  try {
    inst.crepe.editor.action(replaceAll(md))
    void resolveRefs(inst.crepe.editor)
  } finally {
    setTimeout(() => (inst.suppressing = false), 0)
  }
  return 'done'
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

// M3：引用 chip 点击跳转（扩展名补全 + #片段滚动到标题）——P0 改为经 refConfigCtx 注入（见 mountEditor）
// M3：断链 chip 点击 → 打开菜单重选（替换模式）——同上，reSelect 回调注入

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
        const target = pane.scrollTop + (titleRect.top - paneRect.top) - 10
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

// M15：搜索结果跳转 → 打开文件并滚动到匹配处
// 参数为文件路径（与搜索结果一致）；内部确保标签打开/激活后再定位。
// 定位策略：
//  ① DOM 文本流第 occurrence 次出现（渲染顺序 = 源顺序，含嵌入卡片等 DOM 注入内容）→ 滚动到位
//  ② 普通文本场景附加 PM inline decoration 高亮命中词（occurrence 与 DOM 一致；
//     代码块/卡片内部文本不可按 pos 寻址或 inline 不渲染 → 仅滚动，块本身醒目）
//  ③ DOM 失败时回退 PM 文本流（顺序保底 + 上下文纠偏）
// 高亮编辑/重绘自动清除；不做任何 DOM 结构修改（避免 PM DOMObserver 重绘干扰）。
export interface SearchJumpOptions {
  /** 该命中在源文件中是关键词的第几次出现（0 起；与搜索结果产生时的统计一致） */
  occurrence?: number
  /** 大小写敏感（与搜索结果选项一致，保证出现序号对齐） */
  caseSensitive?: boolean
  /** 命中关键词前 12 字符（行内上下文，纠偏定位） */
  before?: string
  /** 命中关键词后 12 字符（行内上下文，纠偏定位） */
  after?: string
}

/** 编辑器滚动容器（复用 scrollToPos 的判定：溢出量最大的滚动祖先） */
function findScrollContainer(el: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = el
  let best = el
  let bestOverflow = 0
  while (cur && cur !== document.body) {
    const overflow = cur.scrollHeight - cur.clientHeight
    if (overflow > bestOverflow) {
      bestOverflow = overflow
      best = cur
    }
    cur = cur.parentElement
  }
  return best
}

/**
 * DOM 文本流定位：第 occurrence 次关键词出现的文本节点 → 滚动到可见（不修改 DOM）。
 * 首次打开文件时编辑器异步渲染（懒加载图片/卡片/mermaid）会在滚动后重排布局、
 * 把 scrollTop 重置；为此对同一命中节点做多次延迟重滚（内容收敛后自动校正对齐）。
 * plain=true 表示命中在普通文本区域（PM inline decoration 可渲染且序号与 DOM 一致）。
 */
function locateInDom(
  needle: string,
  occurrence: number,
  caseSensitive: boolean,
  doSettle: boolean
): { ok: boolean; plain: boolean } {
  const root = document.querySelector('.milkdown .ProseMirror') as HTMLElement | null
  if (!root || !needle) return { ok: false, plain: false }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const q = caseSensitive ? needle : needle.toLowerCase()
  let n = 0
  let node: Node | null = walker.nextNode()
  while (node) {
    const text = node.nodeValue ?? ''
    const src = caseSensitive ? text : text.toLowerCase()
    let i = src.indexOf(q)
    while (i >= 0) {
      if (n === occurrence) {
        const el = node.parentElement
        const plain = !el?.closest('pre, code, [contenteditable="false"]')
        try {
          const hitNode = node as Text
          const offset = i
          const len = needle.length
          const hitRoot = root
          // 命中词定位到视口高度约 30% 处（偏上但留出下方空间，看着舒服）
          const scrollToHit = (smooth: boolean) => {
            try {
              const range = document.createRange()
              range.setStart(hitNode, offset)
              range.setEnd(hitNode, Math.min(offset + len, hitNode.length))
              const r = range.getBoundingClientRect()
              const pane = findScrollContainer(hitRoot)
              const paneRect = pane.getBoundingClientRect()
              const target = Math.max(
                0,
                pane.scrollTop + (r.top - paneRect.top) - pane.clientHeight * 0.3
              )
              pane.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' })
            } catch {
              /* 节点可能在重绘中被重建/移除：忽略 */
            }
          }
          // 立即定位（首帧不跳动）
          scrollToHit(false)
          // 仅首次打开文件时才延迟校正：首次打开时编辑器异步渲染会在滚动后重排、
          // 可能重置 scrollTop——延迟两次直接平滑对齐到目标位置（30%），确保最终落点正确。
          // 已稳定文件二次点击无需校正，避免多余的微调滚动。
          if (doSettle) {
            const settle = () => scrollToHit(true)
            setTimeout(settle, 320)
            setTimeout(settle, 900)
          }
          return { ok: true, plain }
        } catch {
          return { ok: false, plain }
        }
      }
      n++
      i = src.indexOf(q, i + Math.max(q.length, 1))
    }
    node = walker.nextNode()
  }
  return { ok: false, plain: false }
}

export async function scrollToSearchMatch(
  path: string,
  lineText: string,
  needle: string,
  opts: SearchJumpOptions = {}
): Promise<number | null> {
  // 记录是否首次打开（首次打开需要延迟校正滚动，已打开则无需）
  const isNewTab = !state.tabs.find((t) => t.path === path)
  // 未打开则打开（已打开则激活）
  if (state.tabs.find((t) => t.path === path) === undefined) await openTab(path)
  const tab = state.tabs.find((t) => t.path === path)
  if (!tab || tab.viewMode === 'diff') return null
  // 源码模式下先切回所见即所得（用户要看到渲染位置）
  if (tab.viewMode === 'source') await setViewMode(tab.id, 'wysiwyg')
  if (state.activeTabId !== tab.id) {
    activateTab(tab.id)
  }
  // 首次打开：编辑器实例异步挂载（crepe.create 耗时），等待就绪（最多 ~3s）
  let inst = instances.get(tab.id)
  if (!inst) {
    for (let i = 0; i < 30 && !inst; i++) {
      await new Promise((r) => setTimeout(r, 100))
      inst = instances.get(tab.id)
    }
  }
  if (!inst) return null

  const needleStr = needle.trim()
  const targetOcc = opts.occurrence ?? 0
  const lineNorm = lineText.trim()
  const needleNorm = opts.caseSensitive ? needleStr : needleStr.toLowerCase()
  const before = (opts.before ?? '').trim()
  const after = (opts.after ?? '').trim()

  // ① DOM 文本流定位（滚动）——等待编辑器渲染出内容
  let domOk = false
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = locateInDom(needleStr, targetOcc, !!opts.caseSensitive, isNewTab)
    if (r.ok) {
      domOk = true
      break
    }
    if (document.querySelector('.milkdown .ProseMirror')?.textContent?.trim()) break
    await new Promise((res) => setTimeout(res, 150))
  }
  if (domOk) {
    // 同文件全部匹配高亮（普通文本区域；卡片/代码块内部文本不可寻址则跳过）
    const ranges = await collectAllRanges(inst, needleStr, !!opts.caseSensitive)
    if (ranges.length) {
      const cur = Math.min(targetOcc, ranges.length - 1)
      setSearchHighlights(
        inst.crepe.editor,
        ranges.map((r, i) => ({ from: r.from, to: r.to, current: i === cur }))
      )
    }
    return null
  }

  // ② PM 文本流兜底（含重试：内容异步加载可能晚于实例创建）
  for (let attempt = 0; attempt < 8; attempt++) {
    const f = await pmLocateHit(
      inst,
      needleStr,
      needleNorm,
      lineNorm,
      before,
      after,
      targetOcc,
      !!opts.caseSensitive
    )
    if (!f) return null
    if (f.kind === 'none') {
      if (f.pos === -2) {
        await new Promise((r) => setTimeout(r, 150))
        continue
      }
      return null
    }
    await scrollToPos(tab.id, f.pos)
    // 兜底路径同样高亮同文件全部匹配
    const ranges = await collectAllRanges(inst, needleStr, !!opts.caseSensitive)
    if (ranges.length) {
      const cur = Math.min(targetOcc, ranges.length - 1)
      setSearchHighlights(
        inst.crepe.editor,
        ranges.map((r, i) => ({ from: r.from, to: r.to, current: i === cur }))
      )
    }
    if (f.kind === 'code' || f.kind === 'node') {
      // 代码块 / 原子卡片内命中：块前徽标提示
      setSearchHighlightWidget(inst.crepe.editor, f.pos)
    }
    return f.pos
  }
  return null
}

/**
 * PM 文本流定位：把文档展平成文本流（普通文本节点精确到 pos；原子节点挂在起点），
 * 按「顺序保底 + 上下文纠偏」挑选第 targetOcc 次出现，返回定位结果。
 */
async function pmLocateHit(
  inst: Instance,
  needleStr: string,
  needleNorm: string,
  lineNorm: string,
  before: string,
  after: string,
  targetOcc: number,
  caseSensitive: boolean
): Promise<{ kind: string; pos: number; from: number; to: number } | null> {
  try {
    const found = await inst.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      if (!view.state.doc.textContent.trim()) return { kind: 'none', pos: -2, from: -1, to: -1 } // 尚未就绪
      let linePos = -1
      interface Seg {
        kind: 'text' | 'node'
        start: number
        end: number
        hitOff: number
        pos: number
        from: number
        to: number
      }
      const segs: Seg[] = []
      let flow = ''
      view.state.doc.descendants((node, pos) => {
        if (node.isText) {
          const text = node.text ?? ''
          if (text) {
            flow += text
            segs.push({ kind: 'text', start: flow.length - text.length, end: flow.length, hitOff: 0, pos, from: pos, to: pos + node.nodeSize })
          }
          if (linePos < 0 && lineNorm && text.includes(lineNorm)) {
            linePos = pos + text.indexOf(lineNorm)
          }
          return true
        }
        // 非文本且无子节点（原子 / 空容器，如嵌入卡片）：文本挂在节点起点
        if (!node.isText && node.childCount === 0) {
          const t = node.textContent
          if (t) {
            flow += t
            segs.push({ kind: 'node', start: flow.length - t.length, end: flow.length, hitOff: 0, pos, from: pos, to: pos + node.nodeSize })
          }
          return false
        }
        return true
      })
      const needleLen = Math.max(needleStr.length, 1)
      const flowNorm = caseSensitive ? flow : flow.toLowerCase()
      const qn = caseSensitive ? needleStr : needleNorm
      const hits: Array<{ seg: Seg; off: number; ctxBefore: string; ctxAfter: string }> = []
      let i = flowNorm.indexOf(qn)
      while (i >= 0) {
        const seg = segs.find((s) => i >= s.start && i < s.end)
        if (seg) {
          hits.push({ seg, off: i, ctxBefore: flow.slice(Math.max(0, i - 12), i), ctxAfter: flow.slice(i + needleLen, i + needleLen + 12) })
        }
        i = flowNorm.indexOf(qn, i + needleLen)
      }
      // 顺序保底 + 上下文纠偏
      let bestScore = -Infinity
      let bestHit: (typeof hits)[number] | null = null
      for (let k = 0; k < hits.length; k++) {
        const h = hits[k]
        let score = 0
        if (k === targetOcc) score += 100
        if (before && h.ctxBefore.includes(before)) score += 40
        if (after && h.ctxAfter.includes(after)) score += 40
        if (before && h.ctxBefore.endsWith(before.slice(-8))) score += 15
        if (after && h.ctxAfter.startsWith(after.slice(0, 8))) score += 15
        if (score > bestScore) {
          bestScore = score
          bestHit = h
        }
      }
      if (bestHit) {
        const seg = bestHit.seg
        const offInSeg = bestHit.off - seg.start
        if (seg.kind === 'text') {
          const at = seg.pos + offInSeg
          if (view.state.doc.resolve(at).parent.type.name === 'code_block') {
            return { kind: 'code', pos: view.state.doc.resolve(at).before(), from: -1, to: -1 }
          }
          return { kind: 'inline', pos: at, from: at, to: at + needleLen }
        }
        return { kind: 'node', pos: seg.pos, from: seg.from, to: seg.to }
      }
      if (linePos >= 0) return { kind: 'inline', pos: linePos, from: linePos, to: linePos + needleLen }
      return { kind: 'none', pos: -1, from: -1, to: -1 }
    })
    return found as { kind: string; pos: number; from: number; to: number }
  } catch {
    return null
  }
}

/**
 * 收集 PM 文档中关键词的全部可寻址命中范围（普通文本区域；
 * code 块内 inline decoration 不渲染、嵌入卡片内部文本不可寻址 → 跳过）。
 */
async function collectAllRanges(
  inst: Instance,
  needleStr: string,
  caseSensitive: boolean
): Promise<Array<{ from: number; to: number }>> {
  if (!needleStr) return []
  try {
    return await inst.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const ranges: Array<{ from: number; to: number }> = []
      const len = needleStr.length
      const q = caseSensitive ? needleStr : needleStr.toLowerCase()
      view.state.doc.descendants((node, pos) => {
        if (!node.isText) return true
        const text = node.text ?? ''
        const src = caseSensitive ? text : text.toLowerCase()
        let i = src.indexOf(q)
        while (i >= 0) {
          if (view.state.doc.resolve(pos + i).parent.type.name !== 'code_block') {
            ranges.push({ from: pos + i, to: pos + i + len })
          }
          i = src.indexOf(q, i + Math.max(len, 1))
        }
        return true
      })
      return ranges
    })
  } catch {
    return []
  }
}


// ---------- 打开 / 激活 ----------

export async function openTab(path: string, contentOverride?: string, kind: 'editor' | 'git' = 'editor'): Promise<void> {
  // 已在标签中（同路径 + 同来源）→ 直接激活（M16：git 与 editor 标签互不占用）
  const existing = state.tabs.find((t) => t.path === path && t.kind === kind)
  if (existing) {
    activateTab(existing.id)
    return
  }

  let content: string
  try {
    content = contentOverride ?? (await fs.readFile(path))
  } catch (e) {
    toast(`打开失败: ${(e as Error).message}`, 'error')
    diag('error', 'tab', `打开失败 ${path}: ${(e as Error).message}`)
    return
  }

  const prevId = state.activeTabId
  // 打开新标签前保存旧标签滚动（DOM 未变，scrollTop 有效）
  if (prevId) saveTabScroll(prevId)

  diagEvent('tab:open', { target: path })
  diag('info', 'tab', `打开 ${path}`)

  const tab: Tab = {
    id: nextTabId(),
    path,
    name: baseName(path),
    kind,
    savedContent: content,
    dirty: false,
    lastModified: Date.now(),
    blockSnapshot: null,
    lastSyncBlocks: null,
    userEditedAt: 0,
    lastExternalSyncAt: 0,
    viewMode: 'wysiwyg',
    diff: null,
  }
  state.tabs.push(tab)
  state.activeTabId = tab.id
  // 容器由 EditorPane.vue 在 mount 时创建并调用 mountEditor
  // 打开文件不自动收纳侧边栏（便于在文件树连续打开多个文件）
}

export function activateTab(id: string) {
  // 切换前保存旧标签的滚动位置（DOM 尚未变化，scrollTop 仍有效；display:none 会把它清 0）
  const prevId = state.activeTabId
  if (prevId && prevId !== id) saveTabScroll(prevId)
  state.activeTabId = id
  if (prevId && prevId !== id) {
    const t = state.tabs.find((x) => x.id === id)
    diagEvent('tab:activate', { target: t?.path ?? id })
  }
  // M6：批注卡上下文跟随活动标签（切标签后 Ctrl+R/批注卡作用于当前编辑器）
  const inst0 = instances.get(id)
  if (inst0) setAnnotationCardContext(id, inst0.crepe.editor)
  syncActiveTopbar()
  // 引用底部展示区：切到该标签时重扫反向引用（其它标签可能新增了对它的引用）
  scheduleRefsFooterRefresh(id)
  // 等 DOM 切换完成后把焦点还给编辑器（M7：源码模式 → 焦点给 textarea）；并恢复本标签滚动
  requestAnimationFrame(() => {
    const inst = instances.get(id)
    if (inst) restoreTabScroll(id)
    const tab = state.tabs.find((t) => t.id === id)
    if (inst && tab?.viewMode === 'source') {
      inst.srcTa?.focus()
      return
    }
    const viewEl = inst?.el.querySelector('.ProseMirror') as HTMLElement | null
    viewEl?.focus()
  })
}

// ---------- 滚动位置保持（display:none 的元素无布局、scrollTop 归 0：隐藏前保存、重新显示时还原） ----------
// 关键时序：display:none 会把 pane 的 scrollTop 清 0，且 Vue 的 watcher(applyDisplay) 在 DOM 更新后才执行，
// 那时已读不到旧滚动值。因此「保存」必须在 activeTabId 切换前（DOM 未变、scrollTop 仍有效）同步调用。

/** 保存标签当前滚动位置（须在容器仍可见时调用——切换 activeTabId 前；源码模式存 textarea，其余存 pane） */
export function saveTabScroll(tabId: string): void {
  const tab = state.tabs.find((t) => t.id === tabId)
  // M16：diff 视图 → 保存 diff 滚动容器位置（.git-diff-view 的滚动块）
  if (tab?.viewMode === 'diff' && tab.diff) {
    const el = document.querySelector<HTMLElement>(`.git-diff-view[data-tab-id="${tabId}"] .diff-body`)
    if (el && el.style.display !== 'none') {
      tab.diff.scrollTop = el.scrollTop
    }
    return
  }
  const inst = instances.get(tabId)
  if (!inst) return
  if (tab?.viewMode === 'source') {
    // 源码模式：textarea 自身滚动（pane overflow hidden，无滚动）
    if (inst.srcTa) inst.scrollTop = inst.srcTa.scrollTop
  } else {
    // 仅当 pane 仍可见时才读（否则 scrollTop 已被清 0，保留上次有效值）
    if (inst.el.style.display !== 'none') inst.scrollTop = inst.el.scrollTop
  }
}

/** 恢复标签保存的滚动位置。切回时 pane 刚从 display:none 恢复，内容（编辑器 DOM）可能尚未 re-layout，
 *  scrollTop 会被 clamp 到 0；且代码块/mermaid 等懒加载（及 refsFooter）会在显示后小几百 ms 内重排并把
 *  scrollTop 重置。因此逐帧“等待内容可滚动（scrollHeight>clientHeight）→ 对齐 saved”，直到达到或窗口超时。 */
export function restoreTabScroll(tabId: string): void {
  const tab = state.tabs.find((t) => t.id === tabId)
  // M16：diff 标签 → 恢复 diff 滚动（内容渲染/懒加载后逐帧对齐）
  if (tab?.viewMode === 'diff' && tab.diff && tab.diff.scrollTop > 0) {
    const saved = tab.diff.scrollTop
    restoreDiffScroll(tabId, saved)
    return
  }
  const inst = instances.get(tabId)
  if (!inst || inst.scrollTop <= 0) return
  const saved = inst.scrollTop
  if (tab?.viewMode === 'source') {
    if (inst.srcTa) inst.srcTa.scrollTop = saved
    return
  }
  const el = inst.el
  let frames = 0
  const MAX_FRAMES = 80 // ~1.3s 窗口：内容未就绪时等待，就绪后对齐（此后再发生的重排大概率已收敛）
  const tryAlign = () => {
    frames++
    if (frames > MAX_FRAMES) return
    const maxScroll = el.scrollHeight - el.clientHeight
    if (maxScroll <= 0) {
      // 内容尚未渲染出可滚动高度 → 等下一帧
      requestAnimationFrame(tryAlign)
      return
    }
    const target = Math.min(saved, maxScroll)
    if (Math.abs(el.scrollTop - target) > 2) el.scrollTop = target
    // 达到（近）目标即认为已稳定，本帧结束（后续放心交给浏览器的正常滚动）
    if (Math.abs(el.scrollTop - target) <= 2) return
    requestAnimationFrame(tryAlign)
  }
  requestAnimationFrame(tryAlign)
}

/** M16：diff 标签滚动恢复（渲染内容/懒加载完成后逐帧对齐；文本模式可立即对齐） */
function restoreDiffScroll(tabId: string, saved: number): void {
  const frame = () => {
    const el = document.querySelector<HTMLElement>(`.git-diff-view[data-tab-id="${tabId}"] .diff-body`)
    if (!el || el.style.display === 'none') return
    if (el.scrollHeight <= el.clientHeight) {
      // 内容未就绪（显示中/懒加载）→ 下一帧再试（最多 ~2s）
      const cur = state.tabs.find((t) => t.id === tabId)
      if (cur?.diff && cur.diff.scrollTop === saved) {
        let n = 0
        const wait = () => {
          if (n++ > 120) return
          const el2 = document.querySelector<HTMLElement>(`.git-diff-view[data-tab-id="${tabId}"] .diff-body`)
          if (!el2 || el2.scrollHeight > el2.clientHeight) {
            const target = Math.min(saved, el2.scrollHeight - el2.clientHeight)
            el2.scrollTop = target
            return
          }
          requestAnimationFrame(wait)
        }
        requestAnimationFrame(wait)
      }
      return
    }
    const target = Math.min(saved, el.scrollHeight - el.clientHeight)
    el.scrollTop = target
  }
  requestAnimationFrame(frame)
}

// ---------- M16：顶部栏槽位（Crepe topbar 横贯整行，大纲/正文都在其下） ----------
let topbarSlot: HTMLElement | null = null
/** 当前在槽位中的 topbar（来自某活动标签的编辑器） */
let slotBar: { inst: Instance; el: HTMLElement; host: HTMLElement } | null = null

// ---------- 原生 topbar 按钮：大纲收纳开关（注入 crepe top-bar-inner，成为真正的 top-bar-item） ----------
/** 在 topbar 的 .top-bar-inner 最前面注入原生 `.top-bar-item` 按钮（存量样式/悬停/active 自动生效） */
function ensureOutlineToggle(bar: HTMLElement): void {
  const inner = bar.querySelector('.top-bar-inner')
  if (!inner) return
  let btn = inner.querySelector<HTMLElement>('.writeit-outline-toggle')
  if (!btn) {
    btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'top-bar-item writeit-outline-toggle'
    // 与存量按钮一致的 24px 描边图标（chevron：收起指向左 / 展开指向右，active 时 180° 旋转）
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>'
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      toggleOutlineFromTopbar()
    })
    inner.insertBefore(btn, inner.firstChild)
  }
  syncOutlineToggleState(btn)
}

/** 大纲开关状态同步（active 类 = 主题主色 + 旋转，与存量 .top-bar-item.active 一致） */
function syncOutlineToggleState(btn: HTMLElement): void {
  const open = settings.outlineOpen
  btn.title = open ? '收起大纲' : '展开大纲'
  btn.classList.toggle('active', open)
}

function toggleOutlineFromTopbar(): void {
  settings.outlineOpen = !settings.outlineOpen
  saveSettings()
}

// 其他入口（面板边缘按钮等）改了 outlineOpen → 同步 topbar 按钮状态
watch(
  () => settings.outlineOpen,
  () => {
    const btn = topbarSlot?.querySelector<HTMLElement>('.writeit-outline-toggle')
    if (btn) syncOutlineToggleState(btn)
  }
)

/** App 挂载后把顶行槽位交给 manager 接管 */
export function bindTopbarSlot(el: HTMLElement): void {
  topbarSlot = el
  syncActiveTopbar()
}

/** 活动标签的 topbar 移入槽位；上一个标签的 topbar 归还原处。源码/diff 模式隐藏整行。 */
export function syncActiveTopbar(): void {
  const slot = topbarSlot
  if (!slot) return
  // ① 归还槽位中的旧 topbar
  if (slotBar) {
    const prev = slotBar
    slotBar = null
    prev.host.remove()
    if (prev.inst.topbar?.parent) {
      prev.inst.topbar.parent.insertBefore(prev.el, prev.inst.topbar.next)
    }
  }
  // ② 当前活动标签的 topbar 进槽位（仅所见即所得模式）
  const tabId = state.activeTabId
  const tab = tabId ? state.tabs.find((t) => t.id === tabId) : null
  const inst = tabId ? instances.get(tabId) : undefined
  if (!tab || !inst?.topbar?.parent || tab.viewMode !== 'wysiwyg') {
    slot.style.display = 'none'
    return
  }
  // 用带 milkdown 类的宿主包裹：让 crepe 主题的 `.milkdown ...` 后代选择器与 CSS 变量继续生效
  const host = document.createElement('div')
  host.className = 'ws-topbar-host milkdown'
  host.appendChild(inst.topbar.el)
  slot.style.display = 'flex'
  slot.appendChild(host)
  slotBar = { inst, el: inst.topbar.el, host }
  // ③ 原生注入大纲收纳按钮（作为 topbar 第一个 .top-bar-item）
  ensureOutlineToggle(inst.topbar.el)
}

/** 销毁前把仍在槽位中的 topbar 归还（避免随容器移除而丢失） */
function releaseSlotBar(tabId: string): void {
  if (slotBar && slotBar.inst && instances.get(tabId) === slotBar.inst) {
    const prev = slotBar
    slotBar = null
    prev.host.remove()
    if (prev.inst.topbar?.parent) {
      prev.inst.topbar.parent.insertBefore(prev.el, prev.inst.topbar.next)
    }
  }
}

// ---------- 引用/被引用 底部展示区 ----------

/** 构建工作区扫描的实时内容覆盖：已打开标签用编辑器实时 markdown（含未保存引用） */
function buildScanLive(): Map<string, string> {
  const live = new Map<string, string>()
  for (const t of state.tabs) {
    const inst = instances.get(t.id)
    if (inst) {
      try {
        // 源码模式：textarea 内容更接近最新（doc 可能未同步）
        if (t.viewMode === 'source' && inst.srcTa) live.set(t.path, inst.srcTa.value)
        else live.set(t.path, inst.crepe.getMarkdown())
      } catch {
        /* 编辑器可能未就绪 */
      }
    }
  }
  return live
}

/** 渲染某标签的引用底部展示区（含异步反向引用扫描） */
async function refreshRefsFooter(tabId: string): Promise<void> {
  const inst = instances.get(tabId)
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!inst || !tab || !inst.refsFooter) return
  await inst.refsFooter.render(tab.path, inst.crepe.editor, { live: buildScanLive() })
}

/** 刷新所有已挂载标签的引用底部展示区（编辑/切换/保存后） */
function refreshAllRefsFooters(): void {
  for (const t of state.tabs) {
    if (instances.get(t.id)?.refsFooter) void refreshRefsFooter(t.id)
  }
}

/** 底部展示区防抖刷新（编辑时避免高频工作区扫描） */
const refsFooterTimers = new Map<string, ReturnType<typeof setTimeout>>()
function scheduleRefsFooterRefresh(tabId: string): void {
  const prev = refsFooterTimers.get(tabId)
  if (prev) clearTimeout(prev)
  refsFooterTimers.set(
    tabId,
    setTimeout(() => {
      refsFooterTimers.delete(tabId)
      void refreshRefsFooter(tabId)
    }, 900)
  )
}

/** 切换视图时同步底部展示区可见性（仅所见即所得展示） */
function syncRefsFooterVisibility(tabId: string): void {
  const inst = instances.get(tabId)
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!inst?.refsFooter) return
  inst.refsFooter.setVisible(tab?.viewMode === 'wysiwyg')
}

// ---------- 挂载 / 销毁（由 EditorPane.vue 调用） ----------

export async function mountEditor(tabId: string, container: HTMLDivElement): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab || instances.has(tabId)) return

  // M4：斜杠菜单「模板」组依赖模板注册表，创建编辑器前确保扫描完成（失败也降级）
  await templateService.ready()

  // P0：ref 插件依赖注入——fs/toast/模板服务/打开文件与重选回调经 refConfigCtx 注入，
  // 插件包本身不 import app 模块。openFile/reSelect 回调内延迟调用（避免 TDZ）。
  const refCfg: RefConfig = {
    fs: {
      readFile: (p: string) => fs.readFile(p),
      readTree: (showAll?: boolean) => fs.readTree(Boolean(showAll)),
      writeFile: (p: string, c: string) => fs.writeFile(p, c),
    },
    toast,
    openFile: (path, fragment) => {
      void handleOpenRef(path, fragment)
    },
    reSelect: (path) => {
      const inst = instances.get(tabId)
      if (inst) {
        void import('./ref/menu').then((m) => m.openReplaceMenu(inst.crepe.editor, path))
      }
    },
    getTreeVersion: () => state.treeVersion,
    templateService,
    // 嵌入链判定的链根（环检测含宿主的用例）；Tab 关闭/重命名后重开即重判
    hostPath: tab.path,
    // P2：registry 视图注册/广播定位
    tabId,
    // P1：写回守卫——源文件在标签中打开且有「真实未保存编辑」时，宿主保存不覆盖它
    isTabUserEdited: (realPath) => {
      const srcTab = state.tabs.find((t) => t.path === realPath && t.kind === 'editor')
      if (!srcTab) return false
      return srcTab.userEditedAt > srcTab.lastExternalSyncAt
    },
    // 系统复制（OS 文件管理器）的绝对路径 → 工作区引用路径：
    // 在工作区内 → 相对路径；无根路径/工作区外 → 文件名（Obsidian 式全库匹配）
    resolveExternalPath: (absPath) => {
      const root = fs.rootPath?.()
      if (root) {
        const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
        const normAbs = absPath.replace(/\\/g, '/')
        if (normAbs.startsWith(normRoot + '/')) return normAbs.slice(normRoot.length + 1)
      }
      return baseName(absPath)
    },
  }
  /** 引用 chip 点击 → 解析真实路径 → 打开标签 → #片段滚动（原 registerOpenRefHandler 逻辑） */
  async function handleOpenRef(path: string, fragment: string | null) {
    const real = await resolveRefPath(refCfg, path)
    if (!real) {
      toast(`文件不存在：${path}`, 'error')
      return
    }
    await openTab(real)
    if (fragment) await scrollToHeading(fragment)
  }
  // M9：mermaid 联想/链接的数据源与打开回调（复用同一 refCfg + handleOpenRef；多标签 cfg 一致）
  registerMermaidRefDeps(refCfg, (path, fragment) => {
    void handleOpenRef(path, fragment)
  })

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
  crepe.editor.config((ctx) => {
    ctx.set(refConfigCtx.key, refCfg)
    // P0：批注配置注入（tabId + 运行时批注读取器）
    ctx.set(annotationConfigCtx.key, {
      tabId,
      getRuntimeAnnotations,
    })
    // P1：校验配置注入（执行器 = validateEditor；shouldSkip = suppressing 期不触发）
    ctx.set(validateConfigCtx.key, {
      tabId,
      run: (tid, opts) => validateEditor(crepe.editor, tid, opts),
      shouldSkip: () => instances.get(tabId)?.suppressing ?? true,
    })
    // 表格增强：注入配置（新增下方行快捷键读 app 设置；默认 Shift+Enter）
    ctx.set(tableConfigCtx.key, buildTableConfig(settings.shortcuts['tableAddRowBelow']))
  })
  crepe.editor.use(refPlugin)
  // M6：批注插件（<mark data-note> 节点 + 运行时批注 decorations，tabId 经 ctx 注入）
  crepe.editor.use(annotationPlugin)
  // 表格增强：单元格换行 / Shift+Enter 新增行 / 多选复制粘贴 / 动态列宽（数组整体 use，同 refPlugin 模式）
  crepe.editor.use(tableEnhancePlugin)
  // P1：校验插件（编辑防抖监听 + validate 命令；引擎 validateEditor 由 config 注入）
  crepe.editor.use(validatePlugin)
  // 大纲：提取标题 + 光标小节实时追踪 → outlineStore(tabId)
  crepe.editor.use(
    outlinePlugin((snap) => {
      outlineStore.tabs[tabId] = snap
      outlineStore.version++
    })
  )
  // 搜索结果高亮（跳转定位后高亮命中词；编辑自动清除）
  crepe.editor.use(searchHighlightPlugin())
  // M8.1：全选（Mod-a）产生 AllSelection——crepe 工具栏只认 TextSelection，
  // 全选时工具栏不显示 → 添加批注/加粗等点击失效。规范化为等价 TextSelection(0, size)
  // （复制/加粗/批注行为一致，且工具栏可显示）。
  crepe.editor.use(selectionNormalizePlugin)
  crepe.editor.config((ctx) => {
    registerRefStringify(ctx)
    // M7：Ctrl+E 让位给源码模式切换——inline-code 快捷键改绑 Ctrl+Shift+E
    ctx.set(inlineCodeKeymap.ctx.key, {
      ToggleInlineCode: { shortcuts: 'Mod-Shift-e' },
    })
  })
  await crepe.create()
  // M6：批注卡上下文（tabId + 编辑器引用）
  setAnnotationCardContext(tabId, crepe.editor)

  const inst: Instance = { crepe, el: container, suppressing: false, srcTa: null, topbar: null, refsFooter: null, scrollTop: 0 }
  instances.set(tabId, inst)

  // 引用/被引用 底部展示区（非编辑）：置于正文（.milkdown）之后，随文档滚动
  inst.refsFooter = createRefFooter(container, (path) => {
    // 引用/被引用 chip 点击：复用正文 chip 的解析逻辑（文档内写法 → 真实路径补扩展名 / Obsidian 基线名匹配）
    void handleOpenRef(path, null)
  })
  syncRefsFooterVisibility(tabId)
  void refreshRefsFooter(tabId)

  // 两段式解析：异步物化引用（容错：失败不影响编辑器）
  void resolveRefs(crepe.editor).then(() => {
    // §6.7：物化完成后建立初始块快照（此后嵌入编辑通过双条件脏检测识别）
    const t = state.tabs.find((x) => x.id === tabId)
    if (t) {
      t.blockSnapshot = collectBlockContentsSync(crepe.editor)
      t.lastSyncBlocks = new Map(t.blockSnapshot ?? [])
      // 打开时的物化 dispatch 不是用户编辑——重置时间戳基线
      t.userEditedAt = 0
    }
    // P2：分配 blockId + 注册块/文档视图（registry 广播定位基础）
    void syncTabViewsToRegistry(tabId)
  })
  void refreshBrokenState(crepe.editor)
  // 引用底部展示区：物化完成后重扫（应用链引用）/断链态稳定后刷新可见性
  void refreshRefsFooter(tabId)
  // M5：打开文档时异步校验（hint/strict 均由 rules.ts 声明；失败降级不中断）
  void validateEditor(crepe.editor, tabId, { silent: true })

  // M16：记录 topbar 原生位置（随后移入工作区顶行槽位；可归还）
  const topbarEl = container.querySelector('.milkdown-top-bar') as HTMLElement | null
  if (topbarEl && topbarEl.parentElement) {
    inst.topbar = { el: topbarEl, parent: topbarEl.parentElement, next: topbarEl.nextSibling }
  }
  // 活动标签的 topbar 进槽位
  syncActiveTopbar()
  // M14：编辑器挂载完成 → 通知批注抽屉刷新（切标签后避免残留上一个标签的批注）
  notifyEditorMounted(tabId)
  // §6.7：真实用户输入（键盘/粘贴/IME）→ 记录时间戳。
  // 用 DOM input 事件而非 markdownUpdated（校验空事务/物化等程序化 dispatch 不触发 input）
  // D2.5b：编辑会话聚合埋点 —— 连续输入（间隔 ≤3s）记为一个会话，暂停时记一条 editor:edit
  //   （逐键埋点噪声大且无意义；会话粒度给出「在哪个文件、编了多久、改了多少」的现场证据）
  let burstEdits = 0
  let burstChars = 0
  let burstStart = 0
  let burstTimer: ReturnType<typeof setTimeout> | null = null
  const flushEditBurst = () => {
    if (burstTimer) {
      clearTimeout(burstTimer)
      burstTimer = null
    }
    if (burstEdits > 0) {
      const t = state.tabs.find((x) => x.id === tabId)
      diagEvent('editor:edit', {
        target: t?.path,
        data: {
          edits: burstEdits,
          chars: burstChars,
          secs: Math.max(1, Math.round((Date.now() - burstStart) / 1000)),
        },
      })
      burstEdits = 0
      burstChars = 0
      burstStart = 0
    }
  }
  const onInput = (e: Event) => {
    const t = state.tabs.find((x) => x.id === tabId)
    if (t) t.userEditedAt = Date.now()
    // 会话聚合（输入事件计数 + 键入字符数；IME 组合/粘贴按事件粒度计）
    if (burstEdits === 0) burstStart = Date.now()
    burstEdits++
    const data = (e as InputEvent).data
    burstChars += typeof data === 'string' ? data.length : 1
    if (burstTimer) clearTimeout(burstTimer)
    burstTimer = setTimeout(flushEditBurst, 3000)
  }
  container.addEventListener('input', onInput)

  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, md) => {
      if (inst.suppressing) return
      // D2.5：渲染计数（每次 doc 内容更新 → 探针统计节奏）
      markEditorRender()
      const t = state.tabs.find((x) => x.id === tabId)
      if (!t) return
      // §6.7 脏检测双条件：markdown 变化 || 可编辑嵌入内容 ≠ 保存时快照
      const blockDirty = hasBlockChanges(inst.crepe.editor, t.blockSnapshot)
      const nowDirty = md !== t.savedContent || blockDirty
      if (t.dirty !== nowDirty) t.dirty = nowDirty
      t.lastModified = Date.now()
      // P2：块编辑 → 提交 registry 真相 + 防抖广播（兄弟块/源标签/其他宿主实时收敛）
      if (blockDirty) void propagateBlockEdits(tabId)
      // P3：源文档编辑 → 若被嵌入则广播到所有嵌入块（脏读根治）
      propagateDocEdit(tabId, md)
      // 引用底部展示区：文档变更后防抖刷新（向外引用更新 + 反向引用重扫）
      scheduleRefsFooterRefresh(tabId)
      // M5：编辑防抖实时校验 → 已由 validatePlugin 的 $prose 监听接管（manager 不再调度）
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
  // M16：若该标签的 topbar 仍占用顶行槽位，先归还原处再销毁
  releaseSlotBar(tabId)
  inst.refsFooter?.dispose()
  inst.crepe.destroy().catch(() => undefined)
  inst.el.remove()
  instances.delete(tabId)
  // P2：清理 registry 视图（块 + 文档）
  registryUnregisterTab(tabId)
  clearOutline(tabId)
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
    srcTab.lastSyncBlocks = new Map(srcTab.blockSnapshot ?? [])
    srcTab.lastModified = Date.now()
    // M7：源标签处于源码模式 → textarea 同步为最新内容（与 doc/磁盘一致）
    if (srcTab.viewMode === 'source' && srcInst.srcTa) {
      srcInst.srcTa.value = canonical
    }
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
    t.lastSyncBlocks = new Map(t.blockSnapshot ?? [])
    const blockDirty = hasBlockChanges(inst.crepe.editor, t.blockSnapshot)
    const md = inst.crepe.getMarkdown()
    t.dirty = md !== t.savedContent || blockDirty
  }
}

/** 块编辑防抖联动 → P2 改为 registry 广播驱动：编辑块提交真相 + 防抖广播（见 propagateBlockEdits） */

/**
 * P2/P3 registry 广播执行器（装配层注入）：把 realPath 的应然内容应用到所有视图（除 origin）。
 *  · block 视图：按 blockId 精确定位 → 冲突检测（视图有未传播自身编辑 → 保留本地 + 提示）→ 填充
 *  · doc 视图：源标签无真实用户编辑 → 预览刷新（replaceAll）；有 → 最后保存者胜，跳过
 * 应用后回写视图 lastContent，保证下一轮广播/保存的脏基线正确。
 */
setRegistryBroadcastHandler((realPath, originKey, entry) => {
  const truth = entry.content
  if (truth == null) return
  for (const view of entry.views.values()) {
    if (view.key === originKey) continue
    const inst = instances.get(view.tabId)
    if (!inst) continue
    if (view.kind === 'block' && view.blockId) {
      applyBlockBroadcast(inst, realPath, view, truth)
    } else if (view.kind === 'doc') {
      void applyDocBroadcast(inst, realPath, view, truth)
    }
  }
})

/** 块视图应用：定位 + 冲突检测 + 填充 + 基线回写 */
function applyBlockBroadcast(
  inst: Instance,
  realPath: string,
  view: { key: string; tabId: string; blockId: string | null; readonly: boolean; lastContent: string | null },
  truth: string
): void {
  const editor = inst.crepe.editor
  if (view.readonly) return // 只读变体固定快照：不接收任何内容广播
  const pos = findBlockPosByBlockId(editor, view.blockId!)
  if (pos == null) return
  // 折叠/未物化态防御：折叠卡是只读治理态，绝不接收内容广播（防误展开）
  const foldedOrUnmaterialized = editor.action((ctx) => {
    const n = ctx.get(editorViewCtx).state.doc.nodeAt(pos)
    return !!n && n.type.name === 'file_block' && (Boolean(n.attrs.collapsed) || !Boolean(n.attrs.materialized))
  })
  if (foldedOrUnmaterialized) return
  // 冲突检测：视图自上次渲染后有未传播的自身编辑 → 不覆盖（保留本地），显式提示
  const cur = serializeBlockContent(editor, pos)
  if (view.lastContent != null && cur !== '' && cur !== view.lastContent) {
    const cfg = getRefConfig(editor)
    cfg?.toast(`嵌入块内容已被本地修改，与源「${realPath}」不同步（已保留本地内容，保存时提示冲突）`, 'info')
    console.warn('[registry] 冲突：跳过覆盖', realPath, view.key)
    return
  }
  if (view.lastContent === truth) return // 已是最新
  inst.suppressing = true
  try {
    fillBlockContent(editor, pos, '', view.readonly, truth)
    // 广播填充的是「块序列化值」（对象引用序列化为 [[path#obj]] 语法）——
    // 填充后必须重新消歧块内引用，否则显示原始链接而非对象文本（用户问题3根因：
    // 保存后块内容“消失/被替换”）。
    void resolveBlockRefs(editor, pos)
  } finally {
    setTimeout(() => (inst.suppressing = false), 0)
  }
  updateViewContent(realPath, view.key, truth)
  // 关键：markdownUpdated 由 listener 防抖 200ms 递送（晚于 suppressing 解除）——
  // 必须立刻把本标签块快照追平（同 saveTab/refreshTabToContent 既有模式），
  // 否则防抖回调把广播刷新误判为用户编辑 → 假脏/回环。
  const t = state.tabs.find((x) => x.id === view.tabId)
  if (t) t.blockSnapshot = collectBlockContentsSync(inst.crepe.editor)
}

/** 文档视图应用：源标签无真实用户编辑 → 预览刷新；应用后回写基线 */
async function applyDocBroadcast(
  inst: Instance,
  realPath: string,
  view: { key: string; tabId: string; lastContent: string | null },
  truth: string
): Promise<void> {
  const srcTab = state.tabs.find((t) => t.id === view.tabId && t.kind === 'editor')
  if (!srcTab) return
  // 源标签有真实用户编辑 → 不覆盖（最后保存者胜）
  if (srcTab.userEditedAt > srcTab.lastExternalSyncAt) return
  if (inst.crepe.getMarkdown() === truth) {
    updateViewContent(realPath, view.key, truth)
    return
  }
  await refreshTabToContent(inst, srcTab, truth, false)
  updateViewContent(realPath, view.key, inst.crepe.getMarkdown())
}

/** 按 blockId 定位 file_block 位置（无 pos 漂移困扰） */
function findBlockPosByBlockId(editor: import('@milkdown/kit/core').Editor, blockId: string): number | null {
  let pos: number | null = null
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.state.doc.descendants((n, p) => {
      if (n.type.name === 'file_block' && n.attrs.blockId === blockId) {
        pos = p
        return false
      }
      return true
    })
  })
  return pos
}

/** 收集标签文档中所有 file_block 的 (blockId, path, readonly, pos, folded) */
function collectBlockViews(editor: import('@milkdown/kit/core').Editor): Array<{
  blockId: string | null
  path: string
  readonly: boolean
  pos: number
  folded: boolean
}> {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const out: Array<{ blockId: string | null; path: string; readonly: boolean; pos: number; folded: boolean }> = []
    view.state.doc.descendants((n, p) => {
      if (n.type.name === 'file_block') {
        out.push({
          blockId: n.attrs.blockId as string | null,
          path: n.attrs.path as string,
          readonly: Boolean(n.attrs.readonly),
          pos: p,
          folded: Boolean(n.attrs.collapsed) || !Boolean(n.attrs.materialized),
        })
      }
      return true
    })
    return out
  })
}

/**
 * 块编辑提交（markdownUpdated 触发）：逐块 diff 保存时快照 → 编辑块提交 registry 真相 + 防抖广播。
 * 同源多块同时被编辑且内容不同 = 并发歧义 → 本次不传播（保存写回会提示，绝不静默）。
 */
async function propagateBlockEdits(tabId: string): Promise<void> {
  const inst = instances.get(tabId)
  if (!inst) return
  try {
    const editor = inst.crepe.editor
    const cfg = editor.action((ctx) => ctx.get(refConfigCtx.key))
    const tab = state.tabs.find((t) => t.id === tabId)
    if (!cfg || !tab) return
    const snap = tab.blockSnapshot
    // 按真实路径聚合本轮编辑。基线 = 该块视图的 lastContent（最近一次渲染/同步的内容）——
    // 已传播的兄弟块不会被误判为编辑源；视图未注册时兜底用保存时快照。
    const edits = new Map<string, { contents: Set<string>; keys: string[] }>()
    for (const b of collectBlockViews(editor)) {
      if (b.readonly || !b.blockId) continue
      const content = serializeBlockContent(editor, b.pos)
      if (content === '') continue
      const real = await resolveRealPath(cfg, b.path)
      if (!real) continue
      const key = `${tabId}#${b.blockId}`
      const view = getView(real, key)
      const base = view?.lastContent ?? snap?.get(b.path) ?? null
      if (base != null && content === base) continue
      const e = edits.get(real) ?? { contents: new Set<string>(), keys: [] }
      e.contents.add(content)
      e.keys.push(key)
      edits.set(real, e)
    }
    for (const [real, e] of edits) {
      if (e.contents.size > 1) {
        cfg.toast(`同源多处嵌入被并发编辑且内容不同（${real}），已暂停实时同步（保存时会提示）`, 'info')
        console.warn('[registry] 并发编辑歧义，不传播:', real, [...e.contents].map((c) => c.slice(0, 30)))
        continue
      }
      const content = [...e.contents][0]
      const originKey = e.keys[0]
      setTruth(real, content)
      updateViewContent(real, originKey, content) // 编辑块自身已是真相（origin 跳过广播）
      scheduleBroadcast(real, originKey)
    }
  } catch (err) {
    console.warn('[registry] 块编辑传播失败:', err)
  }
}

/**
 * 文档编辑提交（P3：源标签输入 → 嵌入块实时同步）：本路径被块订阅时才传播。
 * 提交真相 + 防抖广播；编辑源（doc 视图）跳过广播。
 */
function propagateDocEdit(tabId: string, md: string): void {
  const tab = state.tabs.find((t) => t.id === tabId && t.kind === 'editor')
  if (!tab) return
  const entry = getEntry(tab.path)
  if (!entry || entry.views.size === 0) return // 无订阅者（没被嵌入）
  if (![...entry.views.values()].some((v) => v.kind === 'block')) return
  setTruth(tab.path, md)
  updateViewContent(tab.path, `doc:${tabId}`, md)
  scheduleBroadcast(tab.path, `doc:${tabId}`)
}

/** 标签物化完成后：分配 blockId + 注册块/文档视图（幂等；replaceAll 重建后重新注册） */
async function syncTabViewsToRegistry(tabId: string): Promise<void> {
  const inst = instances.get(tabId)
  const tab = state.tabs.find((t) => t.id === tabId && t.kind === 'editor')
  if (!inst || !tab) return
  const editor = inst.crepe.editor
  const cfg = editor.action((ctx) => ctx.get(refConfigCtx.key))
  if (!cfg) return
  // 分配缺失的 blockId（一次事务）
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const tr = view.state.tr
    let changed = false
    view.state.doc.descendants((n, p) => {
      if (n.type.name === 'file_block' && !n.attrs.blockId) {
        tr.setNodeMarkup(p, undefined, { ...n.attrs, blockId: genBlockId() })
        changed = true
      }
      return true
    })
    if (changed) view.dispatch(tr)
  })
  // 注册块视图（内容 = 当前序列化）。折叠/未物化的块不注册——折叠卡是只读治理态，
  // 若注册会成为广播目标，循环/自嵌用例会被广播“展开/污染”折叠卡（治理回归）。
  for (const b of collectBlockViews(editor)) {
    if (!b.blockId) continue
    const foldedOrUnmaterialized = b.folded
    if (foldedOrUnmaterialized) continue
    if (b.readonly) continue // 只读变体固定快照：不注册视图（物化时已填充源快照）
    const real = await resolveRealPath(cfg, b.path)
    if (!real) continue
    const content = serializeBlockContent(editor, b.pos)
    const key = registryRegisterView(real, { tabId, kind: 'block', blockId: b.blockId, readonly: b.readonly }, content)
    updateViewContent(real, key, content)
  }
  // 注册文档视图（该标签自身 = realPath 的投影；canonical = getMarkdown round-trip）
  const canonical = inst.crepe.getMarkdown()
  registryRegisterView(tab.path, { tabId, kind: 'doc' }, canonical)
}

/** 订阅了某 realPath 的所有标签 id（保存广播后同步这些标签的块快照） */
function registryEntryTabIds(realPath: string): string[] {
  const e = getEntry(realPath)
  if (!e) return []
  const ids = new Set<string>()
  for (const v of e.views.values()) ids.add(v.tabId)
  return [...ids]
}

export async function saveTab(tabId: string): Promise<boolean> {
  const inst = instances.get(tabId)
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab) return false
  const t0 = performance.now()
  if (!inst) {
    // 容器尚未挂载（极早期）——直接写 savedContent
    tab.dirty = false
    diagEvent('save', { target: tab.path, ok: true, ms: performance.now() - t0, data: { early: true } })
    return true
  }
  // M7：源码模式保存 → 先把 textarea 最新内容解析回 doc（保持源码模式，保存后继续编辑源码）
  if (tab.viewMode === 'source') await ensureDocSynced(tabId)
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
    diag('error', 'save', `保存失败 ${tab.path}: ${(e as Error).message}`)
    diagEvent('save', { target: tab.path, ok: false, ms: performance.now() - t0, data: { error: (e as Error).message } })
    return false
  }
  inst.suppressing = true
  tab.savedContent = md
  // §6.7：保存后记录块内容快照（脏检测第二条件）
  tab.blockSnapshot = collectBlockContentsSync(inst.crepe.editor)
  tab.lastSyncBlocks = new Map(tab.blockSnapshot ?? [])
  tab.dirty = false
  tab.lastModified = Date.now()
  // 保存即“源已同步”：刷新同步基线，后续宿主写回不再被自己的旧编辑标记挡住
  //（userEditedAt 只在保存后的新用户输入时再更新 → isTabUserEdited 语义正确）
  tab.lastExternalSyncAt = Date.now()
  // 等一帧再解除抑制，避免保存后的 markdownUpdated 误判
  setTimeout(() => (inst.suppressing = false), 0)
  // 广播①：写回的源文件 → 源标签（若打开且无自身编辑）刷新为最新 + 脏灭；
  // 其他引用标签块物化刷新（P2：registry 广播——块视图按 blockId 精确填充，跳过已一致视图）
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
    registryFlushBroadcast(p, null)
  }
  // 广播②：本文档保存后，若它是某嵌入块的源文件 → registry 真相落盘 + 广播刷新各标签块 + 快照同步
  setTruth(tab.path, md)
  registryFlushBroadcast(tab.path, null)
  const refreshed = registryEntryTabIds(tab.path)
  syncBlockSnapshots(refreshed)  // 保存后：磁盘 + 各打开标签内容可能变化 → 重扫所有引用底部展示区（反向引用随之更新）
  refreshAllRefsFooters()
  // 保存可能命中模板域（.template/ 下的 md / rules / suggest 等）→ 重扫模板注册表，
  // 使模板内容/规则改动即时生效（无需重启或重开目录；注册表重建后惰性缓存同步失效）。
  // 仅模板域内文件触发，避免普通笔记每次保存都整树重扫。
  const isTemplatePath =
    tab.path === '.template' || tab.path.startsWith('.template/')
  if (isTemplatePath) void templateService.rescan()
  diagEvent('save', { target: tab.path, ok: true, ms: performance.now() - t0 })
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
  // 关闭标签时清理校验结果（订阅面板/报告不残留）+ 防抖定时器
  clearValidation(tabId)
  clearValidationTimer(tabId)
  clearAnnotations(tabId)
  setAnnotationCardContext(tabId, null)
  if (tab.dirty) {
    const ok = await confirmDiscard(tab)
    if (!ok) return
  }
  const idx = state.tabs.findIndex((t) => t.id === tabId)
  state.tabs.splice(idx, 1)
  unmountEditor(tabId)
  diagEvent('tab:close', { target: tab.path })
  if (state.activeTabId === tabId) {
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)]
    state.activeTabId = next ? next.id : null
    // M6：活动标签切到下一个 → 恢复批注卡上下文（关闭标签时被清成 null）
    if (next) {
      const nextInst = instances.get(next.id)
      if (nextInst) setAnnotationCardContext(next.id, nextInst.crepe.editor)
      // 恢复被激活标签的滚动位置（DOM 切换后）
      requestAnimationFrame(() => restoreTabScroll(next.id))
    }
  }
  syncActiveTopbar()
}

function confirmDiscard(tab: Tab): Promise<boolean> {
  // 循环依赖规避：由组件层实现确认框
  return import('../components/confirm').then((m) => m.confirmCloseTab(tab))
}

/** 关闭除指定标签外的所有标签（未保存的逐个确认；取消的跳过） */
export async function closeOtherTabs(keepTabId: string): Promise<void> {
  const others = state.tabs.filter((t) => t.id !== keepTabId)
  for (const tab of others) {
    await closeTab(tab.id)
  }
}

/** 关闭全部标签（未保存的逐个确认；取消的跳过） */
export async function closeAllTabs(): Promise<void> {
  for (const tab of [...state.tabs]) {
    await closeTab(tab.id)
  }
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
  // 记录「上次打开的目录」：桌面应用下次启动自动恢复（见 App.vue onMounted restoreRoot）
  if (fs.kind === 'tauri' && typeof fs.rootPath === 'function') {
    settings.lastDir = fs.rootPath() ?? ''
    saveSettings()
  }
  toast(`已打开目录: ${state.rootName}`, 'success')
}

export async function refreshTree() {
  try {
    state.tree = await fs.readTree(true)
    state.rootName = fs.rootName
    state.treeVersion++
  } catch (e) {
    toast(`读取目录失败: ${(e as Error).message}`, 'error')
  }
  // 模板注册表跟随文件树变化自动重扫（新建/删除/重命名 template/ 下的内容即时生效，
  // 无需刷新页面；斜杠菜单每次打开时重新执行 buildMenu，自动读到最新注册表）
  void import('../template/service').then((m) => m.templateService.rescan())
}
