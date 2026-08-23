<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, nextTick, ref } from 'vue'
import { state, toast } from './state/store'
import { settings, applyTheme, saveSettings, SHORTCUT_DEFS, comboMatches } from './state/settings'
import { fs } from './fs'
import { isEditableFile, type FsEntry } from './fs/types'
import { git, isGitAvailable } from './git'
import { applyGitMark, clearGitMark } from './git/mark'
import GitPanel from './components/GitPanel.vue'
import SearchPanel from './components/SearchPanel.vue'
import TabContextMenu from './components/TabContextMenu.vue'
import MenuIcon, { type MenuIconSet } from './components/MenuIcon.vue'
import GradientDefs from './components/GradientDefs.vue'
import {
  openDirectory,
  refreshTree,
  saveActiveTab,
  ensureAutoSaveLoop,
  openTab,
  activateTab,
  closeTab,
  toggleSourceMode,
  openActiveGitDiff,
} from './editor/manager'
import {
  startNewFile,
  startNewDir,
  commitEditing,
  cancelEditing,
  dragState,
  dragOver,
  moveNode,
  endDrag,
  revealInTree,
} from './state/treeOps'
import FileTree from './components/FileTree.vue'
import NewInput from './components/NewInput.vue'
import TabBar from './components/TabBar.vue'
import EditorPane from './components/EditorPane.vue'
import AnnotationDrawer from './components/AnnotationDrawer.vue'
import OutlinePanel from './components/OutlinePanel.vue'
import SettingsModal from './components/SettingsModal.vue'
import ExportModal from './components/ExportModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import ClipboardAuthModal from './components/ClipboardAuthModal.vue'
import ContextMenu from './components/ContextMenu.vue'
import RefEditorMenu from './components/RefEditorMenu.vue'
import TemplatePicker from './components/TemplatePicker.vue'
// 诊断（D1/D2）：入口 + 弹窗 + 异常红点轮询
import { openReportModal } from './diagnostics'
import { hasUnviewedError } from './diagnostics/logger'
import ReportModal from './diagnostics/ReportModal.vue'

const wsTopbarEl = ref<HTMLElement | null>(null)

// 状态栏 🩺 异常红点（logger 的置位非响应式 → 轻量轮询刷新）
const diagBadge = ref(false)
setInterval(() => (diagBadge.value = hasUnviewedError()), 500)

// 无系统标题栏（decorations:false）→ 是否需要自绘标题条
const isTauri = fs.kind === 'tauri'

// ---------- 启动恢复工作目录（桌面应用） ----------
// 优先恢复「上次打开的目录」，无记录或目录已失效则回退到 app 可执行文件所在目录
async function restoreRoot() {
  if (typeof fs.setRootFromPath !== 'function') return
  let ok = false
  const last = settings.lastDir
  if (last) ok = await fs.setRootFromPath(last)
  if (!ok) {
    const appDir = typeof fs.appDir === 'function' ? await fs.appDir() : null
    if (appDir) ok = await fs.setRootFromPath(appDir)
  }
  if (ok && typeof fs.rootPath === 'function') {
    settings.lastDir = fs.rootPath() ?? ''
    saveSettings()
  }
}

// ---------- 自绘窗口控制（最小化/最大化/关闭） ----------
async function winMinimize() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().minimize()
}
async function winToggleMaximize() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const w = getCurrentWindow()
  if (await w.isMaximized()) await w.unmaximize()
  else await w.maximize()
}
async function winClose() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().close()
}

