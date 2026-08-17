<script setup lang="ts">
// 大纲面板 v4 —— 透明标题列表（无刻度条/无彩色点；跟随滚动高亮当前章节）
//  - 只有标题文字：按级别缩进，无图标无彩色点，行距宽松，与正文排版协调
//  - 跟随文章滚动：当前章节高亮 + 列表自动滚动跟随
//  - 点击行跳转到对应标题；与文档/批注栏同层（位于横贯 topbar 之下）
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { state } from '../state/store'
import { settings, saveSettings } from '../state/settings'
import { outlineStore } from '../editor/outline'
import type { OutlineItem } from '../editor/outline'
import MenuIcon from './MenuIcon.vue'

const open = ref(settings.outlineOpen)
const width = ref(Math.max(140, Math.min(320, settings.outlineWidth)))
const listEl = ref<HTMLElement | null>(null)

// ---------- 数据 ----------
const activeTabId = computed(() => state.activeTabId)
const tab = computed(() => state.tabs.find((t) => t.id === activeTabId.value))
const showPanel = computed(() => !!activeTabId.value && tab.value?.viewMode !== 'diff')

const items = computed(() =>
  activeTabId.value ? (outlineStore.tabs[activeTabId.value]?.items ?? []) : []
)

interface Marker {
  item: OutlineItem
  /** 标题在滚动内容中的纵向偏移（px，相对内容顶） */
  docTop: number
}
const markers = ref<Marker[]>([])
/** 滚动版本号：让 computed 对滚动变化生效 */
const viewTick = ref(0)

// ---------- 标题位置映射（用于「当前章节」判定） ----------
let pane: HTMLElement | null = null
let busy = false

async function rebuild() {
  const tabId = activeTabId.value
  const tab = tabId ? state.tabs.find((t) => t.id === tabId) : null
  if (!tabId || !tab || tab.viewMode === 'diff') {
    markers.value = []
    attachScroll(null)
    return
  }
  const { getActiveInstance } = await import('../editor/manager')
  const inst = getActiveInstance()
  if (!inst || !inst.crepe.editor) {
    scheduleRebuild(200)
    return
  }
  const p = inst.el.classList.contains('editor-pane')
    ? inst.el
    : (inst.el.querySelector('.editor-pane') as HTMLElement | null)
  if (!p) return
  attachScroll(p)
  const list = items.value
  if (!list.length) {
    markers.value = []
    return
  }
  const { editorViewCtx } = await import('@milkdown/kit/core')
  let out: { top: number }[] = []
  try {
    out = await inst.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const paneRect = p.getBoundingClientRect()
      const res: { top: number }[] = []
      for (const it of list) {
        const el = view.nodeDOM(Math.max(it.pos - 1, 0)) as HTMLElement | null
        if (el) {
          const r = el.getBoundingClientRect()
          res.push({ top: r.top - paneRect.top + p.scrollTop })
        } else {
          res.push({ top: -1 })
        }
      }
      return res
    })
  } catch {
    return
  }
  const list2 = [...list]
  markers.value = out.map((o, i) => ({ item: list2[i], docTop: o.top }))
  await scrollListToActive()
}

function scheduleRebuild(delay: number) {
  setTimeout(rebuild, delay)
}

const onPaneScroll = () => {
  if (busy) return
  busy = true
  requestAnimationFrame(() => {
    busy = false
    viewTick.value++
  })
}
function attachScroll(p: HTMLElement | null) {
  if (pane) pane.removeEventListener('scroll', onPaneScroll)
  pane = p
  p?.addEventListener('scroll', onPaneScroll)
}
function detachScroll() {
  if (pane) pane.removeEventListener('scroll', onPaneScroll)
  pane = null
}

// ---------- 当前章节（按视口顶部判定；滚到底选中最后一节） ----------
const activeIndex = computed(() => {
  const ms = markers.value
  if (!ms.length || !pane) return -1
  void viewTick.value
  if (pane!.scrollTop + pane!.clientHeight >= pane!.scrollHeight - 2) {
    return ms.length - 1
  }
  const viewTop = pane!.scrollTop + 1
  let idx = -1
  for (let i = 0; i < ms.length; i++) {
    if (ms[i].docTop <= viewTop) idx = i
    else break
  }
  return idx >= 0 ? idx : 0
})

