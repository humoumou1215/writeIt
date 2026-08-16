<script setup lang="ts">
// M13：渲染模式视图——单 Crepe 渲染组合 md（diff 标注内嵌）
// 流程：loadRenderData 取新旧内容 → renderDiffToContainer（组合 + 渲染）→ notes 显示右侧批注卡
// 降级：渲染失败 → renderSplitFallback 双栏全文
import { ref, watch, onBeforeUnmount, computed } from 'vue'
import { state } from '../state/store'
import { loadRenderData } from '../editor/manager'
import type { RenderDiffHandle, RenderDiffResult } from '../editor/render-diff'
import type { DiffNote } from '../editor/diff-compose'
import DiffNotePanel from './DiffNotePanel.vue'

const props = defineProps<{ tabId: string }>()

const tab = computed(() => state.tabs.find((t) => t.id === props.tabId))
const diff = computed(() => tab.value?.diff ?? null)

const hostEl = ref<HTMLDivElement | null>(null)
const status = ref<string | null>(null)
const notes = ref<DiffNote[]>([])
let handle: RenderDiffHandle | null = null
let renderSeq = 0

async function render() {
  const d = diff.value
  if (!d || !d.renderData || !d.hunks.length) return
  const seq = ++renderSeq
  handle?.destroy()
  handle = null
  status.value = null
  try {
    const { renderDiffToContainer, renderSplitFallback } = await import('../editor/render-diff')
    const { buildRenderRefCfg } = await import('../editor/manager')
    const opts = {
      oldMd: d.renderData.oldMd,
      newMd: d.renderData.newMd,
      hunks: d.hunks,
      path: d.path,
      refCfg: buildRenderRefCfg(),
      onFallback: (reason: string) => {
        if (seq !== renderSeq) return
        status.value = reason
      },
    }
    const host = hostEl.value
    if (!host) return
    let result: RenderDiffResult | null = null
    try {
      result = await renderDiffToContainer(host, opts)
    } catch {
      result = null
    }
    if (!result && seq === renderSeq) {
      // 主路径失败 → 降级双栏全文
      handle = await renderSplitFallback(host, opts)
      if (handle && seq === renderSeq) status.value = status.value ?? '已降级为双栏全文对比'
      return
    }
    if (result && seq === renderSeq) {
      handle = result.handle
      notes.value = result.notes
    }
  } catch (e) {
    console.error('[RenderDiff] render 异常:', e)
    if (seq === renderSeq) status.value = '渲染异常：' + (e as Error).message
  }
}

watch(
  () => diff.value?.mode,
  (m) => {
    if (m !== 'render') return
    void loadRenderData(props.tabId)
  },
  { immediate: true }
)

// 竞态控制：debounce + 串行（多次触发只渲染最后一次，避免 mount 竞态清空 notes）
let renderTimer: ReturnType<typeof setTimeout> | null = null
let renderQueue: Promise<void> = Promise.resolve()
function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    const d = diff.value
    if (d?.mode !== 'render' || !d.renderData || d.renderLoading) return
    renderQueue = renderQueue
      .then(() => render())
      .catch((e) => console.error('[RenderDiff] render 异常:', e))
  }, 200)
}
watch(
  () => [diff.value?.mode, diff.value?.renderData, diff.value?.renderLoading, diff.value?.hunks],
  scheduleRender,
  { flush: 'post', immediate: true }
)

onBeforeUnmount(() => {
  renderSeq++
  handle?.destroy()
  handle = null
})
</script>

<template>
  <div class="render-diff">
    <div class="render-main">
      <div ref="hostEl" class="render-host"></div>
      <div v-if="diff?.renderLoading && !diff.renderData" class="render-status overlay">加载渲染数据…</div>
      <div v-else-if="diff?.renderError && !diff.renderData" class="render-status overlay error">
        渲染数据加载失败：{{ diff.renderError }}
        <button class="mini" @click="loadRenderData(tabId)">重试</button>
      </div>
      <div v-if="status" class="render-status fallback">{{ status }}</div>
    </div>
    <DiffNotePanel v-if="notes.length" :notes="notes" :host="hostEl" />
  </div>
</template>

<style scoped>
.render-diff {
  flex: 1;
  min-height: 0;
  display: flex;
}
.render-main {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 8px 12px 24px;
}
.render-host {
  min-height: 100%;
}
.render-status {
  padding: 24px 16px;
  text-align: center;
  color: var(--chrome-on-surface-variant);
  font-size: 12.5px;
}
.render-status.overlay {
  padding: 12px;
}
.render-status.error {
  color: var(--chrome-error, #ba1a1a);
}
.render-status.fallback {
  padding: 6px 0 12px;
  font-size: 11.5px;
  opacity: 0.8;
}
.mini {
  border: 1px solid var(--chrome-border);
  background: transparent;
  color: inherit;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 5px;
  cursor: pointer;
  font-family: inherit;
  margin-left: 8px;
}
.mini:hover {
  background: var(--chrome-hover);
}
/* 锚点高亮闪烁 */
:deep(.diff-note-flash) {
  animation: note-flash 1s ease-out;
}
@keyframes note-flash {
  0%,
  50% {
    box-shadow: 0 0 0 3px var(--chrome-primary);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
/* 降级双栏 */
:deep(.rd-split-fallback) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
:deep(.rd-col) {
  min-width: 0;
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  padding: 8px;
  overflow-x: auto;
}
:deep(.rd-col .ProseMirror) {
  outline: none;
}
:deep(.render-host .milkdown) {
  color: var(--chrome-on-background);
}
/* fenced code 块标注（diff-add / diff-del 语言） */
:deep(.diff-code-add) {
  background: color-mix(in srgb, #2e7d32, transparent 90%);
  box-shadow: inset 3px 0 0 #2e7d32;
  border-radius: 8px;
}
:deep(.diff-code-del) {
  background: color-mix(in srgb, #c62828, transparent 90%);
  box-shadow: inset 3px 0 0 #c62828;
  border-radius: 8px;
  opacity: 0.92;
}
/* sequence 消息标注 */
:deep(.diff-seq-add) {
  fill: #2e7d32 !important;
  font-weight: 600;
}
:deep(.diff-seq-mod) {
  fill: #b58900 !important;
  font-weight: 600;
}
</style>
