<script setup lang="ts">
// M16 SCM 文件行（ScmFileRow）：状态色块 + 名称 + dim 目录 + 行数 + hover 行内操作
//  - Changes 区：放弃更改（确认）/ 暂存 ＋ / 打开文件
//  - Staged 区：取消暂存 －
//  - Merge 区：标记已解决 ✓（= stage）
// 操作由 GitPanel 统一处理（emit），行内按钮仅 hover 显示
import { computed } from 'vue'
import type { GitFileStatus } from '../git'
import { baseName } from '../fs/types'

const STATUS_CLS: Record<string, string> = { M: 'st-m', A: 'st-a', D: 'st-d', '?': 'st-u', U: 'st-u', R: 'st-r', C: 'st-r' }

const props = defineProps<{
  file: GitFileStatus
  section: 'staged' | 'changes' | 'merge'
}>()

const emit = defineEmits<{
  open: [file: GitFileStatus]
  stage: [file: GitFileStatus]
  unstage: [file: GitFileStatus]
  discard: [file: GitFileStatus]
  openFile: [file: GitFileStatus]
  context: [e: MouseEvent, file: GitFileStatus]
  menu: [e: MouseEvent, file: GitFileStatus]
}>()

const stCls = computed(() => STATUS_CLS[props.file.status] ?? 'st-u')
const displayName = computed(() =>
  props.file.renameFrom ? `${baseName(props.file.renameFrom)} → ${baseName(props.file.path)}` : baseName(props.file.path)
)
const dir = computed(() => {
  const i = props.file.path.lastIndexOf('/')
  return i === -1 ? '' : props.file.path.slice(0, i)
})
/** 行数：Changes 区 = added/deleted（工作区增量）；Staged 区 = indexAdded/indexDeleted。
 * 旧后端（无双码，indexAdded 缺失）→ 回退用 added/deleted，避免 blank stats */
const stats = computed(() => {
  if (props.section === 'staged' && typeof props.file.indexAdded !== 'undefined') {
    return { add: props.file.indexAdded, del: props.file.indexDeleted }
  }
  return { add: props.file.added, del: props.file.deleted }
})
const statHide = computed(() => {
  const s = stats.value
  return (s.add == null || s.add < 0) && (s.del == null || s.del < 0)
})
const title = computed(() => props.file.renameFrom ? `${props.file.renameFrom} → ${props.file.path}` : props.file.path)
</script>

<template>
  <div
    class="scm-row"
    tabindex="0"
    role="treeitem"
    :title="title"
    @click="emit('open', file)"
    @keydown.enter.prevent="emit('open', file)"
    @contextmenu.prevent="emit('context', $event, file)"
  >
    <span class="st" :class="stCls">{{ file.status }}</span>
    <span class="name">{{ displayName }}</span>
    <span v-if="dir" class="dir dim">{{ dir }}</span>
    <span class="stats" :class="{ hide: statHide }">
      <span v-if="stats.add != null && stats.add >= 0" class="stat-add">+{{ stats.add }}</span>
      <span v-if="stats.del != null && stats.del > 0" class="stat-del">−{{ stats.del }}</span>
    </span>
    <span class="actions">
      <!-- Changes：放弃 / 暂存 / 打开文件 -->
      <template v-if="section === 'changes'">
        <button class="row-btn danger" title="放弃更改（工作区回到已暂存/HEAD）" @click.stop="emit('discard', file)">↩</button>
        <button class="row-btn" title="暂存" @click.stop="emit('stage', file)">＋</button>
        <button class="row-btn" title="打开文件" @click.stop="emit('openFile', file)">📄</button>
      </template>
      <!-- Staged：取消暂存 -->
      <template v-else-if="section === 'staged'">
        <button class="row-btn" title="取消暂存（保留工作区改动）" @click.stop="emit('unstage', file)">－</button>
      </template>
      <!-- Merge：标记已解决（= 暂存） -->
      <template v-else>
        <button class="row-btn" title="标记为已解决（暂存）" @click.stop="emit('stage', file)">✓</button>
      </template>
      <button class="row-btn" title="更多操作" @click.stop="emit('menu', $event, file)">⋯</button>
    </span>
  </div>
</template>

<style scoped>
.scm-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--chrome-on-background);
  white-space: nowrap;
  outline: none;
}
.scm-row:hover,
.scm-row:focus-visible {
  background: var(--chrome-hover);
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
  color: #fff;
  flex-shrink: 0;
}
.st-m { background: #f59f00; }
.st-a { background: #2e7d32; }
.st-d { background: var(--chrome-error, #ba1a1a); }
.st-u { background: #6c757d; }
.st-r { background: #7b5cd6; }
.name {
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12.5px;
  min-width: 30px;
  min-width: 0;
}
.dir {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  text-align: right;
  white-space: nowrap;
}
.dim {
  color: var(--chrome-on-surface-variant);
  opacity: 0.75;
}
.stats {
  font-size: 11px;
  flex-shrink: 0;
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.stats.hide { display: none; }
.stat-add { color: #2e7d32; }
.stat-del { color: var(--chrome-error, #ba1a1a); }
.actions {
  display: none;
  flex-shrink: 0;
  gap: 2px;
}
.scm-row:hover .actions {
  display: flex;
}
.row-btn {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 12px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
}
.row-btn:hover {
  background: var(--chrome-selected);
  color: var(--chrome-on-background);
}
.row-btn.danger:hover {
  background: color-mix(in srgb, var(--chrome-error, #ba1a1a), transparent 80%);
  color: var(--chrome-error, #ba1a1a);
}
</style>