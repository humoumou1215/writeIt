<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { state } from '../state/store'
import { fs } from '../fs'
import { activateTab, closeTab } from '../editor/manager'

const isTauri = fs.kind === 'tauri'

// 标签滚动区（标签独立横向滚动，不占用窗口控制按钮空间）
const tabScrollEl = ref<HTMLElement | null>(null)
// 最大化状态：窗口控制「最大化」按钮图标在 最大化⇄还原 间切换（桌面应用）
const maximized = ref(false)
let unlistenResized: (() => void) | null = null
let resizeTimer: number | undefined
let wheelAbort: (() => void) | null = null

// ---------- 自绘窗口控制（最小化/最大化/关闭；并入标签栏，复用整行为拖拽区） ----------
async function winMinimize() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().minimize()
}
async function winToggleMaximize() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  // 走 ACL 已授权的 toggle_maximize（Rust 侧原子切换 isMaximized→maximize/unmaximize，
  // 避免前端两步调用的竞态；直接调 maximize/unmaximize 曾因 capabilities 未放行而静默失败）
  await getCurrentWindow().toggleMaximize()
  refreshMaximized()
}
async function winClose() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().close()
}

/** 刷新最大化状态（同步按钮图标）。web 演示模式无窗口，跳过 */
async function refreshMaximized() {
  if (!isTauri) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    maximized.value = await getCurrentWindow().isMaximized()
  } catch {
    /* 忽略：窗口操作失败不影响编辑 */
  }
}

onMounted(async () => {
  if (isTauri) {
    await refreshMaximized()
    // 窗口尺寸变化（按钮点击 / 拖拽区双击 / 系统 Snap / Win+↑）→ 防抖刷新图标状态
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    unlistenResized = await getCurrentWindow().onResized(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(refreshMaximized, 120)
    })
    window.addEventListener('focus', refreshMaximized)
  }
  // 标签溢出时：纵向滚轮 → 横向滚动标签列表（滚动条隐藏，给滚轮兜底）
  const el = tabScrollEl.value
  if (el) {
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return // 已是横向滚 → 放行
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    wheelAbort = () => el.removeEventListener('wheel', onWheel)
  }
})

onBeforeUnmount(() => {
  clearTimeout(resizeTimer)
  unlistenResized?.()
  wheelAbort?.()
  window.removeEventListener('focus', refreshMaximized)
})

function onMiddleClick(e: MouseEvent, id: string) {
  if (e.button === 1) {
    e.preventDefault()
    closeTab(id)
  }
}

// M11d：标签右键菜单
function onContextMenu(e: MouseEvent, id: string) {
  e.preventDefault()
  const tab = state.tabs.find((t) => t.id === id)
  if (!tab) return
  state.tabContextMenu = {
    x: Math.min(e.clientX, window.innerWidth - 170),
    y: Math.min(e.clientY, window.innerHeight - 120),
    tabId: id,
    path: tab.path,
  }
}
</script>

