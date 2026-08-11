<script setup lang="ts">
import { state } from '../state/store'
import { activateTab, closeTab } from '../editor/manager'

function onMiddleClick(e: MouseEvent, id: string) {
  if (e.button === 1) {
    e.preventDefault()
    closeTab(id)
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
      @auxclick="onMiddleClick($event, tab.id)"
      :title="tab.path"
    >
      <span class="dot" :class="{ dirty: tab.dirty }"></span>
      <span class="tab-name">{{ tab.name }}</span>
      <button
        class="close"
        title="关闭 (中键也可)"
        @click.stop="closeTab(tab.id)"
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
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px 8px 0 0;
  font-size: 13px;
  cursor: pointer;
  color: var(--chrome-on-surface-variant, #8a8f99);
  border: 1px solid transparent;
  border-bottom: none;
  max-width: 220px;
  white-space: nowrap;
  user-select: none;
}
.tab:hover {
  background: var(--chrome-hover, #f2f3f5);
}
.tab.active {
  background: var(--chrome-background, #fff);
  border-color: var(--chrome-border, #e5e6eb);
  color: var(--chrome-on-background, #1f2329);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
}
.dot.dirty {
  background: var(--chrome-primary, #f5b301);
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
  background: var(--chrome-selected, #e8f3ff);
}
.empty-hint {
  align-self: center;
  font-size: 12px;
  color: var(--chrome-on-surface-variant, #8a8f99);
  padding: 4px 8px;
}
</style>