// ---------- 生命周期 ----------
onMounted(async () => {
  applyTheme(settings.theme)
  state.fsName = fs.kind
  // 桌面应用：启动即恢复上次打开目录（无则用 app 所在目录）
  if (fs.kind === 'tauri') await restoreRoot()
  await refreshTree()
  // 顶部栏槽位：Crepe topbar 由 manager 移入此槽（横贯整行）
  void import('./editor/manager').then((m) => { if (wsTopbarEl.value) m.bindTopbarSlot(wsTopbarEl.value) })
  // M4：启动即扫描模板注册表（斜杠菜单「模板」组 / 基于模板新建依赖）
  void import('./template/service').then((m) => m.templateService.ready())
  // 性能：后台预热 esbuild-wasm（模板 TS 转译），避免首次 suggest 加载卡顿
  void import('./template/ts-loader').then((m) => m.warmupTsLoader())
  ensureAutoSaveLoop()
  // M15：启动即拉取工作区 git 状态 → 主文件树角标（失败静默：非 git 仓库忽略）
  if (isGitAvailable()) {
    git.status()
      .then((s) => applyGitMark(s))
      .catch(() => clearGitMark())
  }
  window.addEventListener('keydown', onKeydown)
  // 点击按钮后 blur，避免空格/回车再次激活按钮（编辑器里按空格是输入）
  document.addEventListener('click', onDocClick)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', onDocClick)
})

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  const btn = target?.closest?.('button')
  // 编辑器内部的按钮（Crepe 顶栏/工具条）交给编辑器自己管理
  if (btn && !target.closest('.milkdown')) {
    btn.blur()
  }
}

// ---------- 快捷键 ----------
const shortcutActions: Record<string, () => void> = {
  save: () => void saveActiveTab(),
  openDirectory: () => void openDirectory(),
  newFile: () => startNewFile(''),
  closeTab: () => {
    if (state.activeTabId) void closeTab(state.activeTabId)
  },
  nextTab: () => cycleTab(1),
  prevTab: () => cycleTab(-1),
  prevFile: () => void gotoFile(-1),
  nextFile: () => void gotoFile(1),
  toggleSidebar: () => toggleSidebar(),
  toggleSource: () => {
    if (state.activeTabId) void toggleSourceMode(state.activeTabId)
  },
  gitDiff: () => {
    void openActiveGitDiff()
  },
  search: () => toggleSearch(),
  settings: () => {
    state.settingsOpen = !state.settingsOpen
  },
}

// ---------- 设置 / 快捷键入口 ----------
/** 设置弹窗初始页签：⚙️ 进「常规」，⌨️ 进「快捷键」 */
const settingsTab = ref<'general' | 'shortcuts'>('general')

function openSettings(tab: 'general' | 'shortcuts') {
  settingsTab.value = tab
  state.settingsOpen = true
}

function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  // M7：源码模式 textarea 聚焦时全局快捷键放行（Ctrl+E 切换 / Ctrl+S 保存等）
  const isSourceTa = !!target?.hasAttribute?.('data-source-ta')
  if (!isSourceTa) {
    // 输入框/下拉框聚焦时不触发全局快捷键
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  }
  for (const def of SHORTCUT_DEFS) {
    const combo = settings.shortcuts[def.id]
    if (combo && comboMatches(e, combo)) {
      e.preventDefault()
      shortcutActions[def.id]?.()
      return
    }
  }
}

function cycleTab(delta: number) {
  if (!state.tabs.length) return
  const idx = state.tabs.findIndex((t) => t.id === state.activeTabId)
  const next = state.tabs[(idx + delta + state.tabs.length) % state.tabs.length]
  activateTab(next.id)
}

// 抽屉独立：文件树 / Git / 搜索 三个图标各自独立——点文件进文件抽屉（已显示则再点收起）
function onFilesIcon() {
  if (state.gitPanel.tab === 'files' && !state.sidebarCollapsed) {
    state.sidebarCollapsed = true
    return
  }
  if (state.sidebarCollapsed) state.sidebarCollapsed = false
  state.gitPanel.tab = 'files'
}

function onGitIcon() {
  if (!isGitAvailable()) {
    toast('Git 功能仅在桌面应用中可用（当前为浏览器演示模式）', 'info')
    return
  }
  // 抽屉独立：点 Git 进 Git 抽屉（已显示则再点收起）
  if (state.gitPanel.tab === 'git' && !state.sidebarCollapsed) {
    state.sidebarCollapsed = true
    return
  }
  if (state.sidebarCollapsed) state.sidebarCollapsed = false
  state.gitPanel.tab = 'git'
}

// M15：全局搜索 —— 抽屉独立：点搜索进搜索抽屉（已显示则再点收起）
function onSearchIcon() {
  if (state.gitPanel.tab === 'search' && !state.sidebarCollapsed) {
    state.sidebarCollapsed = true
    return
  }
  if (state.sidebarCollapsed) state.sidebarCollapsed = false
  state.gitPanel.tab = 'search'
}
function toggleSearch() {
  onSearchIcon()
}

