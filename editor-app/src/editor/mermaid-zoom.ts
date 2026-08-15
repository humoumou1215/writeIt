// Mermaid 预览放大查看（M7 优化）：
//  1. wrapMermaidPreview：渲染结果 SVG 包一层 .mmd-zoomable + 右上角放大镜按钮
//     （HTML 字符串随预览内容走 Crepe 的 DOMPurify 通道，div/button/svg 均保留）
//  2. 事件委托（document 级，多标签共享一份监听）：
//     - 点击 .mmd-zoom-btn → 克隆 SVG 打开 Lightbox
//     - Lightbox：滚轮缩放（以光标为中心）/ 拖拽平移 / 双击复位 / ESC 或点遮罩或 ✕ 关闭
import './mermaid-zoom.css'

const zoomInIcon = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="7"/>
    <line x1="21" y1="21" x2="16.3" y2="16.3"/>
    <line x1="11" y1="8" x2="11" y2="14"/>
    <line x1="8" y1="11" x2="14" y2="11"/>
  </svg>`

const closeIcon = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <line x1="6" y1="6" x2="18" y2="18"/>
    <line x1="18" y1="6" x2="6" y2="18"/>
  </svg>`

/** 预览 SVG 包裹层：放大镜按钮纯 CSS 悬停显隐（按钮随 innerHTML 重建，交互走委托） */
export function wrapMermaidPreview(svg: string): string {
  return (
    `<div class="mmd-zoomable">${svg}` +
    `<button class="mmd-zoom-btn" type="button" title="放大查看" aria-label="放大查看">${zoomInIcon}</button>` +
    `</div>`
  )
}

// ---------------- Lightbox ----------------

interface LightboxState {
  overlay: HTMLElement
  canvas: HTMLElement
  svg: SVGSVGElement
  // 变换：canvas 左上角位置 (x,y) + 缩放 s（transform-origin: 0 0）
  x: number
  y: number
  s: number
  // 初始适配值（双击复位用）
  fitX: number
  fitY: number
  fitS: number
  trigger: HTMLElement | null
}

let state: LightboxState | null = null
// 拖拽状态：记录 pointerdown 的原始 target（不用 setPointerCapture——它会把
// 后续 pointerup/click 重定向到 overlay，导致「图表上的点击」被误判为「点遮罩」而关闭）
let drag: { startX: number; startY: number; moved: boolean; downTarget: EventTarget | null } | null = null

function applyTransform(st: LightboxState) {
  st.canvas.style.transform = `translate(${st.x}px, ${st.y}px) scale(${st.s})`
}

function naturalSize(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.viewBox?.baseVal
  if (vb && vb.width > 0 && vb.height > 0) return { w: vb.width, h: vb.height }
  const w = parseFloat(svg.getAttribute('width') ?? '') || svg.getBoundingClientRect().width
  const h = parseFloat(svg.getAttribute('height') ?? '') || svg.getBoundingClientRect().height
  return { w: w || 600, h: h || 400 }
}

function openLightbox(source: SVGSVGElement, trigger: HTMLElement | null) {
  closeLightbox(false)

  const svg = source.cloneNode(true) as SVGSVGElement
  // 去掉 mermaid 的内联 max-width/尺寸，交给画布统一控制
  svg.style.maxWidth = 'none'
  svg.removeAttribute('width')
  svg.removeAttribute('height')

  const overlay = document.createElement('div')
  overlay.className = 'mmd-lightbox'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'Mermaid 图表放大查看')

  const canvas = document.createElement('div')
  canvas.className = 'mmd-lightbox-canvas'
  canvas.appendChild(svg)

  const closeBtn = document.createElement('button')
  closeBtn.className = 'mmd-lightbox-close'
  closeBtn.type = 'button'
  closeBtn.title = '关闭（ESC）'
  closeBtn.setAttribute('aria-label', '关闭')
  closeBtn.innerHTML = closeIcon

  const hint = document.createElement('div')
  hint.className = 'mmd-lightbox-hint'
  hint.textContent = '滚轮缩放 · 拖拽移动 · 双击复位 · ESC 关闭'

  overlay.append(canvas, closeBtn, hint)
  document.body.appendChild(overlay)

  // 自然尺寸 → 适配视口（92vw × 86vh，允许放大小图）
  const { w, h } = naturalSize(svg)
  const vw = window.innerWidth
  const vh = window.innerHeight
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const fitS = Math.min((vw * 0.92) / w, (vh * 0.86) / h)
  const fitX = (vw - w * fitS) / 2
  const fitY = (vh - h * fitS) / 2

  state = { overlay, canvas, svg, x: fitX, y: fitY, s: fitS, fitX, fitY, fitS, trigger }
  applyTransform(state)

  overlay.addEventListener('pointerdown', onPointerDown)
  overlay.addEventListener('dblclick', onDblClick)
  overlay.addEventListener('wheel', onWheel, { passive: false })
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    closeLightbox(true)
  })
  document.addEventListener('keydown', onKeyDown, true)
}

