<script setup lang="ts">
import { state } from '../state/store'
import { activateTab, closeTab } from '../editor/manager'

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
</script>

<template>
  <div class="tabbar">
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
  </div>
</template>

<style scoped>
.tabbar {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 6px 10px 0;
  overflow-x: auto;
  flex-shrink: 0;
  background: var(--chrome-surface);
  border-bottom: 1px solid var(--chrome-border);
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
  user-select: none;
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
}
</style>
