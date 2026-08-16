// 多标签页编辑器管理：
// 每个打开的标签持有独立的 Crepe 实例（保留各自的撤销历史/光标/滚动位置），
// 切标签只切换容器可见性；关闭标签才销毁实例。
// 数据流：文件内容只从 getMarkdown() 出来、经 replaceAll() 进去，不旁路 DOM。
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { replaceAll } from '@milkdown/kit/utils'
// M7：inline-code 的 Mod-e 与源码模式 Ctrl+E 冲突 → 改绑 Ctrl+Shift+E
import { inlineCodeKeymap } from '@milkdown/kit/preset/commonmark'

import { TextSelection } from '@milkdown/kit/prose/state'

import { fs, useRealDirFs } from '../fs'
import { refPlugin, resolveRefs, refConfigCtx } from './ref'
import type { RefConfig } from './ref/config'
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
  refreshBrokenState,
  resolveRefPath,
} from './ref/app-plugin'
import { initRefTooltip } from './ref/ref-tooltip'
import { baseName } from '../fs/types'
import { state, nextTabId, toast, confirmDialog } from '../state/store'
import { settings } from '../state/settings'
import type { Tab, ViewMode } from '../state/store'
import { git, type DiffBase } from '../git'
import { featureConfigs } from './features'
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

interface Instance {
  crepe: Crepe
  el: HTMLDivElement
  /** 打开/保存等内部操作期间抑制脏标记误报 */
  suppressing: boolean
  /** M7：源码模式 textarea（懒创建；源码编辑不经过 ProseMirror doc） */
  srcTa: HTMLTextAreaElement | null
}

const instances = new Map<string, Instance>()

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
}

export async function toggleSourceMode(tabId: string): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab) return
  await setViewMode(tabId, tab.viewMode === 'source' ? 'wysiwyg' : 'source')
}

// ---------- M11：Git diff 视图 ----------

/** 工作区文件内容（mock 演示仓库 = mockGit worktree；否则 = fs 磁盘） */
async function readWorktreeFile(path: string): Promise<string> {
  const { isMockGit } = await import('../git')
  return isMockGit() ? git.showFile(path, 'WORKTREE') : fs.readFile(path)
}

/** 打开某文件的 Git diff（工作区 vs HEAD / commit vs 父提交 / a..b）。
 *  进入前自动保存该文件（git diff 反映磁盘状态）；保留已加载的 diff 数据（切回秒开）。 */
export async function openGitDiff(path: string, base: DiffBase): Promise<void> {
  if (!git.available) {
    toast('Git 功能仅在桌面应用中可用', 'info')
    return
  }
  // 该文件已打开且有未保存改动 → 先保存（保证磁盘 == 编辑器所见）
  const tab = state.tabs.find((t) => t.path === path)
  if (tab) {
    if (tab.dirty) {
      const ok = await saveTab(tab.id)
      if (!ok) return
    }
    activateTab(tab.id)
  } else {
    await openTab(path, await readWorktreeFile(path))
  }
  const t = state.tabs.find((x) => x.path === path)
  if (!t) return
  await waitForInstance(t.id)
  // base 相同且有数据 → 直接切视图
  if (t.diff && t.diff.base.from === base.from && t.diff.base.to === base.to && !t.diff.loading) {
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
  }
  await setViewMode(t.id, 'diff')
  try {
    const res = await git.diffFile(path, base.from, base.to)
    const cur = state.tabs.find((x) => x.id === t.id)
    if (cur && cur.diff) {
      cur.diff.hunks = res.hunks
      cur.diff.added = res.added
      cur.diff.deleted = res.deleted
      cur.diff.exists = res.exists
      cur.diff.loading = false
    }
  } catch (e) {
    toast(`加载 diff 失败: ${(e as Error).message}`, 'error')
    const cur = state.tabs.find((x) => x.id === t.id)
    if (cur && cur.diff) cur.diff.loading = false
  }
}

