// 引用链接的自定义悬停浮窗（替换浏览器原生 title）：
//   file_ref 正常  → 📄 路径 — 点击打开 / 跳转到「标题」
//   object_ref     → 🔗 对象名（路径）— 点击跳转
//   断链           → ⚠️ 文件不存在：路径 — 点击重新选择
// 主题化（--chrome-* 变量）、跟随鼠标、无延迟、统一风格。
let tooltipEl: HTMLDivElement | null = null
let activeEl: HTMLElement | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

function contentFor(el: HTMLElement): string | null {
  if (el.classList.contains('ref-file')) {
    const path = el.getAttribute('data-path') ?? ''
    const frag = el.getAttribute('data-fragment')
    if (el.classList.contains('ref-broken')) {
      return `⚠️ 文件不存在：${path} — 点击重新选择`
    }
    return frag
      ? `📄 ${path} — 点击跳转到「${frag}」`
      : `📄 ${path} — 点击打开`
  }
  if (el.classList.contains('ref-object')) {
    const path = el.getAttribute('data-path') ?? ''
    const label = el.getAttribute('data-label')
    return label
      ? `🔗 ${label}（${path}）— 点击跳转`
      : `🔗 ${path} — 点击跳转`
  }
  return null
}

function showTooltip(el: HTMLElement, e: MouseEvent) {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  activeEl = el
  if (!tooltipEl) return
  const content = contentFor(el)
  if (content === null) return
  tooltipEl.textContent = content
  positionTooltip(e)
  tooltipEl.classList.add('ref-tooltip-visible')
}

function positionTooltip(e: MouseEvent) {
  if (!tooltipEl) return
  const pad = 14
  const { innerWidth, innerHeight } = window
  tooltipEl.style.left = `${Math.min(e.clientX + pad, innerWidth - 260)}px`
  tooltipEl.style.top = `${Math.min(e.clientY + pad + 6, innerHeight - 60)}px`
}

function hideTooltip() {
  if (!tooltipEl) return
  tooltipEl.classList.remove('ref-tooltip-visible')
  activeEl = null
}

function onMouseOver(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  const el = target?.closest?.('a.ref-file, span.ref-object') as HTMLElement | null
  if (!el || el === activeEl) return
  showTooltip(el, e)
}

function onMouseOut(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  const el = target?.closest?.('a.ref-file, span.ref-object') as HTMLElement | null
  if (!el) return
  // 移出到引用外部（非引用内部移动）时隐藏
  const to = e.relatedTarget as HTMLElement | null
  if (to?.closest?.('a.ref-file, span.ref-object') === el) return
  hideTooltip()
}

function onMouseMove(e: MouseEvent) {
  if (!activeEl || !tooltipEl) return
  if (tooltipEl.classList.contains('ref-tooltip-visible')) positionTooltip(e)
}

/** 初始化（幂等）：document 级事件委托 */
export function initRefTooltip(): void {
  if (tooltipEl) return
  tooltipEl = document.createElement('div')
  tooltipEl.className = 'ref-tooltip'
  tooltipEl.setAttribute('role', 'tooltip')
  document.body.appendChild(tooltipEl)
  document.addEventListener('mouseover', onMouseOver)
  document.addEventListener('mouseout', onMouseOut)
  document.addEventListener('mousemove', onMouseMove)
}
