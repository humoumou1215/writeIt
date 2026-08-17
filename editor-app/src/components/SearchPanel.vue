<script setup lang="ts">
// 全局搜索面板（M15 补全）—— 侧栏第三个 tab（图标列 🔍 / Ctrl+Shift+F 打开）
//  - 输入即搜（220ms 防抖）：遍历工作区可编辑文件全文匹配（忽略大小写 / Aa 开关）
//  - 结果按文件分组展示；点击/Enter 跳转 → scrollToSearchMatch 按 occurrence 精确定位 + 编辑器内高亮
//  - 内置替换：替换当前命中 / 全部替换（写磁盘后同步已打开的标签）
//  - ↑↓ 在结果间移动选择；Esc 依次清空查询、清空替换词、收起侧栏
import { computed, nextTick, ref, watch } from 'vue'
import { state, toast, confirmDialog } from '../state/store'
import { settings } from '../state/settings'
import { fs } from '../fs'
import MenuIcon from './MenuIcon.vue'
import {
  searchWorkspace,
  highlightSegments,
  replaceInContent,
  readSearchDiskContent,
  invalidateSearchCache,
  type SearchFileGroup,
  type SearchHit,
} from '../search'

const query = ref('')
const caseSensitive = ref(false)
const replaceText = ref('')
const groups = ref<SearchFileGroup[]>([])
const searching = ref(false)
const searched = ref(false)
const replacing = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0
const inputEl = ref<HTMLInputElement | null>(null)

const totalHits = computed(() => groups.value.reduce((n, g) => n + g.hits.length, 0))
const totalFiles = computed(() => groups.value.length)

// 扁平命中索引（键盘导航用）
const flat = computed<{ group: SearchFileGroup; hit: SearchHit }[]>(() => {
  const out: { group: SearchFileGroup; hit: SearchHit }[] = []
  for (const g of groups.value) for (const h of g.hits) out.push({ group: g, hit: h })
  return out
})
const selected = ref(0)
const selectedHit = computed(() => flat.value[selected.value] ?? null)

function runSearch() {
  const q = query.value
  const cs = caseSensitive.value
  const mySeq = ++seq
  searched.value = true
  selected.value = 0
  if (!q.trim()) {
    groups.value = []
    searching.value = false
    return
  }
  searching.value = true
  void searchWorkspace(q, { caseSensitive: cs }).then((res) => {
    if (mySeq !== seq) return
    groups.value = res
    searching.value = false
  })
}
function scheduleSearch() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runSearch, 220)
}
function onInput() {
  scheduleSearch()
}
// —— 大小写开关：v-model 已同步值；显式读 checkbox（避免与 v-model 顺序耦合）并重跑 ——
function onToggleCase(e: Event) {
  caseSensitive.value = (e.target as HTMLInputElement).checked
  runSearch()
}
function onReplaceInput() {
  /* 占位：替换词输入无副作用 */
}

// ---------- 跳转 ----------
/** 打开并滚动到命中处（occurrence 精确定位 + 编辑器内高亮） */
function go(hit: SearchHit) {
  document.addEventListener('mousedown', cancelRefocus, { once: true })
  void import('../editor/manager').then((m) =>
    m
      .scrollToSearchMatch(hit.path, hit.line, hit.keyword, {
        occurrence: hit.occurrence,
        caseSensitive: caseSensitive.value,
        before: hit.before,
        after: hit.after,
      })
      .finally(() => {
        // 跳转落定后再把焦点还给搜索框（编辑器异步挂载可能在滚动完成后才聚焦）
        refocusRetry(150)
        refocusRetry(500)
      })
  )
}

let refocusTimer: ReturnType<typeof setTimeout> | null = null
function refocusRetry(delay: number) {
  refocusTimer = setTimeout(() => {
    const el = document.activeElement as HTMLElement | null
    const inEditor = !!el && (el.classList.contains('ProseMirror') || !!el.closest?.('.milkdown'))
    if (inEditor) inputEl.value?.focus()
  }, delay)
}
function cancelRefocus() {
  document.removeEventListener('mousedown', cancelRefocus)
  if (refocusTimer) clearTimeout(refocusTimer)
  refocusTimer = null
}

function onHitClick(gi: number, hi: number) {
  selected.value = flatIndex(gi, hi)
  const g = groups.value[gi]
  if (g) go(g.hits[hi])
}
function flatIndex(gi: number, hi: number): number {
  let n = 0
  for (let i = 0; i < gi; i++) n += groups.value[i]?.hits.length ?? 0
  return n + hi
}

