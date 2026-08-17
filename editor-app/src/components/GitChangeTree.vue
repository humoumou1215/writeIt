<script setup lang="ts">
// 变更文件树（M15）：GitPanel 工作区 / 提交变更列表的可折叠树形渲染
//  目录行：箭头 + 文件夹图标 + 名称 + 聚合状态色块 + 聚合行数；点击折叠/展开
//  文件行：状态色块 + 名称 + 行数统计；点击 → emit('open')（父层打开 diff）
import { computed } from 'vue'
import type { GitChangeNode } from '../git/change-tree'
import { baseName } from '../fs/types'

// 状态色板（与 GitPanel STATUS_META 一致；模板 stCls 使用）
const STATUS_CLS: Record<string, string> = {
  M: 'st-m',
  A: 'st-a',
  D: 'st-d',
  '?': 'st-u',
  U: 'st-u',
  R: 'st-r',
  C: 'st-r',
}
function stCls(st?: string): string {
  return (st && STATUS_CLS[st]) || 'st-u'
}

defineOptions({ name: 'GitChangeTree' })

const props = defineProps<{
  node: GitChangeNode
  depth: number
  /** 折叠的目录路径集合（空 = 全部展开） */
  collapsed: Set<string>
}>()

const emit = defineEmits<{ open: [node: GitChangeNode] }>()

const isDir = computed(() => props.node.kind === 'dir')
const isCollapsed = computed(() => isDir.value && props.collapsed.has(props.node.path))

function toggle() {
  if (!isDir.value) {
    emit('open', props.node)
    return
  }
  if (props.collapsed.has(props.node.path)) props.collapsed.delete(props.node.path)
  else props.collapsed.add(props.node.path)
}
</script>

<template>
  <div>
    <div
      class="ct-node"
      :class="{ dir: node.kind === 'dir', 'ws-file': node.kind === 'file' }"
      :style="{ paddingLeft: depth * 14 + 6 + 'px' }"
      @click="toggle"
    >
      <span class="arrow" :class="{ open: isDir && !isCollapsed }">
        <span v-if="isDir">▶</span>
      </span>
      <span class="ct-icon">{{ isDir ? '📁' : '📄' }}</span>
      <span v-if="isDir" class="st" :class="stCls(node.status)">{{ node.status }}</span>
      <span class="name" :title="node.path">{{ isDir ? node.name : baseName(node.path) }}</span>
      <span v-if="node.added >= 0" class="stats">
        <span class="stat-add">+{{ node.added }}</span>
        <span class="stat-del">−{{ node.deleted }}</span>
      </span>
    </div>
    <div v-if="isDir && !isCollapsed && node.children">
      <GitChangeTree
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :collapsed="collapsed"
        @open="(n) => emit('open', n)"
      />
    </div>
  </div>
</template>

<style scoped>
.ct-node {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding-right: 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--chrome-on-background);
  user-select: none;
  white-space: nowrap;
}
.ct-node:hover {
  background: var(--chrome-hover);
}
.arrow {
  width: 14px;
  text-align: center;
  font-size: 9px;
  color: var(--chrome-on-surface-variant);
  transition: transform 0.12s;
  flex-shrink: 0;
}
.arrow.open {
  transform: rotate(90deg);
}
.ct-icon {
  width: 16px;
  font-size: 12px;
  text-align: center;
  flex-shrink: 0;
}
.st {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}
.st-m {
  background: #f59f00;
  color: #fff;
}
.st-a {
  background: #2e7d32;
  color: #fff;
}
.st-d {
  background: var(--chrome-error, #ba1a1a);
  color: #fff;
}
.st-u {
  background: #6c757d;
  color: #fff;
}
.st-r {
  background: #7b5cd6;
  color: #fff;
}
.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12.5px;
}
.stats {
  font-size: 11px;
  flex-shrink: 0;
  display: flex;
  gap: 5px;
}
.stat-add {
  color: #2e7d32;
}
.stat-del {
  color: var(--chrome-error, #ba1a1a);
}
</style>