// 批注卡：点击批注锚点（动态高亮 / 持久化 <mark> 节点）展开，再点或点外部收起。
// 动态批注（校验）：只显示消息；人工批注：显示内容 + 删除 + 内联编辑。
// 定位：@floating-ui（placement right + flip，尽量靠右不遮正文）。
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { getRuntimeAnnotations, removeAnnotationNode, updateAnnotationNode, addAnnotation } from './service'
import type { Annotation } from './service'

let cardEl: HTMLDivElement | null = null
let activeTabId = ''
let activePos = -1
let activeContent = ''
let editorRef: Editor | null = null

const ICONS: Record<Annotation['level'], string> = {
  info: 'ℹ️',
  warning: '⚠️',
  error: '⛔',
  comment: '💬',
}

function buildCard(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'annotation-card'
  el.setAttribute('role', 'dialog')
  document.body.appendChild(el)
  el.addEventListener('click', (e) => e.stopPropagation())
  return el
}

function positionCard(anchor: HTMLElement) {
  if (!cardEl) return
  computePosition(anchor, cardEl, {
    placement: 'right',
    middleware: [offset(10), flip(), shift({ padding: 8 })],
    strategy: 'fixed',
  })
    .then(({ x, y }) => {
      cardEl!.style.left = `${x}px`
      cardEl!.style.top = `${y}px`
    })
    .catch(() => undefined)
}

function renderCard(anchor: HTMLElement, ann: Annotation) {
  if (!cardEl) return
  activeContent = ann.content
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

  positionCard(anchor)
  cardEl.classList.add('annotation-card-visible')
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
  activePos = -1
  renderCard(anchor, ann)
}

function hideCard() {
  if (!cardEl) return
  cardEl.classList.remove('annotation-card-visible')
}

function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  const anchor = target?.closest?.('mark.annotation, .annotation-dynamic') as HTMLElement | null
  if (!anchor) {
    // 点击外部收起
    if (cardEl?.classList.contains('annotation-card-visible')) hideCard()
    return
  }
  // 同一锚点再点 → 收起；否则展开
  if (cardEl?.classList.contains('annotation-card-visible') && activeAnchor === anchor) {
    hideCard()
    return
  }
  activeAnchor = anchor
  showCard(anchor)
}

let activeAnchor: HTMLElement | null = null

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