// ---------- 替换 ----------
/** 对每个命中文件按当前关键词/大小写执行替换（全部 或 选中这次出现） */
async function doReplace(scope: 'selected' | 'all') {
  const q = query.value.trim()
  if (!q || !groups.value.length || replacing.value) return
  if (!replaceText.value && q !== replaceText.value) {
    // 允许替换为空串（删除关键词）
  }
  if (scope === 'all') {
    const ok = await confirmDialog({
      title: '全部替换',
      message: `把 ${totalFiles.value} 个文件中的「${q}」全部替换为「${replaceText.value}」（共 ${totalHits.value} 处匹配）。此操作会写入磁盘，确认继续？`,
      confirmText: '全部替换',
      danger: true,
    })
    if (!ok) return
  }
  replacing.value = true
  try {
    const updated = new Map<string, string>()
    let replacedCount = 0
    for (const g of groups.value) {
      let content: string
      try {
        content = await readSearchDiskContent(g.path)
      } catch {
        continue
      }
      const res =
        scope === 'selected' && selectedHit.value && selectedHit.value.group.path === g.path
          ? replaceInContent(content, q, replaceText.value, {
              caseSensitive: caseSensitive.value,
              occurrence: selectedHit.value.hit.occurrence,
            })
          : replaceInContent(content, q, replaceText.value, {
              caseSensitive: caseSensitive.value,
            })
      if (res.count > 0) {
        updated.set(g.path, res.content)
        replacedCount += res.count
      }
    }
    // 写盘 → 同步已打开标签（跳过有未保存编辑的）
    for (const [p, c] of updated) {
      try {
        await fs.writeFile(p, c)
      } catch (e) {
        toast(`写入失败 ${p}: ${(e as Error).message}`, 'error')
      }
    }
    if (updated.size) {
      const { syncTabsAfterReplace } = await import('../editor/manager')
      const skipped = await syncTabsAfterReplace(updated)
      // 写盘后使搜索内容缓存失效（下次搜索读到新内容）
      invalidateSearchCache()
      const skipNote = skipped.length ? `；跳过未保存标签 ${skipped.length} 个` : ''
      toast(
        scope === 'all'
          ? `已替换 ${replacedCount} 处（${updated.size} 个文件）${skipNote}`
          : `已替换选中的 1 处${skipNote}`,
        'success'
      )
      runSearch() // 重新搜索（命中随内容变化）
    } else {
      toast('没有可替换的匹配', 'info')
    }
  } finally {
    replacing.value = false
  }
}

// ---------- 键盘 ----------
function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    const cur = flat.value[selected.value]
    if (cur) go(cur.hit)
    else if (groups.value.length) go(groups.value[0].hits[0])
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (flat.value.length) selected.value = (selected.value + 1) % flat.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (flat.value.length) selected.value = (selected.value - 1 + flat.value.length) % flat.value.length
  } else if (e.key === 'Escape') {
    e.preventDefault()
    collapseStep()
  }
}
function onReplaceKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) void doReplace('all')
    else void doReplace('selected')
  } else if (e.key === 'Escape') {
    e.preventDefault()
    if (replaceText.value) replaceText.value = ''
    else inputEl.value?.focus()
  }
}
/** Esc 三级：清空查询 → 清空替换词 → 收起侧栏 */
function collapseStep() {
  if (query.value) {
    query.value = ''
    seq++
    groups.value = []
    searched.value = false
    selected.value = 0
    inputEl.value?.focus()
  } else if (replaceText.value) {
    replaceText.value = ''
  } else {
    state.sidebarCollapsed = true
  }
}
function onClear() {
  query.value = ''
  replaceText.value = ''
  seq++
  groups.value = []
  searched.value = false
  selected.value = 0
  inputEl.value?.focus()
}

// ---------- 激活时自动聚焦 ----------
watch(
  () => state.gitPanel.tab === 'search' && !state.sidebarCollapsed,
  (active) => {
    if (active) {
      nextTick(() => {
        inputEl.value?.focus()
        inputEl.value?.select()
      })
    }
  },
  { immediate: true }
)
watch(
  () => state.treeVersion,
  () => scheduleSearch()
)
watch(selected, () => {
  const el = document.querySelector('.sp-hit.sel')
  el?.scrollIntoView({ block: 'nearest' })
})
</script>

