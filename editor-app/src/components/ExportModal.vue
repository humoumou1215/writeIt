<script setup lang="ts">
// 导出弹窗（M10）：图标列 📤 独立入口
// 布局：左侧文件树（多选 + 筛选）· 右侧已选文件列表（每文件独立导出模式）
// 每文件格式：有模板 export.ts → 默认「模板(export.ts)」；无 → 默认 PDF
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { state } from '../state/store'
import { getActiveTabMarkdown, getTabMarkdownByPath } from '../editor/manager'
import { extractDoctype, templateService } from '../template/service'
import { exportFiles } from '../export/service'
import type { ExportChoice, ExportFormat } from '../export/types'
import type { FsEntry } from '../fs/types'
import { fs } from '../fs'

const emit = defineEmits<{ (e: 'close'): void }>()

const activeTab = computed(() => state.tabs.find((t) => t.id === state.activeTabId) ?? null)
const exportDoctype = computed(() => {
  const t = activeTab.value
  if (!t) return null
  const md = getActiveTabMarkdown() ?? t.savedContent
  return extractDoctype(md)
})
const exportHasTs = computed(() => {
  const dt = exportDoctype.value
  if (!dt) return false
  return Boolean(templateService.get(dt)?.exportFile)
})

const exporting = ref(false)

// ---------- 多文件选择 ----------
const selected = ref<string[]>([])
/** 每文件导出模式：path → ExportChoice */
const formats = ref<Record<string, ExportChoice>>({})
const filterQuery = ref('')
const expanded = ref(new Set<string>())

// 默认选中当前打开的文件 + 展开其祖先目录（让勾选可见）
onMounted(() => {
  const p = activeTab.value?.path
  if (p) {
    selected.value = [p]
    const dirs = p.split('/').slice(0, -1)
    let acc = ''
    for (const d of dirs) {
      acc = acc ? `${acc}/${d}` : d
      expanded.value.add(acc)
    }
    expanded.value = new Set(expanded.value)
  }
})

/** 文件是否有模板 export.ts（读内容 → doctype → 模板注册表） */
async function fileHasExportTs(path: string): Promise<boolean> {
  try {
    const content = getTabMarkdownByPath(path) ?? (await fs.readFile(path))
    const dt = extractDoctype(content)
    return dt ? Boolean(templateService.get(dt)?.exportFile) : false
  } catch {
    return false
  }
}

/** 勾选变化：新增文件初始化默认格式（有 export.ts → 模板；否则 PDF） */
watch(selected, async (paths) => {
  const pending: Promise<void>[] = []
  for (const p of paths) {
    if (p in formats.value) continue
    pending.push(
      (async () => {
        const hasTs = await fileHasExportTs(p)
        formats.value = { ...formats.value, [p]: hasTs ? 'export' : 'pdf' }
      })()
    )
  }
  for (const k of Object.keys(formats.value)) {
    if (!paths.includes(k)) {
      const next = { ...formats.value }
      delete next[k]
      formats.value = next
    }
  }
  await Promise.all(pending)
})

/** 格式选项：有 export.ts 的文件多一个「模板」选项 */
function formatOptions(path: string): Array<{ value: ExportChoice; label: string }> {
  const hasTs = formats.value[path] === 'export' || hasTsSync(path)
  const opts: Array<{ value: ExportChoice; label: string }> = []
  if (hasTs) opts.push({ value: 'export', label: '模板(export.ts)' })
  opts.push({ value: 'pdf', label: 'PDF' }, { value: 'docx', label: 'DOCX' }, { value: 'md', label: 'Markdown' })
  return opts
}
/** 同步判断（格式已初始化为 export 或读内容失败时兜底） */
function hasTsSync(path: string): boolean {
  try {
    const content = getTabMarkdownByPath(path)
    if (content === null) return false
    const dt = extractDoctype(content)
    return dt ? Boolean(templateService.get(dt)?.exportFile) : false
  } catch {
    return false
  }
}

function setFormat(path: string, f: ExportChoice) {
  formats.value = { ...formats.value, [path]: f }
}

function toggleDir(path: string) {
  const s = new Set(expanded.value)
  if (s.has(path)) s.delete(path)
  else s.add(path)
  expanded.value = s
}

/** 拍平可见条目（按展开状态） */
function flatVisible(list: FsEntry[], depth: number, out: Array<{ e: FsEntry; depth: number }>) {
  for (const e of list) {
    out.push({ e, depth })
    if (e.kind === 'dir' && expanded.value.has(e.path)) flatVisible(e.children ?? [], depth + 1, out)
  }
}

