<script setup lang="ts">
// M11c：渲染模式视图 —— 单栏融合 diff（双 Crepe 渲染 + 块级对齐）
// 首次进入：loadRenderData 懒加载两版本内容 → renderDiffToContainer 组装
// 降级：Crepe 失败/块数不匹配 → renderSplitFallback 双栏全文对比
import { ref, watch, onBeforeUnmount, computed } from 'vue'
import { state } from '../state/store'
import { loadRenderData } from '../editor/manager'
import type { RenderDiffHandle } from '../editor/render-diff'

const props = defineProps<{ tabId: string }>()



const tab = computed(() => state.tabs.find((t) => t.id === props.tabId))
const diff = computed(() => tab.value?.diff ?? null)

const hostEl = ref<HTMLDivElement | null>(null)
const status = ref<string | null>(null)
let handle: RenderDiffHandle | null = null
let renderSeq = 0

async function render() {
  const d = diff.value
  if (!d || !d.renderData) return
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
      refCfg: buildRenderRefCfg(),
      onFallback: (reason: string) => {
        if (seq !== renderSeq) return
        status.value = reason
      },
    }
    // 渲染到独立 scratch 容器（不依赖组件生命周期，避免异步渲染期间被卸载）
    const scratch = document.createElement('div')
    scratch.className = 'rd-scratch'
    handle = await renderDiffToContainer(scratch, opts)
    if (!handle && seq === renderSeq) {
      // 主路径失败 → 降级双栏全文
      handle = await renderSplitFallback(scratch, opts)
      if (handle && seq === renderSeq) status.value = status.value ?? '已降级为双栏全文对比'
    }
    // 迁移到当前 host（组件仍挂载时）
    if (seq === renderSeq) {
      const cur = hostEl.value
      if (cur) {
        while (scratch.firstChild) cur.appendChild(scratch.firstChild)
        scratch.remove()
      }
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
    // 懒加载两版本内容（失败显示 error 状态）
    void loadRenderData(props.tabId)
  },
  { immediate: true }
)

watch(
  () => [diff.value?.mode, diff.value?.renderData, diff.value?.renderLoading],
  async () => {
    const d = diff.value
    if (d?.mode !== 'render' || !d.renderData) return
    // flush: post 保证模板已更新（hostEl 是最新 DOM 元素，非 detached）；immediate 保证重挂载即渲染
    await new Promise((r) => setTimeout(r, 50))
    void render()
  },
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
    <!-- host 常驻：不随 loading 切换卸载（避免 watch 拿到 detached 元素） -->
    <div ref="hostEl" class="render-host" :class="{ dim: diff?.renderLoading && !diff.renderData }"></div>
    <div v-if="diff?.renderLoading && !diff.renderData" class="render-status overlay">加载渲染数据…</div>
    <div v-else-if="diff?.renderError && !diff.renderData" class="render-status overlay error">
      渲染数据加载失败：{{ diff.renderError }}
      <button class="mini" @click="loadRenderData(tabId)">重试</button>
    </div>
    <div v-if="status && diff?.renderData" class="render-status fallback">{{ status }}</div>
  </div>
</template>

<style scoped>
.render-diff {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px 24px;
}
.render-host {
  min-height: 100%;
}
.render-host.dim {
  opacity: 0.4;
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
/* 融合块着色（clone 的 DOM 在 host 内，需 deep） */
:deep(.rd-block) {
  position: relative;
  border-radius: 6px;
  margin: 2px 0;
}
:deep(.rd-add) {
  background: color-mix(in srgb, #2e7d32, transparent 88%);
  box-shadow: inset 3px 0 0 #2e7d32;
}
:deep(.rd-del) {
  background: color-mix(in srgb, var(--chrome-error, #ba1a1a), transparent 88%);
  box-shadow: inset 3px 0 0 var(--chrome-error, #ba1a1a);
}
:deep(.rd-mod) {
  background: transparent;
  border: 1px dashed var(--chrome-border);
  padding: 2px;
}
:deep(.rd-side) {
  border-radius: 6px;
  margin: 2px 0;
}
:deep(.rd-old) {
  background: color-mix(in srgb, var(--chrome-error, #ba1a1a), transparent 88%);
  box-shadow: inset 3px 0 0 var(--chrome-error, #ba1a1a);
}
:deep(.rd-new) {
  background: color-mix(in srgb, #2e7d32, transparent 88%);
  box-shadow: inset 3px 0 0 #2e7d32;
}
:deep(.rd-del),
:deep(.rd-old) {
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--chrome-error, #ba1a1a), transparent 40%);
  opacity: 0.92;
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
/* 渲染内容跟随主题（Crepe 样式在 clone 后丢失 milkdown 类上下文） */
:deep(.render-host .milkdown) {
  color: var(--chrome-on-background);
}
</style>