/** M11c：懒加载渲染模式所需的两版本内容（旧 = git show；新 = 工作区文件或 git show） */
export async function loadRenderData(tabId: string): Promise<void> {
  const t = state.tabs.find((x) => x.id === tabId)
  const d = t?.diff
  if (!d || d.renderData || d.renderLoading) return
  d.renderLoading = true
  d.renderError = null
  try {
    // 新版本：工作区 → 磁盘文件（mock 演示仓库 = mockGit worktree）；commit/范围 → git show to
    const newMd =
      d.base.from === null ? await readWorktreeFile(d.path) : await git.showFile(d.path, d.base.to)
    // 旧版本：工作区 vs HEAD → HEAD；commit vs parent → 父提交；a..b → a
    const oldRev = d.base.from ?? 'HEAD'
    const oldMd = await git.showFile(d.path, oldRev)
    const cur = state.tabs.find((x) => x.id === tabId)
    if (cur?.diff) cur.diff.renderData = { oldMd, newMd }
  } catch (e) {
    toast(`加载渲染数据失败: ${(e as Error).message}`, 'error')
    const cur = state.tabs.find((x) => x.id === tabId)
    if (cur?.diff) cur.diff.renderError = (e as Error).message
  } finally {
    const cur = state.tabs.find((x) => x.id === tabId)
    if (cur?.diff) cur.diff.renderLoading = false
  }
}

/** 渲染模式引用 chip 点击打开目标（复用正文 handleOpenRef 逻辑） */
export function buildRenderRefCfg(): import('./ref/config').RefConfig {
  return {
    fs: {
      readFile: async (p: string) => readWorktreeFile(p),
      readTree: (showAll?: boolean) => fs.readTree(Boolean(showAll)),
      writeFile: (p: string, c: string) => fs.writeFile(p, c),
    },
    toast,
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
  await openGitDiff(tab.path, { from: null, to: 'HEAD', label: '工作区 vs HEAD' })
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
    tab.lastModified = Date.now()
    // diff 数据过期：清空重新加载（base 不变时 openGitDiff 会复用 → 强制失效）
    if (tab.diff) tab.diff = null
    inst.suppressing = false
  } catch (e) {
    inst.suppressing = false
    toast(`刷新文件内容失败: ${(e as Error).message}`, 'error')
  }
}

/** 还原整文件（仅工作区 diff；危险操作带确认） */
export async function discardFileDiff(tabId: string): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  const d = tab?.diff
  if (!d || d.base.from !== null || !d.exists) return
  const ok = await confirmDialog({
    title: '还原整个文件？',
    message: `将丢弃「${d.path}」的全部未提交改动（${d.added} 增 / ${d.deleted} 删），恢复到 HEAD 版本。\n\n此操作不可撤销。`,
    confirmText: '还原文件',
    danger: true,
  })
  if (!ok) return
  try {
    await git.discardFile(d.path)
    // 该文件的打开标签同步为磁盘内容；diff 视图关闭（内容已变）
    if (state.tabs.find((t) => t.path === d.path)) {
      await reloadTabFromDisk(tab.id)
      // 退出 diff 视图（内容已刷新，回到编辑器）
      await setViewMode(tab.id, 'wysiwyg')
    }
    refreshGitPanel()
    toast('已还原到 HEAD 版本', 'success')
  } catch (e) {
    toast(`还原失败: ${(e as Error).message}`, 'error')
  }
}

/** 还原单个 hunk（仅工作区 diff） */
export async function discardHunkDiff(tabId: string, hunkIdx: number): Promise<void> {
  const tab = state.tabs.find((t) => t.id === tabId)
  const d = tab?.diff
  if (!d || d.base.from !== null) return
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
      await setViewMode(tab.id, 'wysiwyg')
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
  // M7：源码模式下先用 textarea 最新内容同步 doc，再校验（保证校验结果对应源码）
  if (state.activeTabId) await ensureDocSynced(state.activeTabId)
  const res = await validateEditor(inst.crepe.editor, state.activeTabId!, { silent: true })
  const n = res.violations.length
  if (n === 0) toast('校验通过：未发现违规', 'success')
  else toast(`校验完成：${n} 项违规（${res.violations.filter((v) => v.level === 'error').length} 错误）`, 'error')
}

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

