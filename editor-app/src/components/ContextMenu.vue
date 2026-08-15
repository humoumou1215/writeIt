<script setup lang="ts">
import { state } from '../state/store'

const emit = defineEmits<{
  (e: 'action', action: string, path: string, kind: 'file' | 'dir'): void
}>()

function run(action: string) {
  if (state.contextMenu) {
    emit('action', action, state.contextMenu.path, state.contextMenu.kind)
  }
  state.contextMenu = null
}

function close() {
  state.contextMenu = null
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.contextMenu"
      class="menu-mask"
      @click="close"
      @contextmenu.prevent="close"
    >
      <div
        class="menu"
        :style="{ left: state.contextMenu.x + 'px', top: state.contextMenu.y + 'px' }"
      >
        <template v-if="state.contextMenu.kind === 'file'">
          <button class="menu-item" @click="run('open')">打开</button>
          <button class="menu-item" @click="run('rename')">重命名</button>
          <button class="menu-item danger" @click="run('delete')">删除</button>
        </template>
        <template v-else>
          <button class="menu-item" @click="run('newFile')">新建文件</button>
          <button class="menu-item" @click="run('newFromTemplate')">基于模板新建…</button>
          <button class="menu-item" @click="run('newDir')">新建文件夹</button>
          <button class="menu-item" @click="run('rename')">重命名</button>
          <button class="menu-item danger" @click="run('delete')">删除</button>
        </template>
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
</style>