async function scrollListToActive() {
  await nextTick()
  const idx = activeIndex.value
  if (idx < 0 || !listEl.value) return
  listEl.value
    .querySelector<HTMLElement>(`[data-oi="${idx}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}
watch(activeIndex, () => void scrollListToActive())

// ---------- 交互 ----------
async function go(item: OutlineItem) {
  const tabId = activeTabId.value
  if (!tabId) return
  const { scrollToPos } = await import('../editor/manager')
  await scrollToPos(tabId, item.pos)
}

// ---------- 折叠 ----------
function toggleOpen() {
  open.value = !open.value
  settings.outlineOpen = open.value
  saveSettings()
}

// ---------- 生命周期 ----------
function onResize() {
  scheduleRebuild(150)
}
onMounted(async () => {
  window.addEventListener('resize', onResize)
  void import('../editor/manager').then((m) => {
    m.onEditorMounted(() => scheduleRebuild(0))
  })
  scheduleRebuild(0)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  detachScroll()
})
watch(activeTabId, () => scheduleRebuild(0))
watch(
  () => outlineStore.version,
  () => scheduleRebuild(0)
)
watch(showPanel, (v) => {
  if (v) scheduleRebuild(0)
  else markers.value = []
})
watch(open, (v) => {
  if (v) scheduleRebuild(60)
})
// 顶部栏开关按钮直接改 settings.outlineOpen → 面板本地状态跟随
watch(
  () => settings.outlineOpen,
  (v) => {
    open.value = v
  }
)
</script>

<template>
  <div
    v-if="showPanel"
    class="outline-panel"
    :class="{ open }"
    :style="{ width: open ? width + 'px' : '0px' }"
  >
    <!-- 展开态：右缘收拢按钮（chevron 指向左） -->
    <button
      v-if="open"
      class="op-toggle collapse"
      title="收起大纲"
      @click="toggleOpen"
    >
      <MenuIcon name="chevron" :set="settings.iconSet" :size="14" class="op-chev" />
    </button>

    <!-- 折叠态：左缘展开按钮（chevron 指向右） -->
    <button
      v-else
      class="op-toggle expand"
      title="显示大纲"
      @click="toggleOpen"
    >
      <MenuIcon name="chevron" :set="settings.iconSet" :size="14" class="op-chev" />
    </button>

    <div v-if="open" ref="listEl" class="ol-list">
        <div
          v-for="(it, i) in items"
          :key="it.id"
          class="ol-row"
          :data-oi="i"
          :class="{ on: i === activeIndex }"
          :style="{ paddingLeft: 12 + Math.max(it.level - 1, 0) * 16 + 'px' }"
          :title="it.text"
          @click="go(it)"
        >
          <span class="ol-txt">{{ it.text }}</span>
        </div>
        <div v-if="!items.length" class="ol-empty">
          <p>本文档暂无标题大纲</p>
          <p class="sub">使用 # ~ ###### 标题后自动出现</p>
        </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== 面板：透明、无存在感 ===== */
.outline-panel {
  flex: none;
  display: flex;
  height: 100%;
  min-width: 0;
  position: relative;
  background: transparent;
  transition: width 0.16s ease;
}

/* 收纳/展开按钮：悬停浮现的窄胶囊，chevron 随状态旋转动画 */
.op-toggle {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--chrome-border-light);
  border-radius: 7px;
  background: color-mix(in srgb, var(--chrome-surface) 78%, transparent);
  color: var(--chrome-on-surface-variant);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.18s ease, background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  z-index: 4;
}
.op-toggle:hover {
  background: var(--chrome-hover);
  color: var(--chrome-primary);
  border-color: var(--chrome-primary);
}
.op-toggle.collapse {
  right: -1px;
}
.op-toggle.expand {
  left: 0;
  /* 收纳态要“看得见”：平时半透明可见，悬停全亮 */
  opacity: 0.55;
  border-color: var(--chrome-border);
}
.outline-panel:hover .op-toggle,
.op-toggle:focus-visible {
  opacity: 1;
}
.op-toggle .op-chev {
  display: inline-flex;
  transition: transform 0.22s ease;
}
/* 展开态 chevron 向左（收起语义）；折叠态向右（展开语义） */
.op-toggle.collapse .op-chev {
  transform: rotate(180deg);
}
.op-toggle.expand .op-chev {
  transform: rotate(0deg);
}

/* ===== 标题列表：宽松行距、与正文协调 ===== */
.ol-list {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 8px 14px;
}
.ol-row {
  display: flex;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--chrome-on-surface-variant);
  font-size: 13px;
  line-height: 1.7;
  letter-spacing: 0.01em;
  transition: background 0.12s ease, color 0.12s ease;
  white-space: nowrap;
  overflow: hidden;
}
.ol-row:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-surface);
}
.ol-row.on {
  color: var(--chrome-primary);
  font-weight: 600;
  background: var(--chrome-selected);
}
.ol-txt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ol-empty {
  padding: 20px 12px;
  text-align: center;
  color: var(--chrome-on-surface-variant);
  font-size: 12px;
  line-height: 1.7;
  opacity: 0.75;
}
.ol-empty .sub {
  font-size: 11px;
  opacity: 0.75;
}
.ol-empty p { margin: 3px 0; }
</style>