<template>
  <div class="search-panel" data-search-panel>
    <!-- 搜索输入 + 选项 -->
    <div class="sp-input-row">
      <div class="sp-input-wrap">
        <svg class="sp-lens" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="6" />
          <path d="M14.5 14.5 20 20" />
        </svg>
        <input
          ref="inputEl"
          v-model="query"
          class="sp-input"
          type="text"
          placeholder="搜索全部文档内容…"
          spellcheck="false"
          @input="onInput"
          @keydown="onInputKeydown"
        />
        <button v-if="query || searched" class="sp-clear" title="清空 (Esc)" @click="onClear">✕</button>
      </div>
      <div class="sp-opt-row">
        <label class="sp-opt" :class="{ on: caseSensitive }" title="区分大小写">
          <input type="checkbox" :checked="caseSensitive" @change="onToggleCase" />
          <span>Aa</span>
        </label>
      </div>
    </div>

    <!-- 替换行（有查询与结果时出现） -->
    <div v-if="query.trim() && !searching" class="sp-replace-row">
      <input
        v-model="replaceText"
        class="sp-rinput"
        type="text"
        placeholder="替换为…（Enter 替换当前，Ctrl+Enter 全部替换）"
        spellcheck="false"
        @input="onReplaceInput"
        @keydown="onReplaceKeydown"
      />
      <button
        class="sp-btn"
        :disabled="replacing || !totalHits"
        :title="selectedHit ? `替换选中命中（每组第 ${selected + 1} 处）` : '替换选中命中'"
        @click="doReplace('selected')"
      >
        替换
      </button>
      <button
        class="sp-btn danger"
        :disabled="replacing || !totalHits"
        title="替换当前结果中的全部匹配（写盘并同步打开标签）"
        @click="doReplace('all')"
      >
        全部替换
      </button>
    </div>

    <!-- 状态行 -->
    <div class="sp-status">
      <template v-if="!query.trim()">
        输入关键词全文搜索
        <span class="sp-keys"><kbd>Enter</kbd> 跳转 · <kbd>↑↓</kbd> 选择 · <kbd>Esc</kbd> 关闭</span>
      </template>
      <template v-else-if="searching">搜索中…</template>
      <template v-else-if="searched && !totalHits">无匹配结果</template>
      <template v-else-if="totalHits">
        <span class="sp-count">{{ totalHits }} 处匹配</span>
        <span v-if="totalFiles > 1" class="sp-files">· {{ totalFiles }} 个文件</span>
      </template>
    </div>

    <!-- 结果 -->
    <div class="sp-results" data-sp-results>
      <div v-for="(g, gi) in groups" :key="g.path" class="sp-group">
        <div class="sp-file">
          <MenuIcon name="file" :set="settings.iconSet" :size="12" />
          <span class="sp-file-path" :title="g.path">{{ g.path }}</span>
          <span class="sp-file-count">{{ g.hits.length }}</span>
        </div>
        <div
          v-for="(h, hi) in g.hits"
          :key="h.path + h.lineNo"
          class="sp-hit"
          :class="{ sel: selected === flatIndex(gi, hi) }"
          :data-line="h.lineNo"
          @click="onHitClick(gi, hi)"
        >
          <span class="sp-line-no">{{ h.lineNo }}</span>
          <span class="sp-line" :title="h.line">
            <template
              v-for="(seg, si) in highlightSegments(h.line, h.keyword, caseSensitive)"
              :key="si"
            >
              <mark v-if="seg.hit" class="sp-mark">{{ seg.text }}</mark>
              <template v-else>{{ seg.text }}</template>
            </template>
          </span>
        </div>
      </div>
      <p v-if="query.trim() && searched && !searching && !groups.length" class="sp-empty">
        <span class="sp-empty-icon">◌</span>
        没有找到包含「{{ query.trim() }}」的文档
      </p>
    </div>
  </div>
</template>

<style scoped>
.search-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 6px 6px 12px;
  font-size: 12.5px;
  gap: 6px;
}

/* ---- 输入行 ---- */
.sp-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 2px 0;
}
.sp-input-wrap {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
}
.sp-lens {
  position: absolute;
  left: 8px;
  width: 13px;
  height: 13px;
  stroke: var(--chrome-on-surface-variant);
  stroke-width: 1.8;
  stroke-linecap: round;
  pointer-events: none;
  transition: stroke 0.15s ease;
}
.sp-input:focus ~ .sp-lens,
.sp-input-wrap:focus-within .sp-lens {
  stroke: var(--chrome-primary);
}
.sp-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--chrome-border);
  background: var(--chrome-background);
  color: var(--chrome-on-background);
  border-radius: 7px;
  font-size: 12.5px;
  padding: 5px 26px 5px 26px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.sp-input:focus {
  border-color: var(--chrome-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--chrome-primary) 24%, transparent);
}
.sp-clear {
  position: absolute;
  right: 4px;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sp-clear:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}

/* ---- 选项 ---- */
.sp-opt-row {
  flex: none;
}
.sp-opt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  border: 1px solid var(--chrome-border);
  border-radius: 7px;
  cursor: pointer;
  user-select: none;
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  font-weight: 600;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.sp-opt input {
  display: none;
}
.sp-opt:hover {
  border-color: var(--chrome-primary);
  color: var(--chrome-primary);
}
.sp-opt.on {
  border-color: var(--chrome-primary);
  color: var(--chrome-primary);
  background: var(--chrome-selected);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--chrome-primary) 18%, transparent);
}

