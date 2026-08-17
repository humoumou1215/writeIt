<script setup lang="ts">
// Diff 视图（M11b：文本模式完整版）
//  - 布局：分栏（默认，左旧右新）/ 统一（Ctrl+Shift+U / 工具栏切换）
//  - 行级 + 词级高亮（words 来自 Rust --word-diff=porcelain 合并）
//  - hunk 折叠：连续 ctx 段超阈值折叠为「⋯ N 行相同」
//  - F7/Shift+F7 导航 + Esc 退出 + 计数「当前/总数」
import { computed, ref, watch, nextTick } from 'vue'
import { state } from '../state/store'
import { closeGitDiff, discardFileDiff, discardHunkDiff } from '../editor/manager'
import type { DiffHunk, DiffLine } from '../git'
import RenderDiff from './RenderDiff.vue'

const props = defineProps<{ tabId: string }>()

const tab = computed(() => state.tabs.find((t) => t.id === props.tabId))
const diff = computed(() => tab.value?.diff ?? null)

// ---------- 模式（渲染/文本，默认渲染 D4） ----------
const mode = computed(() => diff.value?.mode ?? 'render')

function setMode(m: 'render' | 'text') {
  const d = diff.value
  if (d && d.mode !== m) d.mode = m
}

// ---------- 布局 ----------
const layout = ref<'split' | 'unified'>('split')

// ---------- 行号计算 ----------
// ctx：旧 = oldStart + 之前 ctx，新 = newStart + 之前 ctx
// del：旧 = oldStart + 之前 ctx + 之前 del；新 = ''
// add：新 = newStart + 之前 ctx + 之前 add；旧 = ''
function lineNumbers(hunk: DiffHunk, li: number): { oldNo: string; newNo: string } {
  let c = 0
  let a = 0
  let d = 0
  for (let i = 0; i < li; i++) {
    const k = hunk.lines[i].kind
    if (k === 'ctx') c++
    else if (k === 'add') a++
    else d++
  }
  const kind = hunk.lines[li].kind
  const oldNo = kind === 'add' ? '' : String(hunk.oldStart + c + (kind === 'del' ? d : 0))
  const newNo = kind === 'del' ? '' : String(hunk.newStart + c + (kind === 'add' ? a : 0))
  return { oldNo, newNo }
}

// ---------- 词级渲染 ----------
function renderWords(line: DiffLine) {
  return line.words && line.words.length > 0 ? line.words : null
}

// ---------- hunk 折叠 ----------
// 预处理：hunk.lines 中连续 ctx 段超过阈值 → 折叠中间
// M16：unified diff 使用 -U3 上下文，单 hunk 内 ctx 段最多 6 行 → 阈值 10 永不触发（死功能）；
//   改为 3：同一 hunk 内被两次修改夹住的 ctx 段（>3 行）即可折叠
const FOLD_THRESHOLD = 3
const FOLD_KEEP = 2

interface FoldedSegment {
  kind: 'ctx-run' | 'line'
  line?: DiffLine
  count?: number
  /** ctx-run 段的折叠状态（true = 折叠中） */
  folded?: boolean
  start?: number
}

const foldedMap = ref<Record<string, boolean>>({})

function buildSegments(hunkIdx: number, hunk: DiffHunk): FoldedSegment[] {
  const segs: FoldedSegment[] = []
  let run: DiffLine[] = []
  let runStart = 0
  const flush = () => {
    if (run.length > FOLD_THRESHOLD) {
      const key = `${hunkIdx}-${runStart}`
      segs.push({
        kind: 'ctx-run',
        count: run.length,
        folded: foldedMap.value[key] !== false,
        start: runStart,
      })
    } else {
      for (const l of run) segs.push({ kind: 'line', line: l })
    }
    run = []
  }
  for (let i = 0; i < hunk.lines.length; i++) {
    const l = hunk.lines[i]
    if (l.kind === 'ctx') {
      if (run.length === 0) runStart = i
      run.push(l)
    } else {
      flush()
      segs.push({ kind: 'line', line: l })
    }
  }
  flush()
  return segs
}

function toggleFold(hunkIdx: number, start: number) {
  const key = `${hunkIdx}-${start}`
  foldedMap.value[key] = foldedMap.value[key] === false
}

function foldedCtxLines(hunk: DiffHunk, start: number, count: number): DiffLine[] {
  // 折叠显示：前 FOLD_KEEP + 后 FOLD_KEEP（中间按钮表示）
  const head = hunk.lines.slice(start, start + FOLD_KEEP)
  const tail = hunk.lines.slice(start + count - FOLD_KEEP, start + count)
  return [...head, ...tail]
}

