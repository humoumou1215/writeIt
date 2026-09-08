import type { EditorView } from '@codemirror/view'

export interface PopupRectangle {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export interface CaretPopupPlacement {
  readonly left: number
  readonly top: number
  readonly maxWidth: number
  readonly maxHeight: number
  readonly side: 'above' | 'below'
}

export interface CaretPopupGeometry {
  readonly caret?: PopupRectangle | null
  readonly boundary: PopupRectangle
  readonly popupWidth: number
  readonly popupHeight: number
  readonly caretGap?: number
  readonly edgeGap?: number
}

const DEFAULT_CARET_GAP = 4
const DEFAULT_EDGE_GAP = 8

function finiteRectangle(rectangle: PopupRectangle | null | undefined): rectangle is PopupRectangle {
  return Boolean(
    rectangle &&
      [
        rectangle.left,
        rectangle.right,
        rectangle.top,
        rectangle.bottom,
      ].every(Number.isFinite) &&
      rectangle.right >= rectangle.left &&
      rectangle.bottom >= rectangle.top,
  )
}

/**
 * Computes popup coordinates in viewport space. The caller remains responsible
 * for translating them into its positioned containing block.
 */
export function computeCaretPopupPlacement(
  geometry: CaretPopupGeometry,
): CaretPopupPlacement | undefined {
  const { caret, boundary } = geometry
  if (
    !finiteRectangle(caret) ||
    !finiteRectangle(boundary) ||
    boundary.right <= boundary.left ||
    boundary.bottom <= boundary.top ||
    !Number.isFinite(geometry.popupWidth) ||
    !Number.isFinite(geometry.popupHeight) ||
    geometry.popupWidth <= 0 ||
    geometry.popupHeight <= 0
  ) {
    return undefined
  }

  if (
    caret.right < boundary.left ||
    caret.left > boundary.right ||
    caret.bottom < boundary.top ||
    caret.top > boundary.bottom
  ) {
    return undefined
  }

  const caretGap = geometry.caretGap ?? DEFAULT_CARET_GAP
  const edgeGap = geometry.edgeGap ?? DEFAULT_EDGE_GAP
  const innerLeft = boundary.left + edgeGap
  const innerRight = boundary.right - edgeGap
  const innerTop = boundary.top + edgeGap
  const innerBottom = boundary.bottom - edgeGap
  const maxWidth = innerRight - innerLeft
  if (maxWidth <= 0) return undefined

  const popupWidth = Math.min(geometry.popupWidth, maxWidth)
  const availableBelow = Math.max(0, innerBottom - caret.bottom - caretGap)
  const availableAbove = Math.max(0, caret.top - caretGap - innerTop)
  const fitsBelow = geometry.popupHeight <= availableBelow
  const side = fitsBelow || availableAbove <= 0 ? 'below' : 'above'
  const availableHeight = side === 'below' ? availableBelow : availableAbove
  const maxHeight = Math.min(geometry.popupHeight, availableHeight)
  if (maxHeight <= 0) return undefined

  const left = Math.min(
    Math.max(caret.left, innerLeft),
    innerRight - popupWidth,
  )
  const top =
    side === 'below'
      ? caret.bottom + caretGap
      : caret.top - caretGap - maxHeight

  return Object.freeze({ left, top, maxWidth, maxHeight, side })
}

export function intersectPopupRectangles(
  first: PopupRectangle,
  second: PopupRectangle,
): PopupRectangle | undefined {
  const intersection = {
    left: Math.max(first.left, second.left),
    right: Math.min(first.right, second.right),
    top: Math.max(first.top, second.top),
    bottom: Math.min(first.bottom, second.bottom),
  }
  return finiteRectangle(intersection) &&
    intersection.right > intersection.left &&
    intersection.bottom > intersection.top
    ? Object.freeze(intersection)
    : undefined
}

/** Scrolls only the popup, avoiding scrollIntoView moving the editor or page. */
export function scrollPopupOptionIntoView(
  menu: HTMLElement,
  option: HTMLElement | null | undefined,
): void {
  if (!option) return
  const menuRect = menu.getBoundingClientRect()
  const optionRect = option.getBoundingClientRect()
  const visibleTop = menuRect.top + menu.clientTop
  const visibleBottom = visibleTop + menu.clientHeight
  if (menu.clientHeight <= 0) return

  if (optionRect.top < visibleTop) {
    menu.scrollTop -= visibleTop - optionRect.top
  } else if (optionRect.bottom > visibleBottom) {
    menu.scrollTop += optionRect.bottom - visibleBottom
  }
}

/** Shared lifecycle and geometry policy for CM6 caret-anchored popup surfaces. */
export class CaretPopup {
  private readonly ownerWindow: Window
  private readonly resizeObserver?: ResizeObserver
  private readonly configuredMaxHeight: number
  private destroyed = false

