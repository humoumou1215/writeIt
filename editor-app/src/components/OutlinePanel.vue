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
const width = ref(Math.max(100, Math.min(640, settings.outlineWidth)))
/** 自适应宽度：按最长标题自动调宽，上限 = 编辑器 1/3；手动拖拽时自动关闭 */
const autoFit = ref(settings.outlineAutoFit)
const listEl = ref<HTMLElement | null>(null)

// ---------- 数据 ----------
const activeTabId = computed(() => state.activeTabId)
const tab = computed(() => state.tabs.find((t) => t.id === activeTabId.value))
const showPanel = computed(() => !!activeTabId.value && tab.value?.viewMode === 'wysiwyg')

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
  const viewTop = pane!.scrollTop + 16
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

// ---------- 自适应宽度（按文字内容，上限 = 编辑器 1/3） ----------
function editorThird(): number {
  const ed = document.querySelector('.editor-area') as HTMLElement | null
  return Math.max(Math.floor((ed?.clientWidth ?? 800) / 3), 120)
}
/** 测量最长标题行所需宽度（同帧内完成，不闪屏） */
function applyAutoFit() {
  if (!autoFit.value || !listEl.value) return
  // 先把宽度放到上限再测量（同步读取强制重排，随后立即收敛，用户看不到中间态）
  const max = editorThird()
  let needed = 0
  const rows = listEl.value.querySelectorAll<HTMLElement>('.ol-row')
  rows.forEach((r) => {
    needed = Math.max(needed, r.scrollWidth)
  })
  // 行宽 + 列表左右内边距(18)：刚好容纳文字，不额外加宽
  const target = needed > 0 ? Math.min(Math.max(needed + 18, 120), max) : 120
  width.value = target
}
function toggleAutoFit() {
  autoFit.value = !autoFit.value
  settings.outlineAutoFit = autoFit.value
  saveSettings()
  if (autoFit.value) requestAnimationFrame(applyAutoFit)
}

// ---------- 折叠 / 宽度 ----------
function toggleOpen() {
  open.value = !open.value
  settings.outlineOpen = open.value
  saveSettings()
}
function saveWidth() {
  settings.outlineWidth = width.value
  saveSettings()
}

// ---------- 收纳按钮：点击 = 收纳；拖拽 = 调整宽度（可突破 1/3） ----------
let dragStartX = 0
let dragStartW = 0
let isDragging = false
function onToggleDown(e: PointerEvent) {
  dragStartX = e.clientX
  dragStartW = width.value
  isDragging = false
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - dragStartX
    if (!isDragging && Math.abs(dx) < 5) return
    if (!isDragging) {
      isDragging = true
      // 手动拖拽 → 关闭自适应（允许突破 1/3）
      if (autoFit.value) {
        autoFit.value = false
        settings.outlineAutoFit = false
      }
    }
    // 手动上限：编辑器宽度的 60%（可突破 1/3 的自动上限）
    const ed = document.querySelector('.editor-area') as HTMLElement | null
    const maxW = Math.max(Math.floor((ed?.clientWidth ?? 800) * 0.6), 200)
    width.value = Math.min(Math.max(dragStartW + dx, 100), maxW)
    saveWidth()
  }
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (!isDragging && Math.abs(ev.clientX - dragStartX) < 5) {
      // 未拖动 = 点击 → 直接收纳
      toggleOpen()
    }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// ---------- 生命周期 ----------
function onResize() {
  scheduleRebuild(150)
  if (autoFit.value) requestAnimationFrame(applyAutoFit)
}
function scheduleFit() {
  requestAnimationFrame(() => {
    void nextTick(applyAutoFit)
  })
}
onMounted(async () => {
  window.addEventListener('resize', onResize)
  void import('../editor/manager').then((m) => {
    m.onEditorMounted(() => scheduleRebuild(0))
  })
  scheduleRebuild(0)
  scheduleFit()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  detachScroll()
})
watch(activeTabId, () => {
  scheduleRebuild(0)
  scheduleFit()
})
watch(
  () => outlineStore.version,
  () => {
    scheduleRebuild(0)
    scheduleFit()
  }
)
watch(showPanel, (v) => {
  if (v) {
    scheduleRebuild(0)
    scheduleFit()
  } else markers.value = []
})
watch(open, (v) => {
  if (v) {
    scheduleRebuild(60)
    scheduleFit()
  }
})
// 顶部栏开关按钮直接改 settings.outlineOpen → 面板本地状态跟随
watch(
  () => settings.outlineOpen,
  (v) => {
    open.value = v
  }
)
// 自适应开关被外部（如设置）修改时跟随
watch(
  () => settings.outlineAutoFit,
  (v) => {
    autoFit.value = v
    if (v) requestAnimationFrame(applyAutoFit)
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
    <!-- 展开态：右缘按钮（点击=收纳，拖拽=调整宽度） + 自适应开关 -->
    <template v-if="open">
      <button
        class="op-fit"
        :class="{ on: autoFit }"
        :title="autoFit ? '自适应宽度（≤ 编辑器 1/3）已开启，点击关闭' : '自适应宽度（按文字内容，≤ 编辑器 1/3）'"
        @click="toggleAutoFit"
      >A</button>
      <button
        class="op-toggle collapse"
        :title="autoFit ? '点击收纳；拖拽调整宽度' : '点击收纳；拖拽调整宽度（可突破 1/3）'"
        @pointerdown="onToggleDown"
      >
        <MenuIcon name="chevron" :set="settings.iconSet" :size="14" class="op-chev" />
      </button>
    </template>

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
/* 自适应宽度开关（A）：悬停浮现，位于收纳按钮上方 */
.op-fit {
  position: absolute;
  right: -1px;
  top: calc(50% - 38px);
  width: 18px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--chrome-border-light);
  border-radius: 6px;
  background: color-mix(in srgb, var(--chrome-surface) 78%, transparent);
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.18s ease, background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  z-index: 4;
}
.op-fit.on {
  color: var(--chrome-primary);
  border-color: var(--chrome-primary);
}
.op-fit:hover {
  background: var(--chrome-hover);
}
.outline-panel:hover .op-fit,
.op-fit:focus-visible {
  opacity: 1;
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
  /* 大纲内容从右到左透明度渐变：左缘 100% 不透明 → 右缘 0% 透明（仅内容，不遮收纳按钮） */
  -webkit-mask-image: linear-gradient(to right, #000 0%, transparent 100%);
  mask-image: linear-gradient(to right, #000 0%, transparent 100%);
  /* 可滚动但不显示滚动条（进度条） */
  scrollbar-width: none;
}
.ol-list::-webkit-scrollbar {
  display: none;
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