export function closeLightbox(restoreFocus = true) {
  if (!state) return
  const st = state
  state = null
  drag = null
  detachDragListeners()
  document.removeEventListener('keydown', onKeyDown, true)
  st.overlay.remove()
  if (restoreFocus && st.trigger?.isConnected) st.trigger.focus()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeLightbox(true)
  }
}

// ---- 缩放 / 平移 ----

function onWheel(e: WheelEvent) {
  if (!state) return
  e.preventDefault()
  const st = state
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
  const minS = st.fitS / 5
  const maxS = st.fitS * 20
  const ns = Math.min(maxS, Math.max(minS, st.s * factor))
  if (ns === st.s) return
  // 保持光标下的点不动
  const cx = (e.clientX - st.x) / st.s
  const cy = (e.clientY - st.y) / st.s
  st.x = e.clientX - cx * ns
  st.y = e.clientY - cy * ns
  st.s = ns
  applyTransform(st)
}

function onDblClick(e: MouseEvent) {
  if (!state) return
  e.preventDefault()
  const st = state
  st.x = st.fitX
  st.y = st.fitY
  st.s = st.fitS
  applyTransform(st)
}

function onPointerDown(e: PointerEvent) {
  if (!state || e.button !== 0) return
  drag = { startX: e.clientX, startY: e.clientY, moved: false, downTarget: e.target }
  // window 级监听：拖出 overlay 也能持续平移/正确接收 pointerup
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function detachDragListeners() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  if (!state || !drag) return
  const dx = e.clientX - drag.startX
  const dy = e.clientY - drag.startY
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    drag.moved = true
    state.overlay.classList.add('mmd-dragging')
  }
  if (drag.moved) {
    state.x += e.clientX - drag.startX
    state.y += e.clientY - drag.startY
    drag.startX = e.clientX
    drag.startY = e.clientY
    applyTransform(state)
  }
}

function onPointerUp(_e: PointerEvent) {
  detachDragListeners()
  if (!state) {
    drag = null
    return
  }
  const wasDrag = drag?.moved
  const downTarget = drag?.downTarget
  drag = null
  state.overlay.classList.remove('mmd-dragging')
  // 仅「pointerdown 就落在遮罩空白处」且未拖拽才关闭；
  // 落在图表/✕ 上的点击不关（用 downTarget 判定，避免重定向/冒泡误判）
  if (!wasDrag && downTarget === state.overlay) closeLightbox(true)
}

// ---------------- 委托：放大镜按钮点击 ----------------

function onDocClick(e: MouseEvent) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest('.mmd-zoom-btn')
  if (!btn) return
  e.preventDefault()
  e.stopPropagation()
  const wrap = btn.closest('.mmd-zoomable')
  const svg = wrap?.querySelector('svg')
  if (!(svg instanceof SVGSVGElement)) return
  openLightbox(svg, btn instanceof HTMLElement ? btn : null)
}

// 模块级初始化一次（多标签实例共享）
document.addEventListener('click', onDocClick, true)
