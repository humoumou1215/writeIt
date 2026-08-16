<script setup lang="ts">
// 导出弹窗（M10）：图标列 📤 独立入口
// 当前文件 + doctype（含 export.ts 徽标）→ 格式选择 → 导出
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { state } from '../state/store'
import { getActiveTabMarkdown } from '../editor/manager'
import { extractDoctype, templateService } from '../template/service'
import { exportActiveTab } from '../export/service'
import type { ExportFormat } from '../export/types'

const emit = defineEmits<{ (e: 'close'): void }>()

const activeTab = computed(() => state.tabs.find((t) => t.id === state.activeTabId) ?? null)
const exportDoctype = computed(() => {
  const t = activeTab.value
  if (!t) return null
  const md = getActiveTabMarkdown() ?? t.savedContent
  return extractDoctype(md)
})
/** 模板是否声明了 export.ts（注册表同步查询；未扫描完成时为 false） */
const exportHasTs = computed(() => {
  const dt = exportDoctype.value
  if (!dt) return false
  return Boolean(templateService.get(dt)?.exportFile)
})
const exportFormat = ref<ExportFormat | 'auto'>('auto')
const exporting = ref(false)

const fmtOptions: Array<{ value: ExportFormat | 'auto'; label: string; hint: string }> = [
  { value: 'auto', label: '自动', hint: '跟随模板 export.ts；无则默认 PDF' },
  { value: 'pdf', label: 'PDF', hint: '内置中文字体，离线生成' },
  { value: 'docx', label: 'DOCX', hint: 'Word 文档（引用系统中文字体）' },
  { value: 'md', label: 'Markdown', hint: '导出 .md（嵌入块内容已展开）' },
]

async function doExport() {
  if (exporting.value) return
  exporting.value = true
  try {
    await exportActiveTab({ format: exportFormat.value })
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
          <button class="close" @click="emit('close')" title="关闭 (Esc)">×</button>
        </div>

        <div class="modal-body">
          <div class="export-target">
            <div class="row">
              <span>当前文件</span>
              <span class="export-path">{{ activeTab?.path ?? '（未打开文件）' }}</span>
            </div>
            <div class="row" v-if="activeTab">
              <span>模板类型</span>
              <span class="badge">{{ exportDoctype ?? '（无 doctype）' }}</span>
              <span v-if="exportHasTs" class="badge ts" title="该模板定义了 export.ts，将按模板规则导出">
                export.ts
              </span>
            </div>
          </div>

          <div class="export-formats">
            <label v-for="f in fmtOptions" :key="f.value" class="fmt">
              <input type="radio" :value="f.value" v-model="exportFormat" />
              <span class="fmt-main">{{ f.label }}</span>
              <span class="fmt-hint">{{ f.hint }}</span>
            </label>
          </div>
          <p class="hint">
            模板目录下存在 <code>&lt;名称&gt;.export.ts</code> 时，「自动」/导出将按其定义执行
            （format / filename / build 自定义内容）；无 export.ts 时默认把 Markdown 导出为
            PDF 或 DOCX。嵌入块（<code>![[path]]</code>）的内容会一并包含在导出文件中。
          </p>

          <button class="btn full primary" :disabled="!activeTab || exporting" @click="doExport">
            {{ exporting ? '导出中…' : '📤 导出' }}
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
  width: min(480px, 92vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--chrome-shadow-2, 0 16px 48px rgba(0, 0, 0, 0.22));
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px 0;
}
.modal-head h3 {
  margin: 0;
  font-size: 15px;
  color: var(--chrome-on-surface);
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
}
.close:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
.modal-body {
  padding: 16px 18px 18px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.row > span:first-child {
  min-width: 96px;
  color: var(--chrome-on-surface);
}
.export-target {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--chrome-background);
}
.export-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--chrome-font-code, monospace);
  font-size: 12px;
  color: var(--chrome-on-surface);
}
.badge {
  font-size: 11px;
  background: var(--chrome-selected);
  color: var(--chrome-on-surface);
  padding: 2px 8px;
  border-radius: 999px;
}
.badge.ts {
  background: var(--chrome-selected);
  color: var(--chrome-primary);
  font-family: var(--chrome-font-code, monospace);
}
.export-formats {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fmt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  cursor: pointer;
  background: var(--chrome-background);
}
.fmt:hover {
  border-color: var(--chrome-primary);
}
.fmt input[type='radio'] {
  accent-color: var(--chrome-primary);
  margin: 0;
}
.fmt-main {
  font-size: 13px;
  color: var(--chrome-on-surface);
  min-width: 64px;
}
.fmt-hint {
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
  line-height: 1.6;
}
.hint code {
  font-family: var(--chrome-font-code, monospace);
  font-size: 10px;
  background: var(--chrome-hover);
  padding: 1px 4px;
  border-radius: 4px;
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