// M11d：标签右键菜单动作
function onTabMenuAction(action: string, tabId: string) {
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab) return
  if (action === 'gitDiff') {
    void import('./editor/manager').then((m) =>
      m.openGitDiff(tab.path, { kind: 'worktree', label: '工作区 vs HEAD' })
    )
  } else if (action === 'revealInExplorer') {
    revealPathInExplorer(tab.path)
  } else if (action === 'closeOthers') {
    void import('./editor/manager').then((m) => m.closeOtherTabs(tabId))
  } else if (action === 'closeAll') {
    void import('./editor/manager').then((m) => m.closeAllTabs())
  } else if (action === 'close') {
    void import('./editor/manager').then((m) => m.closeTab(tabId))
  }
}

// ---------- 侧边栏 ----------
function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed
}
function togglePin() {
  settings.sidebarPinned = !settings.sidebarPinned
  if (settings.sidebarPinned) state.sidebarCollapsed = false
  saveSettings()
}

/** 未固定时，点击编辑区自动收纳侧边栏（sidebar 与 workspace 是兄弟节点，点击不会冒泡过来） */
function onWorkspaceClick() {
  if (!settings.sidebarPinned && !state.sidebarCollapsed) {
    state.sidebarCollapsed = true
  }
}

// 拖拽调整内容列宽度
function startResize(e: MouseEvent) {
  e.preventDefault()
  const startX = e.clientX
  const startW = settings.sidebarWidth
  const move = (ev: MouseEvent) => {
    settings.sidebarWidth = Math.min(420, Math.max(160, startW + (ev.clientX - startX)))
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    saveSettings()
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// ---------- 上下文菜单动作 ----------
async function onMenuAction(action: string, path: string, kind: 'file' | 'dir') {
  const { removeNode, startRename, startNewFile: snf, startNewDir: snd } =
    await import('./state/treeOps')
  switch (action) {
    case 'open':
      if (kind === 'file' && isEditableFile(path)) await openTab(path)
      break
    case 'gitDiff':
      if (kind === 'file' && isEditableFile(path)) {
        if (!isGitAvailable()) {
          toast('Git 功能仅在桌面应用中可用', 'info')
        } else {
          await import('./editor/manager').then((m) =>
            m.openGitDiff(path, { kind: 'worktree', label: '工作区 vs HEAD' })
          )
        }
      }
      break
    case 'newFile':
      snf(path)
      break
    case 'newFromTemplate':
      // 打开模板选择器（TemplatePicker.vue 监听 templatePick）
      state.templatePick = path
      break
    case 'newDir':
      snd(path)
      break
    case 'rename':
      startRename(path)
      break
    case 'delete':
      await removeNode(path, kind)
      break
    case 'copy':
      // 复制文件/目录：编辑器 Ctrl+V 粘贴为引用（目录粘贴路径文本）
      await import('./editor/ref/clipboard-core').then((m) => m.copyNodesToClipboard([{ kind, path }]))
      toast(`已复制：${path}`)
      break
    case 'revealInExplorer':
      revealPathInExplorer(path)
      break
  }
}

// ---------- 在系统文件管理器中显示（文件树 / 标签页右键菜单） ----------
function revealPathInExplorer(path: string) {
  if (fs.kind !== 'tauri') {
    toast('该功能仅在桌面应用中可用', 'info')
    return
  }
  fs.revealInExplorer(path).catch((e: unknown) => {
    toast((e as Error)?.message || '打开文件管理器失败', 'error')
  })
}

// ---------- 基于模板新建（TemplatePicker 回调） ----------
function onTemplatePicked(doctype: string) {
  const dir = state.templatePick
  state.templatePick = null
  if (dir === null) return
  void import('./state/treeOps').then((m) => m.startNewFileWithTemplate(dir, doctype))
}

function onTemplatePickClose() {
  state.templatePick = null
}

// ---------- 上一个 / 下一个文件 ----------
function flatFiles(list: FsEntry[], acc: string[] = []): string[] {
  for (const e of list) {
    if (e.kind === 'file' && isEditableFile(e.name)) acc.push(e.path)
    else if (e.kind === 'dir' && e.children) flatFiles(e.children, acc)
  }
  return acc
}

async function gotoFile(delta: number) {
  const files = flatFiles(state.tree)
  if (!files.length) return
  const activePath = state.tabs.find((t) => t.id === state.activeTabId)?.path
  const idx = activePath ? files.indexOf(activePath) : -1
  const next = files[(idx + delta + files.length) % files.length]
  await openTab(next)
}

// ---------- 瞄准定位（M7-Reveal）：在文件树中展示当前激活标签的文件 ----------
function revealActiveFile() {
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  if (!tab) {
    toast('当前没有打开的文件', 'info')
    return
  }
  revealInTree(tab.path)
}

// revealPath 变化 → 展开已完成，滚动到可视区并高亮
watch(
  () => state.revealPath,
  async (path) => {
    if (!path) return
    const scrollToRevealed = () => {
      const el = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
      if (!el) return false
      const container = el.closest('.tree')
      if (!container) return false
      const elRect = el.getBoundingClientRect()
      const cRect = container.getBoundingClientRect()
      const target = container.scrollTop + (elRect.top - cRect.top) - container.clientHeight * 0.2
      container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
      return true
    }
    await nextTick()
    // 目录展开渲染可能晚一拍：一次没找到则稍后重试
    if (!scrollToRevealed()) setTimeout(scrollToRevealed, 120)
  }
)

// ---------- 拖拽到树根空白区 = 移动到根目录（M7） ----------
function onTreeRootDragOver(e: DragEvent) {
  if (!dragState.active) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  // 根 = 虚拟目录（''），移入根 = 去掉祖先前缀
  dragOver('', 'dir', 'into')
}

function onTreeRootDrop(e: DragEvent) {
  if (!dragState.active) return
  e.preventDefault()
  void moveNode().finally(() => endDrag())
}
</script>

<template>
  <div class="app">
    <!-- 自绘标题条（无系统标题栏时的拖拽区 + 窗口控制） -->
    <header v-if="isTauri" class="app-titlebar" data-tauri-drag-region>
      <span class="tb-title" data-tauri-drag-region>WriteIt</span>
      <div class="tb-controls">
        <button class="tb-btn" title="最小化" @click="winMinimize"><span class="g">─</span></button>
        <button class="tb-btn" title="最大化" @click="winToggleMaximize"><span class="g">▢</span></button>
        <button class="tb-btn tb-close" title="关闭" @click="winClose"><span class="g">✕</span></button>
      </div>
    </header>
    <!-- 多彩渐变套的全局渐变定义（一次性） -->
    <GradientDefs />
    <!-- 主体：侧边栏 + 主区域 -->
    <div class="body">
      <div class="sidebar">
        <div class="icon-col">
        <button
          class="icon-btn"
          :class="{ active: state.gitPanel.tab === 'files' && !state.sidebarCollapsed }"
          :title="`文件目录（${settings.shortcuts.toggleSidebar || 'Ctrl+B'}）`"
          @click="onFilesIcon"
        >
          <MenuIcon name="files" :set="settings.iconSet" />
        </button>
        <button
          class="icon-btn"
          :class="{ active: state.gitPanel.tab === 'git' && !state.sidebarCollapsed }"
          :title="`Git（分支/工作区/历史）`"
          :style="{ opacity: isGitAvailable() ? undefined : 0.35 }"
          @click="onGitIcon"
        >
          <MenuIcon name="git" :set="settings.iconSet" />
        </button>
        <button
          class="icon-btn"
          :class="{ active: state.gitPanel.tab === 'search' && !state.sidebarCollapsed }"
          :title="`全局搜索（${settings.shortcuts.search || 'Ctrl+Shift+F'}）`"
          @click="onSearchIcon"
        >
          <MenuIcon name="search" :set="settings.iconSet" />
        </button>
        <button
          class="icon-btn"
          :title="`设置（${settings.shortcuts.settings || 'Ctrl+,'}）`"
          @click="openSettings('general')"
        >
          <MenuIcon name="settings" :set="settings.iconSet" />
        </button>
        <button
          class="icon-btn"
          title="快捷键设置"
          @click="openSettings('shortcuts')"
        >
          <MenuIcon name="shortcuts" :set="settings.iconSet" />
        </button>
        <button
          class="icon-btn"
          title="导出当前文档（PDF / DOCX / Markdown）"
          @click="state.exportOpen = true"
        >
          <MenuIcon name="export" :set="settings.iconSet" />
        </button>
        <button
          class="icon-btn"
          :title="`问题诊断（生成诊断包给开发者）${diagBadge ? ' · 有异常记录' : ''}`"
          @click="openReportModal"
        >
          <MenuIcon name="diagnostics" :set="settings.iconSet" />
          <i v-if="diagBadge" class="diag-dot"></i>
        </button>
      </div>

      <div
        class="content-col"
        :class="{ collapsed: state.sidebarCollapsed }"
        :style="{ width: settings.sidebarWidth + 'px' }"
      >
        <div class="sidebar-head">
          <span class="app-logo" title="WriteIt">W</span>
          <span class="root-name" :title="state.rootName">{{ state.rootName }}</span>
          <button
            class="mini pin"
            :class="{ active: settings.sidebarPinned }"
            :aria-pressed="settings.sidebarPinned"
            :title="settings.sidebarPinned ? '已固定（点击编辑区不自动收纳）· 点击取消固定' : '固定侧边栏（点击编辑区时不自动收纳）'"
            @click="togglePin"
          >
            <MenuIcon name="pin" :set="settings.iconSet" :size="14" />
          </button>
        </div>
        <div v-if="state.gitPanel.tab === 'files'" class="sidebar-actions">
          <button
            class="mini wide"
            title="在文件树中定位当前文件（展开目录 + 高亮）"
            @click="revealActiveFile"
          >
            <MenuIcon name="locate" :set="settings.iconSet" :size="14" />
            <span>定位</span>
          </button>
          <button class="mini" title="新建文件" @click="startNewFile('')">
            <MenuIcon name="fileNew" :set="settings.iconSet" :size="14" />
            <span>文件</span>
          </button>
          <button class="mini" title="新建文件夹" @click="startNewDir('')">
            <MenuIcon name="dirNew" :set="settings.iconSet" :size="14" />
            <span>目录</span>
          </button>
          <button class="mini" title="刷新" @click="refreshTree">
            <MenuIcon name="refresh" :set="settings.iconSet" :size="14" />
          </button>
        </div>
        <div v-show="state.gitPanel.tab === 'files'" class="tree" @dragover="onTreeRootDragOver" @drop="onTreeRootDrop">
          <FileTree
            v-for="node in state.tree"
            :key="node.path"
            :node="node"
            :depth="0"
          />
          <!-- 根目录新建文件/文件夹输入框 -->
          <div
            v-if="state.editing?.mode === 'new' && state.editing.path === ''"
            class="tree-new-root"
          >
            <span class="icon">
              <MenuIcon :name="state.editing.kind === 'dir' ? 'folder' : 'file'" :set="settings.iconSet" :size="14" />
            </span>
            <NewInput
              :placeholder="state.editing.kind === 'file' ? '新文件.md' : '新文件夹'"
              @commit="commitEditing"
              @cancel="cancelEditing"
            />
          </div>
          <p v-if="!state.tree.length" class="empty">空目录</p>
        </div>
        <GitPanel v-show="state.gitPanel.tab === 'git'" />
        <SearchPanel v-show="state.gitPanel.tab === 'search'" />
      </div>

      <div class="resizer" title="拖拽调整宽度" @mousedown="startResize"></div>
      </div>

      <!-- 主区域：标签栏 + 工作区（顶部栏横贯整行；大纲与正文/批注位于其下） -->
      <main class="main">
        <TabBar />
        <div class="workspace">
          <!-- 顶部栏槽位：Crepe 当前活动标签的 topbar 被移入此处横贯整行；
               大纲收纳按钮由 manager 以原生 .top-bar-item 注入 topbar 内部 -->
          <div class="ws-topbar" ref="wsTopbarEl"></div>
          <div class="ws-body" @click="onWorkspaceClick">
            <OutlinePanel />
            <div class="editor-area">
              <EditorPane
                v-for="tab in state.tabs"
                :key="tab.id"
                :tab-id="tab.id"
                :visible="tab.id === state.activeTabId"
              />
              <div v-if="!state.tabs.length" class="welcome">
                <h2>WriteIt</h2>
                <p>从左侧文件树打开一个文件，或新建文件开始编辑。</p>
                <p class="hint">
                  快捷键：Ctrl+S 保存 · Ctrl+O 打开目录 · Ctrl+B 收纳侧边栏 · 更多在设置中查看
                </p>
              </div>
            </div>
            <AnnotationDrawer />
          </div>
        </div>
      </main>
    </div>

    <!-- 状态栏 -->
    <footer class="statusbar">
      <span>{{ state.tabs.length }} 个标签</span>
      <span v-if="state.activeTabId" class="active-file">
        {{ state.tabs.find((t) => t.id === state.activeTabId)?.path }}
        <template v-if="state.tabs.find((t) => t.id === state.activeTabId)?.dirty">
          ● 未保存
        </template>
      </span>
      <span class="spacer"></span>
      <button
        class="diag-entry"
        :class="{ dot: diagBadge }"
        :title="`问题诊断：生成诊断包${diagBadge ? '（有异常记录）' : ''}`"
        @click="openReportModal"
      >
        🩺 诊断
      </button>
      <span v-if="state.gitPanel.repo?.isRepo" class="git-badge" :title="state.gitPanel.repo.headHash ?? ''">
        ⓘ {{ state.gitPanel.repo.branch ?? '(detached)' }}
      </span>
      <span v-if="state.tabs.find((t) => t.id === state.activeTabId)?.viewMode === 'source'" class="mode-badge">
        源码模式
      </span>
      <span>
        {{ settings.autoSave ? `自动保存 ${settings.autoSaveDelay / 1000}s` : '手动保存' }}
      </span>
      <span class="backend">{{ state.fsName }} · {{ state.rootName }}</span>
    </footer>

    <!-- 浮层 -->
    <SettingsModal v-if="state.settingsOpen" :initial-tab="settingsTab" @close="state.settingsOpen = false" />
    <ExportModal v-if="state.exportOpen" @close="state.exportOpen = false" />
    <ReportModal v-if="state.diagOpen" @close="state.diagOpen = false" />
    <ConfirmDialog />
    <ClipboardAuthModal />
    <ContextMenu @action="onMenuAction" />
    <RefEditorMenu />
    <TabContextMenu @action="onTabMenuAction" />
    <TemplatePicker
      v-if="state.templatePick !== null"
      @pick="onTemplatePicked"
      @close="onTemplatePickClose"
    />
    <Teleport to="body">
      <div class="toasts">
        <div v-for="t in state.toasts" :key="t.id" class="toast" :class="t.type">
          {{ t.text }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--chrome-background);
  color: var(--chrome-on-background);
}

/* ===== 自绘标题条（无系统标题栏装饰） ===== */
.app-titlebar {
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--chrome-background);
  border-bottom: 1px solid var(--chrome-border-light);
  user-select: none;
  -webkit-user-select: none;
}
.tb-title {
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--chrome-on-surface-variant);
  padding-left: 10px;
}
.tb-controls {
  display: flex;
  height: 100%;
}
.tb-btn {
  width: 44px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  cursor: default;
  -webkit-app-region: no-drag;
}
.tb-btn:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
.tb-btn.tb-close:hover {
  background: #e81123;
  color: #fff;
}
.g {
  pointer-events: none;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

/* ===== 主体（侧边栏 + 主区域） ===== */
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* ===== 侧边栏 ===== */
.sidebar {
  display: flex;
  flex-shrink: 0;
  border-right: 1px solid var(--chrome-border);
  background: var(--chrome-surface);
}

/* 图标列 */
.icon-col {
  width: 46px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding-top: 8px;
  border-right: 1px solid var(--chrome-border);
}
.icon-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--chrome-on-surface-variant);
  transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
  position: relative;
}
/* 诊断：未查看异常红点 */
.diag-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e53935;
  border: 1.5px solid var(--chrome-surface);
  animation: diag-dot-blink 1.6s ease-in-out infinite;
}
@keyframes diag-dot-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.icon-btn:hover {
  background: var(--chrome-hover);
  color: var(--chrome-primary);
}
.icon-btn.active {
  background: var(--chrome-selected);
  color: var(--chrome-primary);
}

