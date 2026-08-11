<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import type { FsEntry } from '../fs/types'
import { isEditableFile } from '../fs/types'
import { state } from '../state/store'
import { openTab } from '../editor/manager'
import {
  toggleExpand,
  isExpanded,
  startNewFile,
  startNewDir,
  startRename,
  commitEditing,
  cancelEditing,
} from '../state/treeOps'
import NewInput from './NewInput.vue'

defineOptions({ name: 'TreeNode' })

const props = defineProps<{ node: FsEntry; depth: number }>()

const inputEl = ref<HTMLInputElement | null>(null)

const isRenaming = () =>
  state.editing?.mode === 'rename' && state.editing.path === props.node.path

onMounted(async () => {
  if (isRenaming()) {
    await nextTick()
    inputEl.value?.focus()
    inputEl.value?.select()
  }
})

function open() {
  if (props.node.kind === 'dir') toggleExpand(props.node.path)
  else if (isEditableFile(props.node.name)) openTab(props.node.path)
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  state.contextMenu = {
    x: Math.min(e.clientX, window.innerWidth - 170),
    y: Math.min(e.clientY, window.innerHeight - 200),
    path: props.node.path,
    kind: props.node.kind,
  }
}
</script>

<template>
  <div>
    <div
      class="node"
      :class="{ selected: isRenaming() }"
      :style="{ paddingLeft: depth * 14 + 6 + 'px' }"
      @click="open"
      @contextmenu="onContextMenu"
    >
      <span class="arrow" :class="{ open: isExpanded(node.path) }">
        {{ node.kind === 'dir' ? '▸' : '' }}
      </span>
      <span class="icon">{{ node.kind === 'dir' ? '📁' : '📄' }}</span>
      <input
        v-if="isRenaming()"
        ref="inputEl"
        class="rename-input"
        :value="node.name"
        spellcheck="false"
        @click.stop
        @keydown.enter.prevent="commitEditing(($event.target as HTMLInputElement).value)"
        @keydown.esc.prevent="cancelEditing"
        @blur="commitEditing(($event.target as HTMLInputElement).value)"
      />
      <span
        v-else
        class="name"
        :class="{ muted: node.kind === 'file' && !isEditableFile(node.name) }"
      >
        {{ node.name }}
      </span>
      <span class="actions">
        <button
          v-if="node.kind === 'dir'"
          class="mini"
          title="新建文件"
          @click.stop="startNewFile(node.path)"
        >
          ＋文件
        </button>
        <button
          v-if="node.kind === 'dir'"
          class="mini"
          title="新建文件夹"
          @click.stop="startNewDir(node.path)"
        >
          ＋目录
        </button>
        <button class="mini" title="重命名" @click.stop="startRename(node.path)">✎</button>
      </span>
    </div>

    <!-- 新建输入框（显示在父目录下） -->
    <div
      v-if="state.editing?.mode === 'new' && state.editing.path === node.path"
      class="node new-row"
      :style="{ paddingLeft: (depth + 1) * 14 + 6 + 'px' }"
    >
      <span class="icon">{{ state.editing.kind === 'dir' ? '📁' : '📄' }}</span>
      <NewInput
        :placeholder="state.editing.kind === 'file' ? '新文件.md' : '新文件夹'"
        @commit="commitEditing"
        @cancel="cancelEditing"
      />
    </div>

    <div v-if="node.kind === 'dir' && isExpanded(node.path)">
      <TreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>

<style scoped>
.node {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding-right: 8px;
  border-radius: 7px;
  cursor: pointer;
  color: var(--chrome-on-background, #1f2329);
  user-select: none;
  white-space: nowrap;
}
.node:hover {
  background: var(--chrome-hover, #f2f3f5);
}
.node.selected {
  background: var(--chrome-selected, #e8f3ff);
}
.new-row {
  cursor: default;
}
.arrow {
  width: 14px;
  text-align: center;
  font-size: 11px;
  color: var(--chrome-on-surface-variant, #8a8f99);
  transition: transform 0.12s;
}
.arrow.open {
  transform: rotate(90deg);
}
.icon {
  font-size: 13px;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}
.name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.name.muted {
  color: var(--chrome-on-surface-variant, #8a8f99);
}
.actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.node:hover .actions {
  display: inline-flex;
}
.mini {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant, #8a8f99);
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 5px;
  cursor: pointer;
  font-family: inherit;
}
.mini:hover {
  background: var(--chrome-selected, #e8f3ff);
  color: var(--chrome-on-background, #1f2329);
}
</style>
