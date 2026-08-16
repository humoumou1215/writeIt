<script setup lang="ts">
// M13：diff 批注卡（渲染层自动生成）——右侧固定栏 + 锚点连线
// 点击卡片 → 滚动到锚点 + 高亮；激活卡片显示连线（卡左缘 → 锚点右缘）
import { ref, watch, nextTick } from 'vue'
import type { DiffNote } from '../editor/diff-compose'

const props = defineProps<{ notes: DiffNote[]; host: HTMLElement | null }>()

const activeId = ref<string | null>(null)
const panelEl = ref<HTMLDivElement | null>(null)
const svgEl = ref<SVGSVGElement | null>(null)

/** 按锚点文本定位 diff 元素（.diff-ins / .diff-del / .diff-container 内文本匹配） */
function locateNote(note: DiffNote): HTMLElement | null {
  const host = props.host
  if (!host || !note.anchor) return null
  const els = host.querySelectorAll<HTMLElement>('.diff-ins, .diff-del, .diff-container')
  for (const el of els) {
    if ((el.textContent || '').includes(note.anchor)) return el
  }
  return null
}

const KIND_ICON: Record<DiffNote['kind'], string> = {
  word: '✏️',
  block: '📦',
  mermaid: '🧩',
  table: '▦',
}

async function activate(note: DiffNote) {
  activeId.value = note.id
  const el = locateNote(note)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.remove('diff-note-flash')
    void el.offsetWidth
    el.classList.add('diff-note-flash')
    await nextTick()
    drawConnector(el)
  }
}

/** 激活连线：SVG 贝塞尔（卡片左缘 → 锚点右缘），全屏 overlay */
function drawConnector(el: HTMLElement) {
  const svg = svgEl.value
  const panel = panelEl.value
  if (!svg || !panel) return
  const er = el.getBoundingClientRect()
  const pr = panel.getBoundingClientRect()
  const y1 = pr.top + pr.height / 2
  const x2 = er.right
  const y2 = er.top + er.height / 2
  const d = `M ${pr.left} ${y1} C ${pr.left - 60} ${y1}, ${x2 + 60} ${y2}, ${x2} ${y2}`
  svg.setAttribute('width', String(window.innerWidth))
  svg.setAttribute('height', String(window.innerHeight))
  svg.innerHTML = ''
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  path.setAttribute('class', 'diff-connector')
  svg.appendChild(path)
}

watch(
  () => activeId.value,
  async (id) => {
    if (!id) return
    const note = props.notes.find((n) => n.id === id)
    if (note) await activate(note)
  }
)
</script>

<template>
  <div ref="panelEl" class="diff-note-panel">
    <div class="dnp-head">改动批注（{{ notes.length }}）</div>
    <div class="dnp-list">
      <button
        v-for="n in notes"
        :key="n.id"
        class="dnp-card"
        :class="{ active: activeId === n.id }"
        @click="activate(n)"
      >
        <span class="dnp-icon">{{ KIND_ICON[n.kind] }}</span>
        <span class="dnp-text">{{ n.text }}</span>
      </button>
    </div>
    <svg ref="svgEl" class="diff-connector-overlay"></svg>
  </div>
</template>

<style scoped>
.diff-note-panel {
  width: 260px;
  flex-shrink: 0;
  border-left: 1px solid var(--chrome-border);
  background: var(--chrome-surface);
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}
.dnp-head {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--chrome-on-surface-variant);
  border-bottom: 1px solid var(--chrome-border);
  flex-shrink: 0;
}
.dnp-list {
  flex: 1;
  overflow: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dnp-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid var(--chrome-border);
  background: var(--chrome-background);
  border-radius: 8px;
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  color: var(--chrome-on-background);
  font-size: 12px;
  line-height: 1.5;
}
.dnp-card:hover {
  border-color: var(--chrome-primary);
}
.dnp-card.active {
  border-color: var(--chrome-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--chrome-primary), transparent 70%);
}
.dnp-icon {
  flex-shrink: 0;
  font-size: 13px;
}
.dnp-text {
  flex: 1;
}
.diff-connector-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 60;
}
:deep(.diff-connector) {
  fill: none;
  stroke: var(--chrome-primary);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
  opacity: 0.9;
}
</style>