/** 筛选后的可见条目：匹配文件 + 其祖先目录链（筛选时强制显示） */
const visibleEntries = computed<Array<{ e: FsEntry; depth: number }>>(() => {
  const q = filterQuery.value.trim().toLowerCase()
  const out: Array<{ e: FsEntry; depth: number }> = []
  if (!q) {
    flatVisible(state.tree, 0, out)
    return out
  }
  const matchFiles = new Set<string>()
  const matchDirs = new Set<string>()
  const collect = (list: FsEntry[], ancestors: string[]) => {
    for (const e of list) {
      if (e.kind === 'file') {
        if (e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q)) {
          matchFiles.add(e.path)
          ancestors.forEach((d) => matchDirs.add(d))
        }
      } else {
        collect(e.children ?? [], [...ancestors, e.path])
      }
    }
  }
  collect(state.tree, [])
  const walk = (list: FsEntry[], depth: number) => {
    for (const e of list) {
      if (e.kind === 'dir') {
        if (matchDirs.has(e.path)) {
          out.push({ e, depth })
          walk(e.children ?? [], depth + 1)
        }
      } else if (matchFiles.has(e.path)) {
        out.push({ e, depth })
      }
    }
  }
  walk(state.tree, 0)
  return out
})

function selectAll() {
  const files: string[] = []
  const collect = (list: FsEntry[]) => {
    for (const e of list) {
      if (e.kind === 'file') files.push(e.path)
      else collect(e.children ?? [])
    }
  }
  collect(state.tree)
  selected.value = files
}
function clearAll() {
  selected.value = []
}

/** 已选文件列表（按树中顺序展示；不在树里的文件追加在后） */
const selectedList = computed(() => {
  const order: string[] = []
  const walk = (list: FsEntry[]) => {
    for (const e of list) {
      if (e.kind === 'file' && selected.value.includes(e.path)) order.push(e.path)
      else if (e.kind === 'dir') walk(e.children ?? [])
    }
  }
  walk(state.tree)
  for (const p of selected.value) if (!order.includes(p)) order.push(p)
  return order
})

async function doExport() {
  if (exporting.value || !selected.value.length) return
  exporting.value = true
  try {
    const items = selected.value.map((p) => ({
      path: p,
      format: (formats.value[p] ?? 'pdf') as ExportChoice,
    }))
    await exportFiles(items)
  } finally {
    exporting.value = false
  }
}

function onModalKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !exporting.value) emit('close')
}
onMounted(() => window.addEventListener('keydown', onModalKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onModalKey))
</script>

