<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { state, toast } from './state/store'
import { settings, applyTheme, saveSettings, SHORTCUT_DEFS, comboMatches } from './state/settings'
import { fs } from './fs'
import { isEditableFile, type FsEntry } from './fs/types'
import {
  openDirectory,
  refreshTree,
  saveActiveTab,
  ensureAutoSaveLoop,
  openTab,
  activateTab,
  closeTab,
} from './editor/manager'
import {
  startNewFile,
  startNewDir,
  commitEditing,
  cancelEditing,
} from './state/treeOps'
import FileTree from './components/FileTree.vue'
import NewInput from './components/NewInput.vue'
import TabBar from './components/TabBar.vue'
import EditorPane from './components/EditorPane.vue'
import SettingsModal from './components/SettingsModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import ContextMenu from './components/ContextMenu.vue'
import TemplatePicker from './components/TemplatePicker.vue'

// ---------- 生命周期 ----------
onMounted(async () => {
  applyTheme(settings.theme)
  state.fsName = fs.kind
  await refreshTree()
  // M4：启动即扫描模板注册表（斜杠菜单「模板」组 / 基于模板新建依赖）
  void import('./template/service').then((m) => m.templateService.ready())
  ensureAutoSaveLoop()
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
  settings: () => {
    state.settingsOpen = !state.settingsOpen
  },
}

function onKeydown(e: KeyboardEvent) {
  // 输入框/下拉框聚焦时不触发全局快捷键
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
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

// ---------- 侧边栏 ----------
function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed
}
function togglePin() {
  settings.sidebarPinned = !settings.sidebarPinned
  if (settings.sidebarPinned) state.sidebarCollapsed = false
  saveSettings()
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
  }
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

async function onOpenDir() {
  const ok = await openDirectory()
  if (!ok) toast('未选择目录', 'info')
}
</script>

<template>
  <div class="app">
    <!-- 主体：侧边栏 + 主区域 -->
    <div class="body">
      <div class="sidebar">
        <div class="icon-col">
        <button
          class="icon-btn"
          :class="{ active: !state.sidebarCollapsed }"
          :title="`文件目录（${settings.shortcuts.toggleSidebar || 'Ctrl+B'}）`"
          @click="toggleSidebar"
        >
          📁
        </button>
        <button
          class="icon-btn"
          :title="`设置（${settings.shortcuts.settings || 'Ctrl+,'}）`"
          @click="state.settingsOpen = true"
        >
          ⚙️
        </button>
      </div>

      <div
        class="content-col"
        :class="{ collapsed: state.sidebarCollapsed }"
        :style="{ width: settings.sidebarWidth + 'px' }"
      >
        <div class="sidebar-head">
          <span class="root-name" :title="state.rootName">{{ state.rootName }}</span>
          <button
            class="mini pin"
            :class="{ active: settings.sidebarPinned }"
            :title="settings.sidebarPinned ? '已固定（不自动收纳）' : '固定侧边栏（打开文件时不自动收纳）'"
            @click="togglePin"
          >
            📌
          </button>
        </div>
        <div class="sidebar-actions">
          <button class="mini wide" @click="onOpenDir" title="打开本地目录">📂 打开目录</button>
          <button class="mini" title="新建文件" @click="startNewFile('')">＋文件</button>
          <button class="mini" title="新建文件夹" @click="startNewDir('')">＋目录</button>
          <button class="mini" title="刷新" @click="refreshTree">⟳</button>
        </div>
        <div class="tree">
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
            <span class="icon">{{ state.editing.kind === 'dir' ? '📁' : '📄' }}</span>
            <NewInput
              :placeholder="state.editing.kind === 'file' ? '新文件.md' : '新文件夹'"
              @commit="commitEditing"
              @cancel="cancelEditing"
            />
          </div>
          <p v-if="!state.tree.length" class="empty">空目录</p>
        </div>
      </div>

      <div class="resizer" title="拖拽调整宽度" @mousedown="startResize"></div>
      </div>

      <!-- 主区域 -->
      <main class="main">
        <TabBar />
        <div class="editor-area">
          <EditorPane
            v-for="tab in state.tabs"
            :key="tab.id"
            :tab-id="tab.id"
            :visible="tab.id === state.activeTabId"
          />
          <div v-if="!state.tabs.length" class="welcome">
            <h2>🥛 Milkdown Note</h2>
            <p>从左侧文件树打开一个文件，或新建文件开始编辑。</p>
            <p class="hint">
              快捷键：Ctrl+S 保存 · Ctrl+O 打开目录 · Ctrl+B 收纳侧边栏 · 更多在设置中查看
            </p>
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
      <span>
        {{ settings.autoSave ? `自动保存 ${settings.autoSaveDelay / 1000}s` : '手动保存' }}
      </span>
      <span class="backend">{{ state.fsName }} · {{ state.rootName }}</span>
    </footer>

    <!-- 浮层 -->
    <SettingsModal v-if="state.settingsOpen" @close="state.settingsOpen = false" />
    <ConfirmDialog />
    <ContextMenu @action="onMenuAction" />
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
  background: var(--chrome-background, #f5f6f8);
  color: var(--chrome-on-background, #1f2329);
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
  border-right: 1px solid var(--chrome-border, #e5e6eb);
  background: var(--chrome-surface, #fff);
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
  border-right: 1px solid var(--chrome-border, #e5e6eb);
}
.icon-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  font-size: 17px;
  border-radius: 9px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.65;
}
.icon-btn:hover {
  background: var(--chrome-hover, #f2f3f5);
  opacity: 1;
}
.icon-btn.active {
  background: var(--chrome-selected, #e8f3ff);
  opacity: 1;
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
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--chrome-border, #e5e6eb);
  flex-shrink: 0;
}
.root-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--chrome-on-surface-variant, #8a8f99);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mini {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant, #8a8f99);
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.mini:hover {
  background: var(--chrome-hover, #f2f3f5);
  color: var(--chrome-on-background, #1f2329);
}
.mini.pin.active {
  color: var(--chrome-primary, #f5b301);
}
.sidebar-actions {
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--chrome-border, #e5e6eb);
  flex-shrink: 0;
  align-items: center;
}
.mini.wide {
  flex: 1;
  text-align: left;
  padding: 4px 8px;
  border: 1px solid var(--chrome-border, #d0d3d9);
  border-radius: 7px;
}
.mini.wide:hover {
  border-color: var(--chrome-primary, #f5b301);
  background: var(--chrome-background, #fff);
  color: var(--chrome-on-background, #1f2329);
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
  text-align: center;
  flex-shrink: 0;
}
.empty {
  padding: 16px;
  font-size: 12px;
  color: var(--chrome-on-surface-variant, #8a8f99);
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
  background: var(--chrome-primary, #f5b301);
  opacity: 0.4;
}

/* ===== 主区域 ===== */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}.editor-area {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}
.welcome {
  margin: auto;
  text-align: center;
  color: var(--chrome-on-surface-variant, #8a8f99);
}
.welcome h2 {
  font-size: 22px;
  color: var(--chrome-on-background, #1f2329);
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
  color: var(--chrome-on-surface-variant, #8a8f99);
  border-top: 1px solid var(--chrome-border, #e5e6eb);
  background: var(--chrome-surface, #fff);
  flex-shrink: 0;
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
  background: var(--chrome-on-background, #1f2329);
  color: var(--chrome-background, #fff);
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 13px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  animation: rise 0.18s ease;
}
.toast.error {
  background: var(--chrome-error, #ba1a1a);
}
.toast.success {
  background: #2e7d32;
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
