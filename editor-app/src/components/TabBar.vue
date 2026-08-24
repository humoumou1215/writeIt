<script setup lang="ts">
import { state } from '../state/store'
import { fs } from '../fs'
import { activateTab, closeTab } from '../editor/manager'

const isTauri = fs.kind === 'tauri'

function onMiddleClick(e: MouseEvent, id: string) {
  if (e.button === 1) {
    e.preventDefault()
    closeTab(id)
  }
}

// M11d：标签右键菜单
function onContextMenu(e: MouseEvent, id: string) {
  e.preventDefault()
  const tab = state.tabs.find((t) => t.id === id)
  if (!tab) return
  state.tabContextMenu = {
    x: Math.min(e.clientX, window.innerWidth - 170),
    y: Math.min(e.clientY, window.innerHeight - 120),
    tabId: id,
    path: tab.path,
  }
}

// ---------- 自绘窗口控制（最小化/最大化/关闭；并入标签栏，复用整行为拖拽区） ----------
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
</script>

<template>
  <div
    class="tabbar"
    :data-tauri-drag-region="isTauri ? '' : undefined"
  >
    <span v-if="!state.tabs.length" class="app-name">WriteIt</span>
    <div
      v-for="tab in state.tabs"
      :key="tab.id"
      class="tab"
      :class="{ active: tab.id === state.activeTabId }"
      @click="activateTab(tab.id)"
      @dblclick="closeTab(tab.id)"
      @auxclick="onMiddleClick($event, tab.id)"
      :title="tab.path"
      @contextmenu="onContextMenu($event, tab.id)"
    >
      <span class="dot" :class="{ dirty: tab.dirty }"></span>
      <span v-if="tab.kind === 'git'" class="git-badge" title="Git SCM 打开">🔀</span>
      <span class="tab-name">{{ tab.name }}</span>
      <button
        class="close"
        title="关闭 (中键/双击也可)"
        @click.stop="closeTab(tab.id)"
        @dblclick.stop
      >
        ×
      </button>
    </div>
    <span v-if="!state.tabs.length" class="empty-hint">在左侧选择文件打开，或右键目录新建</span>

    <!-- 窗口控制（并入标签栏右端；整行为无系统标题栏时的拖拽区） -->
    <div v-if="isTauri" class="tb-controls">
      <button class="tb-btn" title="最小化" @click="winMinimize"><span class="g">─</span></button>
      <button class="tb-btn" title="最大化" @click="winToggleMaximize"><span class="g">▢</span></button>
      <button class="tb-btn tb-close" title="关闭" @click="winClose"><span class="g">✕</span></button>
    </div>
  </div>
</template>

<style scoped>
.tabbar {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 6px 4px 0;
  overflow-x: auto;
  flex-shrink: 0;
  background: var(--chrome-surface);
  border-bottom: 1px solid var(--chrome-border);
  user-select: none;
  -webkit-user-select: none;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px 8px 0 0;
  font-size: 13px;
  cursor: pointer;
  color: var(--chrome-on-surface-variant);
  border: 1px solid transparent;
  border-bottom: none;
  max-width: 220px;
  white-space: nowrap;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}
.tab:hover {
  background: var(--chrome-hover);
}
.tab.active {
  background: var(--chrome-background);
  border-color: var(--chrome-border);
  color: var(--chrome-on-background);
  /* 与下方编辑器连成一体 */
  box-shadow: 0 1px 0 0 var(--chrome-background);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
}
.dot.dirty {
  background: var(--chrome-primary);
}
.git-badge {
  font-size: 11px;
  color: var(--chrome-primary);
  flex-shrink: 0;
}
.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.close {
  border: none;
  background: transparent;
  color: inherit;
  font-size: 15px;
  line-height: 1;
  padding: 0 3px;
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
}
.close:hover {
  background: var(--chrome-hover);
}
.empty-hint {
  align-self: center;
  font-size: 12px;
  color: var(--chrome-on-surface-variant);
  padding: 4px 8px;
  white-space: nowrap;
}
/* 无标签时：应用名居左，作为拖拽抓手 */
.app-name {
  align-self: center;
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--chrome-on-surface-variant);
  padding: 0 10px;
  white-space: nowrap;
}

/* ===== 窗口控制（右端；整行拖拽区内的可点击区） ===== */
.tb-controls {
  display: flex;
  height: 100%;
  margin-left: auto;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
  align-self: stretch;
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
</style>
