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
import type { DiffHunk } from '../git'
import { setRuntimeAnnotations, type Annotation } from '../annotations/service'

const props = defineProps<{ tabId: string }>()

const tab = computed(() => state.tabs.find((t) => t.id === props.tabId))
const diff = computed(() => tab.value?.diff ?? null)

const hostEl = ref<HTMLDivElement | null>(null)
const status = ref<string | null>(null)
let handle: RenderDiffHandle | null = null
let renderSeq = 0
let fmtSeq = 0

// ---------- Issue 3：仅表格列宽对齐（分隔行 --- 长度变化）→ 渲染无可视改动 ----------
// markdown 表格的列宽对齐空格在解析成 PM 后被归一化，旧/新文档结构完全相同 →
// buildDiffDecorations 无任何装饰/批注，diff 看似「没改」。此时补一张说明卡，避免困惑。
function isSepRowText(text: string): boolean {
  if (!text.includes('|')) return false
  const cells = text.split('|').slice(1, -1).map((c) => c.trim())
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))
}
function isOnlyTableFormatting(hunks: DiffHunk[] | null | undefined): boolean {
  if (!hunks || !hunks.length) return false
  let sepSeen = false
  let any = false
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind !== 'add' && l.kind !== 'del') continue
      if (!l.text.trim()) continue // 纯空白/空行（如末尾自动补的空行）不参与判定
      any = true
      if (!l.text.includes('|')) return false // 含非表格行 → 不是「仅表格格式化」
      if (isSepRowText(l.text)) sepSeen = true
    }
  }
  return any && sepSeen
}

// ---------- M14：diff 批注注入（notes → Annotation[] → 存量抽屉） ----------
// M17：note.from/to 为构建装饰时记录的精确 doc 位置，直接使用（缺失/越界 → 略过定位）
// M18 §4.2：批注 id = note.id（内容派生）——与装饰 data-dnote 同源，重算稳定，连线/激活态保持
function applyDiffNotes(result: RenderDiffResult) {
  registerRenderInstance(props.tabId, result.crepe)
  const list: Annotation[] = result.notes
    .map((n, i) => {
      const from = n.from >= 0 ? n.from : -1
      const to = n.to >= 0 ? Math.max(n.to, from + 1) : -1
      return {
        id: n.id,
        from,
        to,
        anchorText: n.text,
        level: 'info',
        thread: [{ id: `d${i}`, author: '', content: n.text, createdAt: 0, resolved: false }],
        persist: false,
        source: 'diff',
      } as Annotation
    })
    // Issue 4：批注卡自上而下按改动点在文档中的位置排序（from 升序；无定位的 -1 排末尾）
    .sort((a, b) => {
      const fa = a.from >= 0 ? a.from : Number.MAX_SAFE_INTEGER
      const fb = b.from >= 0 ? b.from : Number.MAX_SAFE_INTEGER
      return fa - fb
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
  hostEl.value?.classList.remove('rd-new-file')
  try {
    const { renderDiffToContainer, renderSplitFallback } = await import('../editor/render-diff')
    const { buildRenderRefCfg } = await import('../editor/manager')
    const opts = {
      oldMd: d.renderData.oldMd,
      newMd: d.renderData.newMd,
      hunks: d.hunks,
      path: d.path,
      refCfg: buildRenderRefCfg(d.path),
      base: d.base ?? { kind: 'worktree', label: '工作区 vs HEAD' },
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
      // Issue 3：仅表格分隔行列宽对齐（PM 解析后无可视变化）→ 补一张说明卡
      if (
        result.notes.length === 0 &&
        d.hunks.length &&
        isOnlyTableFormatting(d.hunks) &&
        d.renderData &&
        d.renderData.oldMd !== d.renderData.newMd
      ) {
        result.notes.push({
          id: `dn-fmt-${++fmtSeq}`,
          kind: 'table',
          text: '表格分隔行格式调整（列宽对齐），内容无变化，请忽略',
          anchor: '表格 --- 字段调整，请忽略',
          from: -1,
          to: -1,
        } as DiffNote)
      }
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
  /* M16 修复：内层不得产生滚动条——否则与外层 .diff-body 右侧形成双重滚动条（两个进度条） */
  overflow: visible;
  padding: 8px 12px 24px;
}
.render-host {
  min-height: 100%;
  overflow: visible;
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
</style>