/* 内容列 */
.content-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  transition: width 0.18s ease;
}
.content-col.collapsed {
  width: 0 !important;
  border-right: none;
}
.sidebar-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--chrome-border);
  flex-shrink: 0;
}
.app-logo {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  background: linear-gradient(135deg, #ffc454, #ff913c);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
  user-select: none;
}
.root-name {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--chrome-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mini {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.mini .mi {
  flex-shrink: 0;
}
.mini:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
.mini.pin {
  /* 未固定态：灰化 + 斜置（emoji 不受 color 控制，用 filter + transform 表达状态） */
  filter: grayscale(1) opacity(0.55);
  transform: rotate(45deg) scale(0.92);
  transition: filter 0.15s ease, transform 0.15s ease, background 0.15s ease;
  padding: 2px 4px;
  line-height: 1;
}
.mini.pin:hover {
  filter: grayscale(0.5) opacity(0.85);
  transform: rotate(45deg) scale(1);
}
.mini.pin.active {
  color: var(--chrome-primary);
  background: var(--chrome-selected);
  filter: none;
  transform: none;
}
.mini.pin.active:hover {
  background: var(--chrome-hover);
}
.sidebar-actions {
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--chrome-border);
  flex-shrink: 0;
  align-items: center;
}
.mini.wide {
  flex: 1;
  text-align: left;
  padding: 4px 8px;
  border: 1px solid var(--chrome-border);
  border-radius: 6px;
  justify-content: flex-start;
}
.mini.wide:hover {
  border-color: var(--chrome-primary);
  background: var(--chrome-background);
  color: var(--chrome-on-background);
}
.tree {
  flex: 1;
  overflow: auto;
  padding: 6px 6px 12px;
}
.tree-new-root {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
}
.tree-new-root .icon {
  font-size: 13px;
  width: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--chrome-on-surface-variant);
}
.empty {
  padding: 16px;
  font-size: 12px;
  color: var(--chrome-on-surface-variant);
}

/* 宽度拖拽手柄 */
.resizer {
  width: 4px;
  margin-left: -2px;
  cursor: col-resize;
  flex-shrink: 0;
  position: relative;
  z-index: 5;
}
.resizer:hover,
.resizer:active {
  background: var(--chrome-primary);
  opacity: 0.4;
}

/* ===== 主区域 ===== */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
/* 工作区：顶部栏横贯整行；大纲/编辑器/批注栏位于其下（同层 flex，互不覆盖） */
.workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.ws-topbar {
  flex: none;
  display: flex;
  align-items: stretch;
  background: var(--chrome-background);
  border-bottom: 1px solid var(--chrome-border-light);
  min-height: 0;
  /* 独立层级：让其内下拉等浮层浮于正文之上（不裁剪、不被正文遮盖） */
  position: relative;
  z-index: 30;
  /* 移入的 Crepe topbar 归位样式（其自身主题背景/边框会被覆盖） */
  :deep(.milkdown-top-bar) {
    position: static;
    flex: 1;
    border: none;
    box-shadow: none;
    background: var(--chrome-background);
    height: auto;
  }
}
.ws-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.editor-area {
  flex: 1;
  min-width: 0;
  display: flex;
  min-height: 0;
  overflow: hidden;
}
.welcome {
  margin: auto;
  text-align: center;
  color: var(--chrome-on-surface-variant);
}
.welcome h2 {
  font-size: 22px;
  color: var(--chrome-on-background);
  margin-bottom: 8px;
}
.welcome p {
  font-size: 13px;
  margin: 4px 0;
}
.welcome .hint {
  font-size: 12px;
  opacity: 0.8;
}

/* ===== 状态栏 ===== */
.statusbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 5px 14px;
  font-size: 12px;
  color: var(--chrome-on-surface-variant);
  border-top: 1px solid var(--chrome-border);
  background: var(--chrome-surface);
  flex-shrink: 0;
}
/* 诊断入口（状态栏）：异常红点 */
.diag-entry {
  border: 1px solid var(--chrome-outline);
  background: transparent;
  color: inherit;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 10px;
  cursor: pointer;
  position: relative;
  transition: background 0.15s;
}
.diag-entry:hover { background: var(--chrome-hover); }
.diag-entry.dot::before {
  content: '';
  position: absolute;
  top: -3px;
  right: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e53935;
  animation: diag-dot-blink 1.6s ease-in-out infinite;
}
.active-file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 50%;
}
.spacer {
  flex: 1;
}
.mode-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--chrome-selected);
  color: var(--chrome-primary);
}
.git-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--chrome-selected);
  color: var(--chrome-primary);
  font-family: ui-monospace, Consolas, monospace;
  cursor: default;
}
.backend {
  flex-shrink: 0;
}