/* ---- 替换行 ---- */
.sp-replace-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 2px 0;
}
.sp-rinput {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  border: 1px dashed var(--chrome-border);
  background: var(--chrome-surface);
  color: var(--chrome-on-background);
  border-radius: 6px;
  font-size: 11.5px;
  padding: 4px 8px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
}
.sp-rinput:focus {
  border-style: solid;
  border-color: var(--chrome-primary);
}
.sp-rinput::placeholder {
  color: var(--chrome-on-surface-variant);
  opacity: 0.7;
}
.sp-btn {
  flex: none;
  border: 1px solid var(--chrome-border);
  background: var(--chrome-surface);
  color: var(--chrome-on-surface);
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.13s ease;
}
.sp-btn:hover:not(:disabled) {
  border-color: var(--chrome-primary);
  color: var(--chrome-primary);
  background: var(--chrome-selected);
}
.sp-btn.danger:hover:not(:disabled) {
  border-color: var(--chrome-error, #ba1a1a);
  color: var(--chrome-error, #ba1a1a);
  background: color-mix(in srgb, var(--chrome-error, #ba1a1a) 10%, transparent);
}
.sp-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

/* ---- 状态行 ---- */
.sp-status {
  padding: 0 4px;
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  min-height: 15px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.sp-keys {
  color: var(--chrome-on-surface-variant);
  opacity: 0.65;
}
.sp-keys kbd {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 9.5px;
  border: 1px solid var(--chrome-border);
  border-radius: 4px;
  padding: 0 3px;
  background: var(--chrome-surface);
}
.sp-count {
  color: var(--chrome-primary);
  font-weight: 600;
}
.sp-files {
  opacity: 0.8;
}

/* ---- 结果区 ---- */
.sp-results {
  flex: 1;
  overflow: auto;
  min-height: 0;
  padding-bottom: 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--chrome-border) transparent;
}
.sp-group {
  margin-bottom: 4px;
}
.sp-file {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: color-mix(in srgb, var(--chrome-surface) 92%, transparent);
  backdrop-filter: blur(3px);
  border-bottom: 1px solid var(--chrome-border-light);
  border-radius: 6px 6px 0 0;
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
  user-select: none;
}
.sp-file .mi {
  color: var(--chrome-primary);
  opacity: 0.85;
  flex: none;
}
.sp-file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, Consolas, monospace;
}
.sp-file-count {
  flex: none;
  background: var(--chrome-selected);
  color: var(--chrome-primary);
  border-radius: 999px;
  padding: 0 7px;
  font-weight: 600;
  font-size: 10px;
  line-height: 15px;
}
.sp-hit {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2.5px 8px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
}
.sp-hit:hover {
  background: var(--chrome-hover);
}
.sp-hit.sel {
  background: var(--chrome-selected);
  outline: 1px solid var(--chrome-primary);
  outline-offset: -1px;
}
.sp-line-no {
  flex: none;
  min-width: 26px;
  text-align: right;
  font-size: 10px;
  font-family: ui-monospace, Consolas, monospace;
  color: var(--chrome-on-surface-variant);
  opacity: 0.75;
}
.sp-hit.sel .sp-line-no {
  color: var(--chrome-primary);
  opacity: 1;
}
.sp-line {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11.5px;
  color: var(--chrome-on-background);
}
.sp-mark {
  background: rgba(232, 118, 42, 0.3);
  color: #b45309;
  font-weight: 600;
  border-radius: 3px;
  padding: 0 1px;
  box-decoration-break: clone;
  box-shadow: 0 0 0 1px rgba(232, 118, 42, 0.25);
  transition: background 0.15s ease, color 0.15s ease;
}
/* 选中命中：橙红实底 + 白字 + 微弱呼吸闪烁 */
.sp-hit.sel .sp-mark {
  background: #e0582c;
  color: #fff;
  font-weight: 700;
  box-shadow: 0 0 0 1px rgba(224, 88, 44, 0.6);
  animation: sp-mark-pulse 1.8s ease-in-out infinite;
}
@keyframes sp-mark-pulse {
  0%, 100% {
    box-shadow: 0 0 0 1px rgba(224, 88, 44, 0.5), 0 0 2px rgba(224, 88, 44, 0.35);
  }
  50% {
    box-shadow: 0 0 0 2px rgba(224, 88, 44, 0.8), 0 0 8px rgba(224, 88, 44, 0.6);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sp-hit.sel .sp-mark {
    animation: none !important;
  }
}
.sp-empty {
  padding: 22px 10px;
  color: var(--chrome-on-surface-variant);
  font-size: 12px;
  text-align: center;
  border: 1px dashed var(--chrome-border);
  border-radius: 8px;
  margin: 6px 4px;
}
.sp-empty-icon {
  display: block;
  font-size: 18px;
  margin-bottom: 6px;
  opacity: 0.5;
}
</style>