// ---------- 导航 ----------
const activeHunk = ref(0)
const hunkEls = ref<HTMLElement[]>([])

const navCount = computed(() => diff.value?.hunks.length ?? 0)

function goHunk(delta: number) {
  if (navCount.value === 0) return
  activeHunk.value = (activeHunk.value + delta + navCount.value) % navCount.value
  hunkEls.value[activeHunk.value]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onHunkMounted(el: unknown, idx: number) {
  if (el instanceof HTMLElement) hunkEls.value[idx] = el
}

watch(
  () => diff.value?.hunks,
  () => {
    activeHunk.value = 0
    hunkEls.value = []
    foldedMap.value = {}
  }
)

// ---------- 快捷键 ----------
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    void closeGitDiff(props.tabId)
  } else if (e.key === 'F7') {
    e.preventDefault()
    goHunk(e.shiftKey ? -1 : 1)
  } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'u') {
    e.preventDefault()
    layout.value = layout.value === 'split' ? 'unified' : 'split'
  } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
    e.preventDefault()
    setMode(mode.value === 'render' ? 'text' : 'render')
  }
}

watch(
  () => tab.value?.viewMode,
  (m) => {
    if (m === 'diff') {
      window.addEventListener('keydown', onKeydown)
      void nextTick(() => {
        if (navCount.value > 0) hunkEls.value[0]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  },
  { immediate: true }
)

const emptyState = computed(() => {
  const d = diff.value
  if (!d) return '加载中…'
  if (d.loading) return '加载中…'
  if (!d.exists) return '文件已删除（或路径不存在）'
  if (d.hunks.length === 0) return '没有改动 ✓'
  return null
})

// ---------- M11d：还原（仅工作区 diff 可还原） ----------
const canDiscard = computed(() => diff.value?.base.from === null && !diff.value?.loading)
</script>

<template>
  <div v-if="diff" class="git-diff-view">
    <!-- 工具栏 -->
    <div class="diff-toolbar">
      <span class="diff-path" :title="diff.path">{{ diff.path }}</span>
      <span class="diff-base">{{ diff.base.label }}</span>
      <span v-if="!diff.loading" class="diff-stats">
        <span class="stat-add">+{{ diff.added }}</span>
        <span class="stat-del">−{{ diff.deleted }}</span>
        <span class="stat-hunks">{{ navCount }} 处改动</span>
      </span>
      <span class="spacer"></span>
      <button class="mini" title="上一处改动 (Shift+F7)" :disabled="navCount === 0" @click="goHunk(-1)">◀</button>
      <span class="nav-count">{{ activeHunk + 1 }}/{{ navCount }}</span>
      <button class="mini" title="下一处改动 (F7)" :disabled="navCount === 0" @click="goHunk(1)">▶</button>
      <span class="sep"></span>
      <button
        class="mini"
        :class="{ active: layout === 'split' }"
        title="分栏视图（左旧右新）"
        @click="layout = 'split'"
      >
        分栏
      </button>
      <button
        class="mini"
        :class="{ active: layout === 'unified' }"
        title="统一视图 (Ctrl+Shift+U)"
        @click="layout = 'unified'"
      >
        统一
      </button>
      <span class="sep"></span>
      <button
        class="mini"
        :class="{ active: mode === 'render' }"
        title="渲染模式：单栏融合视图（mermaid/嵌入真实渲染）"
        @click="setMode('render')"
      >
        渲染
      </button>
      <button
        class="mini"
        :class="{ active: mode === 'text' }"
        title="文本模式 (Ctrl+Shift+R)"
        @click="setMode('text')"
      >
        文本
      </button>
      <span class="sep"></span>
      <button
        class="mini danger"
        :disabled="!canDiscard"
        title="还原整个文件到 HEAD（丢弃全部未提交改动）"
        @click="discardFileDiff(tabId)"
      >
        还原…
      </button>
      <button class="mini" title="关闭 diff (Esc)" @click="closeGitDiff(tabId)">✕</button>
    </div>

    <!-- 内容 -->
    <div v-if="mode === 'render'" class="diff-body render">
      <div v-if="emptyState" class="diff-empty">{{ emptyState }}</div>
      <RenderDiff v-else :tab-id="tabId" />
    </div>
    <div v-else class="diff-body">
      <div v-if="emptyState" class="diff-empty">{{ emptyState }}</div>
      <template v-else>
        <div
          v-for="(hunk, hi) in diff.hunks"
          :key="hi"
          :ref="(el) => onHunkMounted(el, hi)"
          class="diff-hunk"
          :class="{ active: hi === activeHunk }"
        >
          <div class="hunk-meta">
            <span>@@ -{{ hunk.oldStart }},{{ hunk.oldLines }} +{{ hunk.newStart }},{{ hunk.newLines }} @@</span>
            <button
              v-if="canDiscard"
              class="hunk-discard"
              title="还原这段改动到 HEAD"
              @click.stop="discardHunkDiff(tabId, hi)"
            >
              ↩ 还原此段
            </button>
          </div>

          <!-- 分栏：左旧右新 -->
          <template v-if="layout === 'split'">
            <template v-for="(seg, si) in buildSegments(hi, hunk)" :key="si">
              <template v-if="seg.kind === 'ctx-run'">
                <div
                  v-for="l in seg.folded ? foldedCtxLines(hunk, seg.start, seg.count) : hunk.lines.slice(seg.start, seg.start + seg.count)"
                  :key="'c' + (hunk.lines.indexOf(l))"
                  class="diff-row split"
                >
                  <span class="line-no old">{{ lineNumbers(hunk, hunk.lines.indexOf(l)).oldNo }}</span>
                  <span class="cell ctx"><span class="line-text">{{ l.text }}</span></span>
                  <span class="line-no new">{{ lineNumbers(hunk, hunk.lines.indexOf(l)).newNo }}</span>
                  <span class="cell ctx"><span class="line-text">{{ l.text }}</span></span>
                </div>
                <div v-if="seg.folded" class="fold-bar" @click="toggleFold(hi, seg.start)">
                  ⋯ 相同 {{ seg.count }} 行
                </div>
                <div v-else class="fold-bar" @click="toggleFold(hi, seg.start)">
                  ▲ 收起
                </div>
              </template>
              <div v-else class="diff-row split">
                <span class="line-no old">{{ lineNumbers(hunk, hunk.lines.indexOf(seg.line!)).oldNo }}</span>
                <span class="cell" :class="seg.line!.kind">
                  <template v-if="seg.line!.kind !== 'add'">
                    <span v-if="renderWords(seg.line!)" class="line-text">
                      <span v-for="(w, wi) in renderWords(seg.line!)" :key="wi" class="word" :class="'word-' + w.kind">{{ w.text }}</span>
                    </span>
                    <span v-else class="line-text">{{ seg.line!.text }}</span>
                  </template>
                </span>
                <span class="line-no new">{{ lineNumbers(hunk, hunk.lines.indexOf(seg.line!)).newNo }}</span>
                <span class="cell" :class="seg.line!.kind">
                  <template v-if="seg.line!.kind !== 'del'">
                    <span v-if="renderWords(seg.line!)" class="line-text">
                      <span v-for="(w, wi) in renderWords(seg.line!)" :key="wi" class="word" :class="'word-' + w.kind">{{ w.text }}</span>
                    </span>
                    <span v-else class="line-text">{{ seg.line!.text }}</span>
                  </template>
                </span>
              </div>
            </template>
          </template>

          <!-- 统一：单列 -->
          <template v-else>
            <template v-for="(seg, si) in buildSegments(hi, hunk)" :key="si">
              <template v-if="seg.kind === 'ctx-run'">
                <div
                  v-for="l in seg.folded ? foldedCtxLines(hunk, seg.start, seg.count) : hunk.lines.slice(seg.start, seg.start + seg.count)"
                  :key="'c' + (hunk.lines.indexOf(l))"
                  class="diff-row unified"
                >
                  <span class="line-no old">{{ lineNumbers(hunk, hunk.lines.indexOf(l)).oldNo }}</span>
                  <span class="line-no new">{{ lineNumbers(hunk, hunk.lines.indexOf(l)).newNo }}</span>
                  <span class="line-sign"> </span>
                  <span class="cell ctx"><span class="line-text">{{ l.text }}</span></span>
                </div>
                <div v-if="seg.folded" class="fold-bar" @click="toggleFold(hi, seg.start)">
                  ⋯ 相同 {{ seg.count }} 行
                </div>
                <div v-else class="fold-bar" @click="toggleFold(hi, seg.start)">
                  ▲ 收起
                </div>
              </template>
              <div v-else class="diff-row unified">
                <span class="line-no old">{{ lineNumbers(hunk, hunk.lines.indexOf(seg.line!)).oldNo }}</span>
                <span class="line-no new">{{ lineNumbers(hunk, hunk.lines.indexOf(seg.line!)).newNo }}</span>
                <span class="line-sign">{{ seg.line!.kind === 'add' ? '+' : seg.line!.kind === 'del' ? '−' : ' ' }}</span>
                <span class="cell" :class="seg.line!.kind">
                  <span v-if="renderWords(seg.line!)" class="line-text">
                    <span v-for="(w, wi) in renderWords(seg.line!)" :key="wi" class="word" :class="'word-' + w.kind">{{ w.text }}</span>
                  </span>
                  <span v-else class="line-text">{{ seg.line!.text }}</span>
                </span>
              </div>
            </template>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.git-diff-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--chrome-background, #fff);
  font-family: ui-monospace, SFMono-Regular, 'Cascadia Code', Consolas, monospace;
}
.diff-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--chrome-border);
  background: var(--chrome-surface);
  flex-shrink: 0;
  font-size: 12px;
}
.diff-path {
  font-weight: 600;
  max-width: 34%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff-base {
  color: var(--chrome-on-surface-variant);
  background: var(--chrome-selected);
  padding: 1px 8px;
  border-radius: 999px;
}
.diff-stats {
  display: flex;
  gap: 8px;
  color: var(--chrome-on-surface-variant);
}
.stat-add {
  color: #2e7d32;
}
.stat-del {
  color: var(--chrome-error, #ba1a1a);
}
.spacer {
  flex: 1;
}
.mini {
  border: 1px solid var(--chrome-border);
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.mini:hover:not(:disabled) {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
.mini.active {
  background: var(--chrome-selected);
  color: var(--chrome-primary);
  border-color: var(--chrome-primary);
}
.mini:disabled {
  opacity: 0.4;
  cursor: default;
}
.mini.danger {
  color: var(--chrome-error, #ba1a1a);
  border-color: color-mix(in srgb, var(--chrome-error, #ba1a1a), transparent 60%);
}
.mini.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--chrome-error, #ba1a1a), transparent 90%);
}
.hunk-meta {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--chrome-selected);
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  padding: 2px 12px;
  border-radius: 4px;
  margin: 0 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.hunk-discard {
  border: 1px solid color-mix(in srgb, var(--chrome-error, #ba1a1a), transparent 50%);
  background: transparent;
  color: var(--chrome-error, #ba1a1a);
  font-size: 10.5px;
  padding: 1px 8px;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
}
.hunk-discard:hover {
  background: color-mix(in srgb, var(--chrome-error, #ba1a1a), transparent 88%);
}
.nav-count {
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
  min-width: 30px;
  text-align: center;
}
.sep {
  width: 1px;
  height: 16px;
  background: var(--chrome-border);
}
.diff-body {
  flex: 1;
  overflow: auto;
  padding: 4px 0 24px;
}
.diff-empty {
  padding: 40px 16px;
  text-align: center;
  color: var(--chrome-on-surface-variant);
  font-size: 13px;
}
.diff-hunk {
  margin: 10px 0;
}
.diff-hunk.active .hunk-meta {
  box-shadow: 0 0 0 2px var(--chrome-primary);
}
/* ---- 分栏 ---- */
.diff-row.split {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px minmax(0, 1fr);
  align-items: stretch;
  font-size: 12.5px;
  line-height: 1.6;
}
.diff-row.split .cell {
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
/* ---- 统一 ---- */
.diff-row.unified {
  display: grid;
  grid-template-columns: 44px 44px 16px minmax(0, 1fr);
  align-items: stretch;
  font-size: 12.5px;
  line-height: 1.6;
}
.diff-row.unified .cell {
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.line-no {
  color: var(--chrome-on-surface-variant);
  opacity: 0.7;
  font-size: 11px;
  user-select: none;
  text-align: right;
  padding-right: 8px;
  padding-top: 1px;
  background: inherit;
}
.line-sign {
  text-align: center;
  user-select: none;
  opacity: 0.8;
}
.line-text {
  padding-right: 12px;
  padding-left: 6px;
}
/* 整行底色 */
.cell.add {
  background: color-mix(in srgb, #2e7d32, transparent 88%);
}
.cell.del {
  background: color-mix(in srgb, var(--chrome-error, #ba1a1a), transparent 88%);
}
/* 词级高亮 */
.word-del {
  background: color-mix(in srgb, var(--chrome-error, #ba1a1a), transparent 70%);
  text-decoration: line-through;
  font-weight: 600;
}
.word-add {
  background: color-mix(in srgb, #2e7d32, transparent 70%);
  font-weight: 600;
}
/* 折叠条 */
.fold-bar {
  text-align: center;
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
  background: var(--chrome-selected);
  border-radius: 4px;
  margin: 2px 6px;
  padding: 2px;
  cursor: pointer;
  user-select: none;
}
.fold-bar:hover {
  background: var(--chrome-hover);
  color: var(--chrome-primary);
}
</style>
