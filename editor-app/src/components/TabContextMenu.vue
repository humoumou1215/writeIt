<script setup lang="ts">
// M11d：标签页右键菜单（Git 改动 / 关闭）
import { state } from '../state/store'

const emit = defineEmits<{
  (e: 'action', action: string, tabId: string): void
}>()

function run(action: string) {
  if (state.tabContextMenu) {
    emit('action', action, state.tabContextMenu.tabId)
  }
  state.tabContextMenu = null
}

function close() {
  state.tabContextMenu = null
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.tabContextMenu"
      class="menu-mask"
      @click="close"
      @contextmenu.prevent="close"
    >
      <div
        class="menu"
        :style="{ left: state.tabContextMenu.x + 'px', top: state.tabContextMenu.y + 'px' }"
      >
        <button class="menu-item" title="查看该文件的 Git 改动" @click="run('gitDiff')">Git 改动</button>
        <button class="menu-item" title="打开文件所在目录并选中该文件" @click="run('revealInExplorer')">在文件管理器中显示</button>
        <div class="divider"></div>
        <button class="menu-item" title="关闭除当前标签外的所有标签" @click="run('closeOthers')">关闭其他</button>
        <button class="menu-item" title="关闭所有标签" @click="run('closeAll')">全部关闭</button>
        <button class="menu-item danger" @click="run('close')">关闭</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
}
.menu {
  position: fixed;
  min-width: 140px;
  background: var(--chrome-surface);
  color: var(--chrome-on-surface);
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  padding: 6px;
  box-shadow: var(--chrome-shadow-1);
  display: flex;
  flex-direction: column;
}
.menu-item {
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  padding: 7px 12px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.menu-item:hover {
  background: var(--chrome-hover);
}
.menu-item.danger {
  color: var(--chrome-error);
}
.divider {
  height: 1px;
  background: var(--chrome-border);
  margin: 4px 8px;
}
</style>
