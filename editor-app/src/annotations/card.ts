// 批注卡：点击批注锚点（动态高亮 / 持久化 <mark> 节点）展开，再点或点外部收起。
// 定位：固定屏幕右侧（right 16px），top 跟随锚点；SVG 连线关联到被批注文字——
//   线条默认淡化，悬停批注卡或被批注文字时突出（用户决策 v2）。
// 动态批注（校验）：只显示消息；人工批注：显示内容 + 删除 + 内联编辑。
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { getRuntimeAnnotations, removeAnnotationNode, updateAnnotationNode, addAnnotation } from './service'
import type { Annotation } from './service'

export const LEVEL_COLOR: Record<Annotation['level'], string> = {
  info: '#8a8a8a',
  warning: '#e6a23c',
  error: '#d9534f',
  comment: '#b58900',
}

const ICONS: Record<Annotation['level'], string> = {
  info: 'ℹ️',
  warning: '⚠️',
  error: '⛔',
  comment: '💬',
}

let cardEl: HTMLDivElement | null = null
let activeTabId = ''
let activePos = -1
let activeLevel: Annotation['level'] = 'info'
let activeContent = ''
let editorRef: Editor | null = null
let activeAnchor: HTMLElement | null = null
let activeAnchorId: string | null = null

/** 锚点标识（元素可能因渲染重建——用属性标识而非元素引用判断"同一锚点"） */
function anchorId(anchor: HTMLElement): string {
  return (
    anchor.getAttribute('data-annotation-id') ??
    anchor.getAttribute('data-note') ??
    ''
  )
}

// ---------- 连线（SVG 贝塞尔，卡左 → 锚点右）----------
let connectorSvg: SVGSVGElement | null = null
let connectorPath: SVGPathElement | null = null

function ensureConnector() {
  if (connectorSvg) return
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'annotation-connector')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('class', 'annotation-connector-path')
  svg.appendChild(path)
  document.body.appendChild(svg)
  connectorSvg = svg
  connectorPath = path
  // 悬停批注卡 → 连线突出
  cardEl?.addEventListener('mouseenter', () => connectorSvg?.classList.add('annotation-connector-strong'))
  cardEl?.addEventListener('mouseleave', () => connectorSvg?.classList.remove('annotation-connector-strong'))
}

function updateConnector() {
  if (!connectorSvg || !connectorPath || !cardEl || !activeAnchor) return
  const cardRect = cardEl.getBoundingClientRect()
  let anchorRect = activeAnchor.getBoundingClientRect()
  // 锚点无布局尺寸（如装饰 tr 元素）→ 用 coordsAtPos 计算虚拟矩形
  if (!anchorRect.width && editorRef && activePos >= 0) {
    editorRef.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const c = view.coordsAtPos(Math.min(activePos, view.state.doc.content.size))
      anchorRect = {
        left: c.left,
        right: c.right,
        top: c.top,
        bottom: c.bottom,
        width: c.right - c.left,
        height: c.bottom - c.top,
      } as DOMRect
    })
  }
  if (!cardRect.width || !cardRect.height || !anchorRect.width) return
  const x1 = cardRect.left
  const y1 = cardRect.top + cardRect.height / 2
  const x2 = anchorRect.right
  const y2 = anchorRect.top + Math.min(anchorRect.height, 24) / 2
  const cx = (x1 + x2) / 2
  connectorPath.setAttribute('d', `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`)
  connectorPath.setAttribute('stroke', LEVEL_COLOR[activeLevel])
  connectorSvg.style.display = 'block'
}

function removeConnector() {
  if (connectorSvg) connectorSvg.style.display = 'none'
}

function attachAnchorHover(anchor: HTMLElement) {
  if (anchor.dataset.connectorBound === '1') return
  anchor.dataset.connectorBound = '1'
  const on = () => connectorSvg?.classList.add('annotation-connector-strong')
  const off = () => connectorSvg?.classList.remove('annotation-connector-strong')
  anchor.addEventListener('mouseenter', on)
  anchor.addEventListener('mouseleave', off)
}

