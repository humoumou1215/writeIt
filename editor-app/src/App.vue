<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { state, toast } from './state/store'
import { settings, applyTheme } from './state/settings'
import { fs } from './fs'
import { isEditableFile, type FsEntry } from './fs/types'
import {
  openDirectory,
  refreshTree,
  saveActiveTab,
  ensureAutoSaveLoop,
  openTab,
} from './editor/manager'
import { startNewFile, startNewDir, commitEditing, cancelEditing } from './state/treeOps'
import FileTree from './components/FileTree.vue'
import NewInput from './components/NewInput.vue'
import TabBar from './components/TabBar.vue'
import EditorPane from './components/EditorPane.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import ContextMenu from './components/ContextMenu.vue'

// ---------- 生命周期 ----------
onMounted(async () => {
  applyTheme(settings.theme)
  state.fsName = fs.kind
  await refreshTree()
  ensureAutoSaveLoop()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

// ---------- 快捷键 ----------
function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault()
    saveActiveTab()
  }
}

// ---------- 上下文菜单动作 ----------
async function onMenuAction(action: string, path: string, kind: 'file' | 'dir') {
  const { commitEditing, removeNode, startRename, startNewFile: snf, startNewDir: snd } =
    await import('./state/treeOps')
  switch (action) {
    case 'open':
      if (kind === 'file' && isEditableFile(path)) await openTab(path)
      break
    case 'newFile':
      snf(path)
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
  void commitEditing
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
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <div class="logo">M</div>
        <div class="brand-text">
          <div class="title">Milkdown Note</div>
          <div class="sub">{{ state.fsName }} · {{ state.rootName }}</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn" @click="onOpenDir" title="打开本地目录">📂 打开目录</button>
        <button class="btn" @click="saveActiveTab" title="Ctrl+S">💾 保存</button>
        <button class="btn" @click="gotoFile(-1)" title="上一个文件">↑</button>
        <button class="btn" @click="gotoFile(1)" title="下一个文件">↓</button>
        <div class="settings-wrap">
          <button
            class="btn"
            :class="{ active: state.settingsOpen }"
            @click="state.settingsOpen = !state.settingsOpen"
            title="设置"
          >
            ⚙️
          </button>
          <SettingsPanel v-if="state.settingsOpen" />
        </div>
      </div>
    </header>

    <!-- 主体 -->
    <div class="body">
      <aside class="sidebar">
        <div class="sidebar-head">
          <span>文件</span>
          <span class="mini-actions">
            <button class="mini" title="新建文件" @click="startNewFile('')">＋文件</button>
            <button class="mini" title="新建文件夹" @click="startNewDir('')">＋目录</button>
            <button class="mini" title="刷新" @click="refreshTree">⟳</button>
          </span>
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
      </aside>

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
              Ctrl+S 保存 · 中键/× 关闭标签 · 右键文件树显示操作菜单
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
        <template
          v-if="state.tabs.find((t) => t.id === state.activeTabId)?.dirty"
        >
          ● 未保存
        </template>
      </span>
      <span class="spacer"></span>
      <span>{{ settings.autoSave ? `自动保存 ${settings.autoSaveDelay / 1000}s` : '手动保存' }}</span>
    </footer>

    <!-- 浮层 -->
    <ConfirmDialog />
    <ContextMenu @action="onMenuAction" />
    <Teleport to="body">
      <div class="toasts">
        <div
          v-for="t in state.toasts"
          :key="t.id"
          class="toast"
          :class="t.type"
        >
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

/* 顶栏 */
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--chrome-border, #e5e6eb);
  background: var(--chrome-surface, #fff);
  flex-shrink: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: linear-gradient(135deg, #ffdc8e, #f5b301);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #4a3200;
}
.brand-text .title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
}
.brand-text .sub {
  font-size: 11px;
  color: var(--chrome-on-surface-variant, #8a8f99);
}
.actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
  align-items: center;
}
.settings-wrap {
  position: relative;
}
.btn {
  border: 1px solid var(--chrome-border, #d0d3d9);
  background: var(--chrome-background, #fff);
  color: inherit;
  border-radius: 7px;
  padding: 5px 10px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
}
.btn:hover {
  background: var(--chrome-hover, #f2f3f5);
}
.btn.active {
  background: var(--chrome-selected, #e8f3ff);
  border-color: var(--chrome-primary, #f5b301);
}

/* 主体 */
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.sidebar {
  width: 250px;
  flex-shrink: 0;
  border-right: 1px solid var(--chrome-border, #e5e6eb);
  background: var(--chrome-surface, #fff);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--chrome-on-surface-variant, #8a8f99);
  border-bottom: 1px solid var(--chrome-border, #e5e6eb);
  flex-shrink: 0;
}
.mini-actions {
  display: flex;
  gap: 2px;
}
.mini {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant, #8a8f99);
  font-size: 11px;
  padding: 2px 5px;
  border-radius: 5px;
  cursor: pointer;
  font-family: inherit;
}
.mini:hover {
  background: var(--chrome-hover, #f2f3f5);
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

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.editor-area {
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

/* 状态栏 */
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
  max-width: 60%;
}
.spacer {
  flex: 1;
}

/* Toast */
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
