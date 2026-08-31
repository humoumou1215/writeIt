<script setup lang="ts">
// 图片全屏预览弹层（悬停放大镜 / 图片右键菜单「预览」打开）
// 交互：滚轮缩放（含触摸板两指 pinch，表现同为 wheel+ctrlKey）、按住拖拽平移视窗（拖拽照常）；
// 单击 图片本体 → 光斑反馈；双击 图片本体 → 复位（与 Mermaid Lightbox 一致）；
// 单击/双击 图片外（背景）→ 退出预览；Esc 也可退出。
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { state } from '../state/store'
import { showClickSpot } from '../editor/click-spot'

const scale = ref(1)
const tx = ref(0)
const ty = ref(0)

const MIN_SCALE = 0.5
const MAX_SCALE = 10

const imgStyle = computed(() => ({
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
}))

function resetTransform() {
  scale.value = 1
  tx.value = 0
  ty.value = 0
}

function clampScale(v: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))
}

function close() {
  state.imagePreview = null
  resetTransform()
}

// ---------- 滚轮缩放（触摸板两指 pinch = wheel + ctrlKey，同路径） ----------
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18
  const next = clampScale(scale.value * factor)
  if (next <= 1) {
    // 缩小回适应窗口 → 归位
    if (next < scale.value) tx.value = 0, ty.value = 0
  }
  scale.value = next
}

// ---------- 按住拖拽平移视窗 ----------
const dragging = ref(false)
const panning = ref(false)
let dragStartX = 0
let dragStartY = 0
let dragBaseTx = 0
let dragBaseTy = 0
let moved = false
// setPointerCapture 会把 pointerup 的 target 转成捕获元素，故用 downTarget 记住按下的目标，
// 用于区分「点击的是图片本体(→光斑) 还是图片外(→退出)」。
let downTarget: HTMLElement | null = null

function onPointerDown(e: PointerEvent) {
  // 只处理鼠标左键/触摸/笔；滚轮缩放不在 drag 范围
  if (e.button !== 0 && e.pointerType === 'mouse') return
  dragging.value = true
  panning.value = false
  moved = false
  downTarget = e.target as HTMLElement
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragBaseTx = tx.value
  dragBaseTy = ty.value
  try {
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  } catch {
    /* 合成/异常事件下可能抛错；捕获失败不阻断后续逻辑 */
  }
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY
  if (!moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
    moved = true
    panning.value = true
  }
  tx.value = dragBaseTx + dx
  ty.value = dragBaseTy + dy
}
function onPointerUp(e: PointerEvent) {
  const wasDragging = dragging.value
  const wasMoved = moved
  const target = downTarget
  dragging.value = false
  panning.value = false
  downTarget = null
  if (wasDragging) {
    try {
      ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    } catch {
      /* 未真正捕获时释放会抛 NotFoundError；忽略即可 */
    }
    // 非拖拽的「点击」才分流；拖拽只负责平移，不关闭
    if (!wasMoved && target) {
      if (target.closest('.imgpv-img')) {
        // 单击/双击都即时冒光斑（与 Mermaid Lightbox 一致）；双击时 onDblClick 再复位
        showClickSpot(e.clientX, e.clientY)
      } else {
        close()
      }
    }
  }
}

function onDblClick() {
  // 双击图片本体 → 复位缩放/平移（与 Mermaid Lightbox 一致）
  resetTransform()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && state.imagePreview) {
    e.stopPropagation()
    close()
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.imagePreview"
      class="imgpv-mask"
      :class="{ panning }"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="dragging = false"
    >
      <div class="imgpv-stage">
        <img
          :src="state.imagePreview.src"
          :alt="state.imagePreview.name"
          class="imgpv-img"
          :style="imgStyle"
          draggable="false"
          @dblclick="onDblClick"
        />
        <div class="imgpv-info">
          <span class="imgpv-name" :title="state.imagePreview.path || state.imagePreview.name">
            {{ state.imagePreview.name }}
          </span>
          <span v-if="state.imagePreview.path" class="imgpv-path">{{ state.imagePreview.path }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.imgpv-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(8, 10, 14, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: default;
  touch-action: none;
}
.imgpv-mask.panning {
  cursor: grabbing;
}
.imgpv-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 100vw;
  max-height: 100vh;
}
.imgpv-img {
  max-width: 92vw;
  max-height: 84vh;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  background: rgba(255, 255, 255, 0.04);
  transform-origin: center;
  user-select: none;
  -webkit-user-drag: none;
}
.imgpv-info {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 92vw;
  color: rgba(255, 255, 255, 0.8);
  font-size: 12.5px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 6px 14px;
  flex-wrap: wrap;
  justify-content: center;
}
.imgpv-name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40vw;
}
.imgpv-path {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.55);
  font-family: var(--chrome-font-code, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 34vw;
}
</style>