  private readonly onGeometryEvent = (): void => {
    this.reposition()
  }

  constructor(
    private readonly view: EditorView,
    private readonly menu: HTMLElement,
    private readonly anchorPosition: () => number | undefined,
  ) {
    const ownerWindow = view.dom.ownerDocument.defaultView
    if (!ownerWindow) throw new Error('Caret popup requires a browser window')
    this.ownerWindow = ownerWindow
    const configuredMaxHeight = Number.parseFloat(
      ownerWindow.getComputedStyle(menu).maxHeight,
    )
    this.configuredMaxHeight = Number.isFinite(configuredMaxHeight)
      ? configuredMaxHeight
      : Number.POSITIVE_INFINITY

    view.dom.ownerDocument.addEventListener('scroll', this.onGeometryEvent, true)
    ownerWindow.addEventListener('resize', this.onGeometryEvent)
    ownerWindow.visualViewport?.addEventListener('resize', this.onGeometryEvent)
    ownerWindow.visualViewport?.addEventListener('scroll', this.onGeometryEvent)

    const ResizeObserverConstructor = ownerWindow.ResizeObserver
    if (ResizeObserverConstructor) {
      this.resizeObserver = new ResizeObserverConstructor(this.onGeometryEvent)
      this.resizeObserver.observe(view.dom)
      this.resizeObserver.observe(view.scrollDOM)
    }
  }

  reposition(): boolean {
    if (this.destroyed || this.menu.hidden) return false
    const anchor = this.anchorPosition()
    if (anchor === undefined) return this.markUnavailable()

    let caret: PopupRectangle | null
    try {
      caret = this.view.coordsAtPos(anchor)
    } catch {
      return this.markUnavailable()
    }
    if (!caret) return this.markUnavailable()

    const editorBoundary = this.view.scrollDOM.getBoundingClientRect()
    const viewportBoundary: PopupRectangle = {
      left: 0,
      right: this.ownerWindow.innerWidth,
      top: 0,
      bottom: this.ownerWindow.innerHeight,
    }
    const boundary = intersectPopupRectangles(editorBoundary, viewportBoundary)
    if (!boundary) return this.markUnavailable()

    const availableWidth = Math.max(0, boundary.right - boundary.left - 16)
    this.menu.style.maxWidth = `${availableWidth}px`
    const popupRect = this.menu.getBoundingClientRect()
    const borderHeight = Math.max(0, popupRect.height - this.menu.clientHeight)
    const desiredHeight = Math.min(
      this.menu.scrollHeight + borderHeight,
      this.configuredMaxHeight,
    )
    const placement = computeCaretPopupPlacement({
      caret,
      boundary,
      popupWidth: popupRect.width,
      popupHeight: desiredHeight,
    })
    if (!placement) return this.markUnavailable()

    const editorRect = this.view.dom.getBoundingClientRect()
    this.menu.style.left = `${placement.left - editorRect.left}px`
    this.menu.style.top = `${placement.top - editorRect.top}px`
    this.menu.style.maxWidth = `${placement.maxWidth}px`
    this.menu.style.maxHeight = `${placement.maxHeight}px`
    this.menu.style.visibility = 'visible'
    this.menu.style.pointerEvents = ''
    this.menu.dataset.popupPositioned = 'true'
    this.menu.dataset.popupPlacement = placement.side
    return true
  }

  ensureOptionVisible(option: HTMLElement | null | undefined): void {
    scrollPopupOptionIntoView(this.menu, option)
  }

  hide(): void {
    this.menu.style.visibility = 'hidden'
    this.menu.style.pointerEvents = 'none'
    this.menu.dataset.popupPositioned = 'false'
    this.menu.removeAttribute('data-popup-placement')
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.view.dom.ownerDocument.removeEventListener(
      'scroll',
      this.onGeometryEvent,
      true,
    )
    this.ownerWindow.removeEventListener('resize', this.onGeometryEvent)
    this.ownerWindow.visualViewport?.removeEventListener(
      'resize',
      this.onGeometryEvent,
    )
    this.ownerWindow.visualViewport?.removeEventListener(
      'scroll',
      this.onGeometryEvent,
    )
    this.resizeObserver?.disconnect()
  }

  private markUnavailable(): false {
    this.hide()
    return false
  }
}