// ---------- 卡片 ----------

function buildCard(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'annotation-card'
  el.setAttribute('role', 'dialog')
  document.body.appendChild(el)
  el.addEventListener('click', (e) => e.stopPropagation())
  return el
}

/** 固定屏幕右侧，top 跟随锚点（clamp 在视口内） */
function positionCard(anchor: HTMLElement) {
  if (!cardEl) return
  const rect = anchor.getBoundingClientRect()
  const cardW = 264
  const x = Math.max(8, window.innerWidth - cardW - 16)
  const top = Math.min(Math.max(8, rect.top - 24), window.innerHeight - 220)
  cardEl.style.left = `${x}px`
  cardEl.style.top = `${top}px`
}

function renderCard(anchor: HTMLElement, ann: Annotation) {
  if (!cardEl) return
  activeContent = ann.content
  activeLevel = ann.level
  cardEl.innerHTML = ''
  const head = document.createElement('div')
  head.className = 'annotation-card-head'
  head.textContent = `${ICONS[ann.level]} ${ann.level === 'comment' ? '批注' : '校验提示'}`
  cardEl.appendChild(head)

  const body = document.createElement('div')
  body.className = 'annotation-card-body'
  body.textContent = ann.content
  cardEl.appendChild(body)

  const actions = document.createElement('div')
  actions.className = 'annotation-card-actions'
  if (ann.persist) {
    const editBtn = document.createElement('button')
    editBtn.className = 'mini'
    editBtn.textContent = '编辑'
    editBtn.addEventListener('click', () => startEdit(body))
    const delBtn = document.createElement('button')
    delBtn.className = 'mini danger'
    delBtn.textContent = '删除'
    delBtn.addEventListener('click', () => {
      removePersisted()
      hideCard()
    })
    actions.appendChild(editBtn)
    actions.appendChild(delBtn)
  }
  cardEl.appendChild(actions)

  activeAnchor = anchor
  ensureConnector()
  attachAnchorHover(anchor)
  positionCard(anchor)
  cardEl.classList.add('annotation-card-visible')
  requestAnimationFrame(updateConnector)
}

function startEdit(body: HTMLElement) {
  const ta = document.createElement('textarea')
  ta.className = 'annotation-card-edit'
  ta.value = activeContent
  ta.rows = 3
  body.replaceWith(ta)
  ta.focus()
  const saveBtn = document.createElement('button')
  saveBtn.className = 'mini primary'
  saveBtn.textContent = '保存'
  saveBtn.addEventListener('click', () => {
    const text = ta.value.trim()
    if (text && editorRef && activePos >= 0) {
      updateAnnotationNode(editorRef, activePos, text)
    }
    hideCard()
  })
  const actions = cardEl?.querySelector('.annotation-card-actions')
  actions?.appendChild(saveBtn)
}

function removePersisted() {
  if (!editorRef || activePos < 0) return
  removeAnnotationNode(editorRef, activePos)
}

function showCard(anchor: HTMLElement) {
  if (!cardEl) return
  // 收集批注信息
  const isPersist = anchor.tagName.toLowerCase() === 'mark'
  if (isPersist) {
    const note = anchor.getAttribute('data-note') ?? ''
    // 从 DOM 反查节点位置（编辑/删除需要 pos）
    let pos = -1
    if (editorRef) {
      editorRef.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const dom = anchor as HTMLElement
        // posAtDOM 对 inline 节点返回内容起始位置（偏移 1）——减 1 得节点位置
        const raw = view.posAtDOM(dom, 0)
        for (const p of [raw - 1, raw]) {
          const n = p >= 0 ? view.state.doc.nodeAt(p) : null
          if (n && n.type.name === 'annotation') {
            pos = p
            break
          }
        }
      })
    }
    activePos = pos
    renderCard(anchor, {
      id: 'persist',
      from: 0,
      to: 0,
      content: note,
      level: 'comment',
      persist: true,
    })
    return
  }
  // 动态批注：从 service 查
  const id = anchor.getAttribute('data-annotation-id') ?? ''
  const ann = getRuntimeAnnotations(activeTabId).find((a) => a.id === id)
  if (!ann) return
  activePos = ann.from
  renderCard(anchor, ann)
}