<template>
  <div class="tabbar">
    <!-- 标签滚动区：独立横向滚动 + 整区可拖拽（空区拖窗口；标签/按钮本身不可拖） -->
    <div
      class="tab-scroll"
      ref="tabScrollEl"
      :data-tauri-drag-region="isTauri ? '' : undefined"
    >
      <span
        v-if="!state.tabs.length"
        class="app-name"
        :data-tauri-drag-region="isTauri ? 'true' : undefined"
        >WriteIt</span
      >
      <div
        v-for="tab in state.tabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.id === state.activeTabId }"
        @click="activateTab(tab.id)"
        @dblclick="closeTab(tab.id)"
        @auxclick="onMiddleClick($event, tab.id)"
        :title="tab.path"
        @contextmenu="onContextMenu($event, tab.id)"
      >
        <span class="dot" :class="{ dirty: tab.dirty }"></span>
        <span v-if="tab.kind === 'git'" class="git-badge" title="Git SCM 打开">🔀</span>
        <span class="tab-name">{{ tab.name }}</span>
        <button
          class="close"
          title="关闭 (中键/双击也可)"
          @click.stop="closeTab(tab.id)"
          @dblclick.stop
        >
          ×
        </button>
      </div>
      <span
        v-if="!state.tabs.length"
        class="empty-hint"
        :data-tauri-drag-region="isTauri ? 'true' : undefined"
        >在左侧选择文件打开，或右键目录新建</span
      >
    </div>

    <!-- 窗口控制：固定于标签栏右端（同一行、独立于标签空间，不被标签挤出）；
         容器空区亦可拖拽（deep），三个按钮本身不可拖 -->
    <div v-if="isTauri" class="tb-controls" data-tauri-drag-region="deep">
      <button class="tb-btn" title="最小化" @click="winMinimize">
        <svg class="tb-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5.2 12.2h13.6" />
        </svg>
      </button>
      <button class="tb-btn" :title="maximized ? '还原' : '最大化'" @click="winToggleMaximize">
        <svg v-if="!maximized" class="tb-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5.8" y="6.2" width="12.4" height="12.4" rx="2" />
        </svg>
        <!-- 已最大化：双框（还原）图标 -->
        <svg v-else class="tb-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.6 7.4v6.8c0 .99.8 1.8 1.8 1.8h6.8" />
          <rect x="9.6" y="9.4" width="6.6" height="6.6" rx="1.6" />
        </svg>
      </button>
      <button class="tb-btn tb-close" title="关闭" @click="winClose">
        <svg class="tb-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.8 6.8l10.4 10.4M17.2 6.8 6.8 17.2" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tabbar {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  background: var(--chrome-surface);
  border-bottom: 1px solid var(--chrome-border);
  user-select: none;
  -webkit-user-select: none;
}
/* 标签滚动区：flex 撑满、独立横向滚动；窗口控制按钮固定在其右侧，互不挤占 */
.tab-scroll {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 6px 4px 0;
  overflow-x: auto;
  flex: 1;
  min-width: 0;
  scrollbar-width: none; /* Firefox */
}
.tab-scroll::-webkit-scrollbar {
  display: none; /* Chromium/WebView2：滚动条隐藏 */
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px 8px 0 0;
  font-size: 13px;
  cursor: pointer;
  color: var(--chrome-on-surface-variant);
  border: 1px solid transparent;
  border-bottom: none;
  max-width: 220px;
  white-space: nowrap;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}
.tab:hover {
  background: var(--chrome-hover);
}
.tab.active {
  background: var(--chrome-background);
  border-color: var(--chrome-border);
  color: var(--chrome-on-background);
  /* 与下方编辑器连成一体 */
  box-shadow: 0 1px 0 0 var(--chrome-background);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
}
.dot.dirty {
  background: var(--chrome-primary);
}
.git-badge {
  font-size: 11px;
  color: var(--chrome-primary);
  flex-shrink: 0;
}
.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.close {
  border: none;
  background: transparent;
  color: inherit;
  font-size: 15px;
  line-height: 1;
  padding: 0 3px;
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
}
.close:hover {
  background: var(--chrome-hover);
}
.empty-hint {
  align-self: center;
  font-size: 12px;
  color: var(--chrome-on-surface-variant);
  padding: 4px 8px;
  white-space: nowrap;
}
/* 无标签时：应用名居左，作为拖拽抓手 */
.app-name {
  align-self: center;
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--chrome-on-surface-variant);
  padding: 0 10px;
  white-space: nowrap;
}

/* ===== 窗口控制（固定右端；按钮可点，容器空区为拖拽区） ===== */
.tb-controls {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
  align-self: stretch;
}
.tb-btn {
  width: 44px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}
.tb-btn:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
.tb-btn.tb-close:hover {
  background: #e81123;
  color: #fff;
}
.tb-icon {
  width: 12px;
  height: 12px;
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}
</style>