/* ===== Toast ===== */
.toasts {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 200;
  align-items: center;
}
.toast {
  background: var(--chrome-inverse, var(--chrome-on-background));
  color: var(--chrome-on-inverse, var(--chrome-background));
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 13px;
  box-shadow: var(--chrome-shadow-1, 0 6px 20px rgba(0, 0, 0, 0.2));
  animation: rise 0.18s ease;
}
.toast.error {
  background: var(--chrome-error, #ba1a1a);
  color: var(--chrome-on-secondary, #fff);
}
.toast.success {
  background: #2e7d32;
  color: #fff;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

<style>
/* ===== 搜索结果高亮（编辑器内，非 scoped：编辑器 DOM 不在组件模板内） =====
/* 橙红色系固定变量：不依赖主题 primary，深浅主题下都一致（不要太浓艳） */
:root {
  --search-hit-bg: rgba(232, 118, 42, 0.26);
  --search-hit-fg: #b45309;
  --search-hit-current-bg: rgba(233, 88, 20, 0.58);
  --search-hit-current-fg: #fff;
}
/* 同文件所有匹配词：淡橙底 + 深橙字 */
.milkdown .search-hit-highlight {
  background: var(--search-hit-bg);
  color: var(--search-hit-fg);
  font-weight: 600;
  border-radius: 3px;
  padding: 0 1px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--search-hit-fg) 30%, transparent);
  transition: background 0.15s ease;
}
/* 当前选中的命中：饱和橙红底 + 白字 + 微弱呼吸闪烁 */
.milkdown .search-hit-current {
  background: var(--search-hit-current-bg);
  color: var(--search-hit-current-fg);
  font-weight: 700;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--search-hit-current-bg) 90%, transparent);
  animation: search-hit-pulse 1.8s ease-in-out infinite;
}
@keyframes search-hit-pulse {
  0%, 100% {
    box-shadow: 0 0 0 1px rgba(233, 88, 20, 0.45), 0 0 2px rgba(233, 88, 20, 0.35);
  }
  50% {
    box-shadow: 0 0 0 2px rgba(233, 88, 20, 0.75), 0 0 8px rgba(233, 88, 20, 0.55);
  }
}
/* 原子节点（嵌入卡片）内命中：整卡淡橙高亮 + 左侧强调条 */
.milkdown .search-hit-highlight-node {
  background: var(--search-hit-bg);
  border-radius: 8px;
  box-shadow: inset 3px 0 0 rgba(233, 88, 20, 0.7);
  outline: 1px solid color-mix(in srgb, var(--search-hit-fg) 35%, transparent);
  outline-offset: 2px;
}
/* 原子/代码块命中：块前徽标提示 */
.milkdown .search-hit-widget {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  color: #fff;
  background: #e0582c;
  border-radius: 999px;
  padding: 0 7px;
  margin-right: 5px;
  vertical-align: middle;
  box-shadow: 0 1px 4px rgba(224, 88, 44, 0.5);
  animation: search-hit-pulse 1.8s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .milkdown .search-hit-highlight,
  .milkdown .search-hit-current,
  .milkdown .search-hit-widget {
    animation: none !important;
  }
}
</style>