function hideCard() {
  if (!cardEl) return
  cardEl.classList.remove('annotation-card-visible')
  activeAnchor = null
  removeConnector()
}

function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  const anchor = target?.closest?.('mark.annotation, .annotation-dynamic') as HTMLElement | null
  if (!anchor) {
    // 点击外部收起
    if (cardEl?.classList.contains('annotation-card-visible')) hideCard()
    return
  }
  // 同一锚点再点 → 收起（用标识比较，元素渲染重建不影响）；否则展开
  const id = anchorId(anchor)
  if (cardEl?.classList.contains('annotation-card-visible') && activeAnchorId !== null && activeAnchorId === id) {
    hideCard()
    activeAnchorId = null
    return
  }
  activeAnchorId = id
  showCard(anchor)
}

export function initAnnotationCard(): void {
  if (cardEl) return
  cardEl = buildCard()
  document.addEventListener('click', onDocumentClick, true)
}

export function setAnnotationCardContext(tabId: string, editor: Editor | null): void {
  activeTabId = tabId
  editorRef = editor
  if (cardEl?.classList.contains('annotation-card-visible')) hideCard()
}

/** Gutter/外部按位置打开批注卡（滚动到锚点后调用） */
export function openAnnotationAt(editor: Editor, pos: number): void {
  editorRef = editor
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const dom = view.domAtPos(Math.min(pos, view.state.doc.content.size))
    const el = (dom.node as HTMLElement)?.closest?.('mark.annotation, .annotation-dynamic') as HTMLElement | null
    if (!el) return
    if (cardEl?.classList.contains('annotation-card-visible') && activeAnchor === el) return
    showCard(el)
  })
}

// ---------- 添加批注输入浮窗（Toolbar 入口）----------
let inputEl: HTMLDivElement | null = null
let inputEditor: Editor | null = null
let inputFrom = -1
let inputTo = -1

export function showAnnotationInput(editor: Editor, from: number, to: number): void {
  inputEditor = editor
  inputFrom = from
  inputTo = to
  if (!inputEl) {
    inputEl = document.createElement('div')
    inputEl.className = 'annotation-input'
    inputEl.setAttribute('role', 'dialog')
    const ta = document.createElement('textarea')
    ta.className = 'annotation-input-ta'
    ta.placeholder = '批注内容…'
    const actions = document.createElement('div')
    actions.className = 'annotation-input-actions'
    const cancel = document.createElement('button')
    cancel.className = 'mini'
    cancel.textContent = '取消'
    cancel.addEventListener('click', hideAnnotationInput)
    const ok = document.createElement('button')
    ok.className = 'mini primary'
    ok.textContent = '添加批注'
    ok.addEventListener('click', () => {
      const text = ta.value.trim()
      if (text && inputEditor && inputTo > inputFrom) {
        addAnnotation(inputEditor, inputFrom, inputTo, text)
      }
      hideAnnotationInput()
    })
    actions.appendChild(cancel)
    actions.appendChild(ok)
    inputEl.appendChild(ta)
    inputEl.appendChild(actions)
    document.body.appendChild(inputEl)
  }
  const ta = inputEl.querySelector('.annotation-input-ta') as HTMLTextAreaElement
  ta.value = ''
  // 定位：跟随选区（用编辑器 view 的 coords）
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const coords = view.coordsAtPos(to)
    if (inputEl) {
      inputEl.style.left = `${Math.min(coords.left, window.innerWidth - 260)}px`
      inputEl.style.top = `${Math.max(8, coords.bottom + 6)}px`
    }
  })
  inputEl.classList.add('annotation-input-visible')
  ta.focus()
}

export function hideAnnotationInput(): void {
  inputEl?.classList.remove('annotation-input-visible')
}