// M15：搜索结果点击 → 打开文件并滚动到匹配处
// 参数为文件路径（与搜索结果一致）；内部确保标签打开/激活后再定位。
// 定位策略：先在 ProseMirror doc 的文本节点中找「匹配行文本」，找不到再退化找关键词本身。
// （原始文件偏移与渲染后 doc 偏移不一致，行文本/关键词定位最稳）
export async function scrollToSearchMatch(
  path: string,
  lineText: string,
  needle: string
): Promise<void> {
  // 未打开则打开（已打开则激活）
  if (!state.tabs.find((t) => t.path === path)) await openTab(path)
  const tab = state.tabs.find((t) => t.path === path)
  if (!tab || tab.viewMode === 'diff') return
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
  if (!inst) return
  try {
    const pos = await inst.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let found = -1
      const lineNorm = lineText.trim()
      const needleNorm = needle.trim().toLowerCase()
      view.state.doc.descendants((node, pos) => {
        if (found >= 0 || !node.isText) return true
        const text = node.text ?? ''
        // ① 整行文本包含 → 最精确
        let idx = lineNorm && text.includes(lineNorm) ? text.indexOf(lineNorm) : -1
        // ② 退化：行内关键词（忽略大小写）
        if (idx < 0 && needleNorm) {
          idx = text.toLowerCase().indexOf(needleNorm)
        }
        if (idx >= 0) {
          found = pos + idx
          return false
        }
        return true
      })
      return found
    })
    if (pos >= 0) await scrollToPos(tab.id, pos)
  } catch {
    /* 编辑器已销毁 */
  }
}

// ---------- 打开 / 激活 ----------

export async function openTab(path: string, contentOverride?: string): Promise<void> {
  // 已在标签中 → 直接激活
  const existing = state.tabs.find((t) => t.path === path)
  if (existing) {
    activateTab(existing.id)
    return
  }

  let content: string
  try {
    content = contentOverride ?? (await fs.readFile(path))
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
    viewMode: 'wysiwyg',
    diff: null,
  }
  state.tabs.push(tab)
  state.activeTabId = tab.id
  // 容器由 EditorPane.vue 在 mount 时创建并调用 mountEditor
  // 打开文件不自动收纳侧边栏（便于在文件树连续打开多个文件）
}

export function activateTab(id: string) {
  state.activeTabId = id
  // M6：批注卡上下文跟随活动标签（切标签后 Ctrl+R/批注卡作用于当前编辑器）
  const inst0 = instances.get(id)
  if (inst0) setAnnotationCardContext(id, inst0.crepe.editor)
  // 等 DOM 切换完成后把焦点还给编辑器（M7：源码模式 → 焦点给 textarea）
  requestAnimationFrame(() => {
    const inst = instances.get(id)
    const tab = state.tabs.find((t) => t.id === id)
    if (inst && tab?.viewMode === 'source') {
      inst.srcTa?.focus()
      return
    }
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
  })
  crepe.editor.use(refPlugin)
  // M6：批注插件（<mark data-note> 节点 + 运行时批注 decorations，tabId 经 ctx 注入）
  crepe.editor.use(annotationPlugin)
  // P1：校验插件（编辑防抖监听 + validate 命令；引擎 validateEditor 由 config 注入）
  crepe.editor.use(validatePlugin)
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

  const inst: Instance = { crepe, el: container, suppressing: false, srcTa: null }
  instances.set(tabId, inst)
  // M14：编辑器挂载完成 → 通知批注抽屉刷新（切标签后避免残留上一个标签的批注）
  notifyEditorMounted(tabId)
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
  if (state.activeTabId === tabId) {
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)]
    state.activeTabId = next ? next.id : null
    // M6：活动标签切到下一个 → 恢复批注卡上下文（关闭标签时被清成 null）
    if (next) {
      const nextInst = instances.get(next.id)
      if (nextInst) setAnnotationCardContext(next.id, nextInst.crepe.editor)
    }
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
