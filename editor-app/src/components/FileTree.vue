<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue'
import type { FsEntry } from '../fs/types'
import { isEditableFile } from '../fs/types'
import { state, toast } from '../state/store'
import { settings } from '../state/settings'
import { openTab, openGitDiff } from '../editor/manager'
import {
  toggleExpand,
  isExpanded,
  startNewFile,
  startNewDir,
  startRename,
  commitEditing,
  cancelEditing,
  dragState,
  beginDrag,
  dragOver,
  dragLeaveTarget,
  moveNode,
  endDrag,
  type DropPosition,
} from '../state/treeOps'
import NewInput from './NewInput.vue'
import MenuIcon from './MenuIcon.vue'

defineOptions({ name: 'TreeNode' })

const props = defineProps<{ node: FsEntry; depth: number }>()

const inputEl = ref<HTMLInputElement | null>(null)

const isRenaming = () =>
  state.editing?.mode === 'rename' && state.editing.path === props.node.path

/** 进入重命名时聚焦输入框并全选当前名字（组件常驻，onMounted 不会重跑 → 用 watch） */
async function focusAndSelectRenameInput() {
  await nextTick()
  const el = inputEl.value
  if (!el) return
  el.focus()
  el.select()
}

onMounted(() => {
  // 组件首次挂载即处于重命名状态（理论上极少）也全选
  if (isRenaming()) void focusAndSelectRenameInput()
})

watch(isRenaming, (renaming) => {
  if (renaming) void focusAndSelectRenameInput()
})

function open() {
  if (props.node.kind === 'dir') toggleExpand(props.node.path)
  else if (isEditableFile(props.node.name)) openTab(props.node.path)
  else toast(`「${props.node.name}」仅展示，暂不支持打开编辑`, 'info')
}

// ---------- M15：git 状态角标（工作区改动） ----------
// 呈现方式：文件名按状态着色 + 行尾类型字母（U / M / A / D / ? …），替代早期「文件名左侧圆点」
const STATUS_META: Record<
  string,
  { letter: string; label: string; nameCls: string; chipCls: string }
> = {
  M: { letter: 'M', label: '已修改', nameCls: 'nm-m', chipCls: 'ck-m' },
  A: { letter: 'A', label: '已新增', nameCls: 'nm-a', chipCls: 'ck-a' },
  D: { letter: 'D', label: '已删除', nameCls: 'nm-d', chipCls: 'ck-d' },
  '?': { letter: '?', label: '未跟踪', nameCls: 'nm-u', chipCls: 'ck-u' },
  U: { letter: 'U', label: '未合并', nameCls: 'nm-u', chipCls: 'ck-u' },
  R: { letter: 'R', label: '已重命名', nameCls: 'nm-r', chipCls: 'ck-r' },
  C: { letter: 'C', label: '已复制', nameCls: 'nm-r', chipCls: 'ck-r' },
}
/** 当前节点的 git 状态码（文件 = 工作区状态；目录 = 聚合状态）；无改动返回空串 */
function nodeStatus(): string {
  if (props.node.kind === 'file') return state.gitMark.files[props.node.path]?.status ?? ''
  if (props.node.kind === 'dir') return state.gitMark.dirs[props.node.path] ?? ''
  return ''
}
const statusMeta = () => STATUS_META[nodeStatus()]
/** 有改动文件行尾的「查看 Git 改动」按钮（单击行为保持正常打开编辑，不劫持） */
function openGitTreeDiff(path: string) {
  void openGitDiff(path, { from: null, to: 'HEAD', label: '工作区 vs HEAD' })
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

// ---------- 拖拽移动（M7） ----------

const nodeEl = ref<HTMLDivElement | null>(null)

function onDragStart(e: DragEvent) {
  if (isRenaming()) return
  beginDrag(props.node.path, props.node.kind, props.node.name)
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // 用自定义 MIME 而非 text/plain：Windows WebView2 下 setData('text/plain', 路径)
    // 会被当成「拖拽真实文件」→ 系统层找不到该文件 → 显示禁止符号且拖不动。
    // 自定义类型让 WebView2 视为应用内拖拽，正常显示 move 光标。
    e.dataTransfer.setData('application/x-writeit-node', props.node.path)
  }
}

