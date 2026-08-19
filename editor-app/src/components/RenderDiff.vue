<script setup lang="ts">
// M13：渲染模式视图——单 Crepe 渲染「新文档 + 结构级 diff 装饰」
// M14：批注卡复用存量批注体系——notes → AnnotationService.setRuntimeAnnotations（抽屉展示/连线/定位）
// M17：notes 自带精确 from/to 位置（构建装饰时记录），不再渲染后值匹配
// 流程：loadRenderData 取新旧内容 → renderDiffToContainer（diff 装饰 + 渲染）→ 注册渲染实例 + 注入批注
// 降级：渲染失败 → renderSplitFallback 双栏全文
import { ref, watch, onBeforeUnmount, computed } from 'vue'
import type { Crepe } from '@milkdown/crepe'
import { state } from '../state/store'
import { loadRenderData, registerRenderInstance } from '../editor/manager'
import type { RenderDiffHandle, RenderDiffResult, DiffNote } from '../editor/render-diff'
import { setRuntimeAnnotations, type Annotation } from '../annotations/service'

const props = defineProps<{ tabId: string }>()

const tab = computed(() => state.tabs.find((t) => t.id === props.tabId))
const diff = computed(() => tab.value?.diff ?? null)

const hostEl = ref<HTMLDivElement | null>(null)
const status = ref<string | null>(null)
let handle: RenderDiffHandle | null = null
let renderSeq = 0

// ---------- M14：diff 批注注入（notes → Annotation[] → 存量抽屉） ----------
// M17：note.from/to 为构建装饰时记录的精确 doc 位置，直接使用（缺失/越界 → 略过定位）
function applyDiffNotes(result: RenderDiffResult) {
  registerRenderInstance(props.tabId, result.crepe)
  const list: Annotation[] = result.notes
    .map((n, i) => {
      const from = n.from >= 0 ? n.from : -1
      const to = n.to >= 0 ? Math.max(n.to, from + 1) : -1
      return {
        id: `diff-${props.tabId}-${i}`,
        from,
        to,
        anchorText: n.text,
        level: 'info',
        thread: [{ id: `d${i}`, author: '', content: n.text, createdAt: 0, resolved: false }],
        persist: false,
        source: 'diff',
      } as Annotation
    })
  setRuntimeAnnotations(props.tabId, list)
}

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
      from: d.base?.from ?? null,
      to: d.base?.to ?? 'HEAD',
      baseLabel: d.base?.label ?? '工作区 vs HEAD',
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
      // 主路径失败 → 降级双栏全文（无批注卡）
      handle = await renderSplitFallback(host, opts)
      if (handle && seq === renderSeq) status.value = status.value ?? '已降级为双栏全文对比'
      return
    }
    if (result && seq === renderSeq) {
      handle = result.handle
      applyDiffNotes(result)
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
  // M14：注销渲染实例 + 清理 diff 运行时批注（不残留到 wysiwyg 编辑器）
  registerRenderInstance(props.tabId, null)
  setRuntimeAnnotations(props.tabId, [])
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
/* M16：diff 徽标——容器（卡片右上角纵向排布）+ 基础样式 + 语义配色 */
:deep(.ref-embed-badges) {
  position: absolute;
  top: 6px;
  right: 8px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}
:deep(.ref-embed-badge) {
  font-size: 10.5px;
  font-weight: 600;
  border-radius: 999px;
  padding: 0 8px;
  line-height: 18px;
  box-shadow: 0 1px 2px rgb(0 0 0 / 12%);
  white-space: nowrap;
}
/* 新增引用（绿）/ 移除引用（红）/ 引用变更（黄） */
:deep(.ref-embed-badge.ref-embed-add) {
  color: #1b5e20;
  background: #e6f4ea;
  border: 1px solid #4caf50;
}
:deep(.ref-embed-badge.ref-embed-del) {
  color: #8e0000;
  background: #fdecea;
  border: 1px solid #e57373;
}
:deep(.ref-embed-badge.ref-embed-mod) {
  color: #6d5300;
  background: #fef7e0;
  border: 1px solid #f0c040;
}
/* 内容有改动（黄） */
:deep(.ref-embed-badge.ref-embed-diff-badge) {
  color: #7a4f00;
  background: #fff3cd;
  border: 1px solid #f0c040;
}
/* M16：卡片内嵌源文件改动摘要 */
:deep(.ref-embed-diff-summary) {
  margin: 6px 8px 8px;
  border: 1px dashed color-mix(in srgb, var(--chrome-primary, #4169e1), 45%);
  border-radius: 8px;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--chrome-background, #fff), #f4f6ff 55%);
  font-size: 11.5px;
  line-height: 1.5;
  overflow-x: auto;
}
:deep(.ref-embed-diff-summary .eds-title) {
  font-weight: 700;
  color: var(--chrome-primary, #4169e1);
  margin-bottom: 4px;
  font-size: 11px;
  letter-spacing: 0.3px;
}
:deep(.ref-embed-diff-summary .eds-line) {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: 3px;
  padding: 0 4px;
}
:deep(.ref-embed-diff-summary .eds-add) {
  background: color-mix(in srgb, #2e7d32, transparent 88%);
}
:deep(.ref-embed-diff-summary .eds-del) {
  background: color-mix(in srgb, #c62828, transparent 90%);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
  opacity: 0.92;
}
:deep(.ref-embed-diff-summary .eds-mermaid) {
  color: var(--chrome-primary, #4169e1);
  font-weight: 600;
  background: color-mix(in srgb, var(--chrome-primary, #4169e1), transparent 92%);
  padding: 2px 6px;
  margin: 2px 0;
}
/* mermaid 节点级标注（M14 渲染后 DOM 操作）——flowchart/state 节点 <g> */
:deep(.diff-node-add rect),
:deep(.diff-node-add circle),
:deep(.diff-node-add .node-bkg) {
  fill: color-mix(in srgb, #2e7d32, transparent 78%) !important;
  stroke: #2e7d32 !important;
  stroke-width: 2px !important;
}
:deep(.diff-node-add .nodeLabel),
:deep(.diff-node-add .state-label) {
  color: #1b5e20 !important;
  font-weight: 600 !important;
}
:deep(.diff-node-del rect),
:deep(.diff-node-del circle),
:deep(.diff-node-del .node-bkg) {
  fill: color-mix(in srgb, #c62828, transparent 78%) !important;
  stroke: #c62828 !important;
  stroke-width: 2px !important;
  stroke-dasharray: 4 3 !important;
}
:deep(.diff-node-del .nodeLabel),
:deep(.diff-node-del .state-label) {
  color: #8e0000 !important;
  text-decoration: line-through !important;
  text-decoration-thickness: 1.5px !important;
  opacity: 0.85;
}
/* M16b：标签修改节点 —— 节点本身绿（新值，diff-node-add 生效），节点下方追加红划线旧值小字 */
:deep(.diff-mod-old) {
  fill: #c62828 !important;
  font-size: 10.5px;
  font-weight: 600;
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  opacity: 0.85;
}
/* sequence 消息标注（M16：红删/绿增二元） */
:deep(.diff-seq-add) {
  fill: #2e7d32 !important;
  font-weight: 600;
}
:deep(.diff-seq-del) {
  fill: #c62828 !important;
  font-weight: 600;
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  opacity: 0.85;
}
</style>