<template>
  <Teleport to="body">
    <div class="modal-mask" @click.self="emit('close')">
      <div class="export-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>导出</h3>
          <div class="head-info">
            <span v-if="activeTab" class="head-path">{{ activeTab.path }}</span>
            <span v-if="activeTab" class="badge">{{ exportDoctype ?? '（无 doctype）' }}</span>
            <span v-if="exportHasTs" class="badge ts" title="当前文件模板定义了 export.ts">export.ts</span>
          </div>
          <button class="close" @click="emit('close')" title="关闭 (Esc)">×</button>
        </div>

        <div class="modal-body">
          <!-- 左：文件树（宽） -->
          <div class="export-tree">
            <div class="tree-toolbar">
              <input v-model="filterQuery" class="tree-filter" placeholder="🔍 筛选文件名…" spellcheck="false" />
              <button class="mini" @click="selectAll">全选</button>
              <button class="mini" @click="clearAll">清空</button>
            </div>
            <div class="tree-list">
              <div
                v-for="it in visibleEntries"
                :key="it.e.path"
                class="trow"
                :style="{ paddingLeft: 8 + it.depth * 16 + 'px' }"
              >
                <template v-if="it.e.kind === 'dir'">
                  <button class="caret" @click="toggleDir(it.e.path)">
                    {{ expanded.has(it.e.path) ? '▾' : '▸' }}
                  </button>
                  <span class="tname">📁 {{ it.e.name }}</span>
                </template>
                <label v-else class="tfile">
                  <input type="checkbox" :value="it.e.path" v-model="selected" />
                  <span class="tname">📄 {{ it.e.name }}</span>
                </label>
              </div>
              <p v-if="!visibleEntries.length" class="empty-hint">无匹配文件</p>
            </div>
          </div>

          <!-- 右：已选文件列表 + 每文件格式 -->
          <div class="export-right">
            <div class="right-head">已选文件（{{ selected.length }}）— 每文件独立选择导出模式</div>
            <div class="sel-list">
              <div v-for="p in selectedList" :key="p" class="sel-row">
                <span class="sel-name" :title="p">📄 {{ p.split('/').pop() }}</span>
                <select
                  class="sel-fmt"
                  :value="formats[p] ?? 'pdf'"
                  @change="setFormat(p, ($event.target as HTMLSelectElement).value as ExportChoice)"
                >
                  <option v-for="o in formatOptions(p)" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </div>
              <p v-if="!selected.length" class="empty-hint">从左侧勾选文件</p>
            </div>
            <p class="hint">
              无 export.ts 的文件默认 PDF；有 export.ts 的文件默认「模板」模式（按模板定义导出）。
              批量导出文件名沿用原文件名。
            </p>
          </div>
        </div>

        <div class="modal-foot">
          <button
            class="btn full primary"
            :disabled="!selected.length || exporting"
            @click="doExport"
          >
            {{ exporting ? '导出中…' : `📤 导出（${selected.length} 个）` }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.export-modal {
  background: var(--chrome-surface);
  color: var(--chrome-on-surface);
  border: 1px solid var(--chrome-border);
  border-radius: 12px;
  width: min(920px, 96vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--chrome-shadow-2, 0 16px 48px rgba(0, 0, 0, 0.22));
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px 0;
}
.modal-head h3 {
  margin: 0;
  font-size: 15px;
  color: var(--chrome-on-surface);
  flex-shrink: 0;
}
.head-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.head-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--chrome-on-surface-variant);
  font-family: var(--chrome-font-code, monospace);
}
.close {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 20px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
}
.close:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
.modal-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  padding: 14px 18px;
  overflow: hidden;
}
.badge {
  font-size: 11px;
  background: var(--chrome-selected);
  color: var(--chrome-on-surface);
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}
.badge.ts {
  background: var(--chrome-selected);
  color: var(--chrome-primary);
  font-family: var(--chrome-font-code, monospace);
}
/* 左：文件树 */
.export-tree {
  flex: 1.25;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  background: var(--chrome-background);
  overflow: hidden;
}
.tree-toolbar {
  display: flex;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--chrome-border);
  align-items: center;
}
.tree-filter {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--chrome-border);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  font-family: inherit;
  color: var(--chrome-on-surface);
  background: var(--chrome-background);
}
.mini {
  border: 1px solid var(--chrome-border);
  background: var(--chrome-background);
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
}
.mini:hover {
  border-color: var(--chrome-primary);
  color: var(--chrome-on-background);
}
.tree-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0;
}
.trow {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 12px;
  line-height: 1.4;
}
.trow:hover {
  background: var(--chrome-hover);
}
.caret {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 10px;
  width: 14px;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
}
.tfile {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  min-width: 0;
  flex: 1;
}
.tfile input[type='checkbox'] {
  accent-color: var(--chrome-primary);
  margin: 0;
  flex-shrink: 0;
}
.tname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--chrome-on-surface);
}
.empty-hint {
  margin: 0;
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--chrome-on-surface-variant);
}
/* 右：已选列表 */
.export-right {
  flex: 1;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.right-head {
  font-size: 12px;
  color: var(--chrome-on-surface-variant);
  padding: 2px 2px 0;
}
.sel-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  background: var(--chrome-background);
  padding: 4px 0;
}
.sel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 12px;
}
.sel-row:hover {
  background: var(--chrome-hover);
}
.sel-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--chrome-on-surface);
}
.sel-fmt {
  flex-shrink: 0;
  border: 1px solid var(--chrome-border);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 12px;
  font-family: inherit;
  color: var(--chrome-on-surface);
  background: var(--chrome-background);
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
  line-height: 1.6;
}
.modal-foot {
  padding: 0 18px 16px;
}
.btn {
  border: 1px solid var(--chrome-border);
  background: var(--chrome-background);
  color: var(--chrome-on-surface);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.btn:hover {
  background: var(--chrome-hover);
  border-color: var(--chrome-primary);
}
.btn.full {
  width: 100%;
}
.btn.primary {
  border-color: var(--chrome-primary);
  color: var(--chrome-on-primary, #fff);
  background: var(--chrome-primary);
}
.btn.primary:hover {
  filter: brightness(1.08);
}
.btn.primary:disabled {
  opacity: 0.5;
  cursor: default;
  filter: none;
}
</style>