/** 根据悬停位置计算落点：目录 = 上/中/下三分（插入前/移入/插入后）；文件 = 上下二分 */
function computePosition(e: DragEvent): DropPosition {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const ratio = (e.clientY - rect.top) / rect.height
  if (props.node.kind === 'dir') {
    if (ratio < 1 / 3) return 'before'
    if (ratio > 2 / 3) return 'after'
    return 'into'
  }
  return ratio < 0.5 ? 'before' : 'after'
}

function onDragOver(e: DragEvent) {
  if (!dragState.active) return
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOver(props.node.path, props.node.kind, computePosition(e))
}

function onDragLeave(e: DragEvent) {
  // 移入子元素（span/actions）不算离开
  if (e.relatedTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return
  dragLeaveTarget()
}

function onDrop(e: DragEvent) {
  if (!dragState.active) return
  e.preventDefault()
  e.stopPropagation()
  void moveNode().finally(() => endDrag())
}

function onDragEnd() {
  endDrag()
}

/** 拖拽视觉状态（本节点） */
const dropVisual = () => {
  if (!dragState.active || dragState.targetPath !== props.node.path) return {}
  const pos = dragState.position
  return {
    'drag-into': pos === 'into',
    'drag-before': pos === 'before',
    'drag-after': pos === 'after',
    'drag-invalid': dragState.invalid,
  }
}
</script>

<template>
  <div>
    <div
      ref="nodeEl"
      class="node"
      :class="{
        selected: isRenaming(),
        revealed: state.revealPath === node.path,
        ...dropVisual(),
      }"
      :data-path="node.path"
      :style="{ paddingLeft: depth * 14 + 6 + 'px' }"
      :draggable="!isRenaming()"
      @click="open"
      @contextmenu="onContextMenu"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @dragend="onDragEnd"
    >
      <span class="arrow" :class="{ open: isExpanded(node.path) }">
        <MenuIcon
          v-if="node.kind === 'dir'"
          name="chevron"
          :set="settings.iconSet"
          :size="12"
        />
      </span>
      <span class="icon">
        <MenuIcon
          :name="node.kind === 'dir' ? 'folder' : 'file'"
          :set="settings.iconSet"
          :size="15"
        />
      </span>
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
        :class="[
          { muted: node.kind === 'file' && !isEditableFile(node.name) },
          statusMeta()?.nameCls,
        ]"
        :title="statusMeta() ? statusMeta()!.label : undefined"
      >
        {{ node.name }}
      </span>
      <!-- M15：git 类型字母（行尾，替代文件名左侧圆点） -->
      <span
        v-if="statusMeta()"
        class="git-letter"
        :class="statusMeta()!.chipCls"
        :title="`${statusMeta()!.label} · 工作区改动，点击行尾 Git 图标查看 diff`"
      >
        {{ statusMeta()!.letter }}
      </span>
      <span class="actions">
        <button
          v-if="node.kind === 'file' && state.gitMark.files[node.path]"
          class="mini git-diff-btn"
          title="查看 Git 改动（工作区 vs HEAD）"
          @click.stop="openGitTreeDiff(node.path)"
        >
          <MenuIcon name="git" :set="settings.iconSet" :size="12" />
        </button>
        <button
          v-if="node.kind === 'dir'"
          class="mini"
          title="新建文件"
          @click.stop="startNewFile(node.path)"
        >
          <MenuIcon name="fileNew" :set="settings.iconSet" :size="12" />
          <span>文件</span>
        </button>
        <button
          v-if="node.kind === 'dir'"
          class="mini"
          title="新建文件夹"
          @click.stop="startNewDir(node.path)"
        >
          <MenuIcon name="dirNew" :set="settings.iconSet" :size="12" />
          <span>目录</span>
        </button>
        <button class="mini" title="重命名" @click.stop="startRename(node.path)">
          <MenuIcon name="rename" :set="settings.iconSet" :size="12" />
        </button>
      </span>
    </div>

    <!-- 新建输入框（显示在父目录下） -->
    <div
      v-if="state.editing?.mode === 'new' && state.editing.path === node.path"
      class="node new-row"
      :style="{ paddingLeft: (depth + 1) * 14 + 6 + 'px' }"
    >
      <span class="icon">
        <MenuIcon
          :name="state.editing.kind === 'dir' ? 'folder' : 'file'"
          :set="settings.iconSet"
          :size="15"
        />
      </span>
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
  border-radius: 6px;
  cursor: pointer;
  color: var(--chrome-on-background);
  user-select: none;
  white-space: nowrap;
}
.node:hover {
  background: var(--chrome-hover);
}
.node.selected {
  background: var(--chrome-selected);
}
/* ---- 拖拽视觉（M7） ---- */
.node[draggable='true'] {
  cursor: grab;
}
.node[draggable='true']:active {
  cursor: grabbing;
}
/* 悬停目录中间 = 移入 */
.node.drag-into {
  background: var(--chrome-selected);
  box-shadow: inset 0 0 0 1.5px var(--chrome-primary);
}
/* 同级重排：插入指示线 */
.node.drag-before {
  box-shadow: 0 -2px 0 var(--chrome-primary);
}
.node.drag-after {
  box-shadow: 0 2px 0 var(--chrome-primary);
}
/* 非法目标（循环/自身） */
.node.drag-invalid {
  background: color-mix(in srgb, var(--chrome-error, #ba1a1a), transparent 90%);
  box-shadow: inset 0 0 0 1.5px var(--chrome-error, #ba1a1a);
}
/* 瞄准定位高亮（闪烁 2 次后淡出） */
.node.revealed {
  background: var(--chrome-reveal);
  animation: reveal-flash 1.2s ease-out 2;
}
@keyframes reveal-flash {
  0%,
  60% {
    box-shadow: 0 0 0 2px var(--chrome-reveal-ring);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
.new-row {
  cursor: default;
}
.arrow {
  width: 14px;
  text-align: center;
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
  transition: transform 0.12s;
}
.arrow.open {
  transform: rotate(90deg);
}
.icon {
  width: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--chrome-on-surface-variant);
}
.icon .mi {
  flex-shrink: 0;
}
/* M15：git 状态呈现——文件名按状态着色 + 行尾类型字母；替代早期左侧圆点 */
.name.nm-m {
  color: #f59f00;
}
.name.nm-a {
  color: #4caf50;
}
.name.nm-d {
  color: var(--chrome-error, #ba1a1a);
}
.name.nm-u {
  color: #8b95a1;
}
.name.nm-r {
  color: #9d7beb;
}
.git-letter {
  min-width: 17px;
  height: 17px;
  line-height: 17px;
  text-align: center;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 800;
  font-family: ui-monospace, Consolas, monospace;
  flex-shrink: 0;
  user-select: none;
}
.git-letter.ck-m {
  color: #f59f00;
  background: rgba(245, 159, 0, 0.16);
}
.git-letter.ck-a {
  color: #4caf50;
  background: rgba(76, 175, 80, 0.16);
}
.git-letter.ck-d {
  color: var(--chrome-error, #ba1a1a);
  background: color-mix(in srgb, var(--chrome-error, #ba1a1a) 16%, transparent);
}
.git-letter.ck-u {
  color: #8b95a1;
  background: rgba(139, 149, 161, 0.18);
}
.git-letter.ck-r {
  color: #9d7beb;
  background: rgba(157, 123, 235, 0.16);
}
.git-diff-btn {
  color: var(--chrome-primary) !important;
}
.name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.name.muted {
  color: var(--chrome-on-surface-variant);
}
.actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
  align-items: center;
}
.actions .mini {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 5px;
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  line-height: 1;
}
.actions .mini:hover {
  background: var(--chrome-hover);
  color: var(--chrome-primary);
}
.node:hover .actions {
  display: inline-flex;
}
.mini {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
}
.mini:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
</style>
