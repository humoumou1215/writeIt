// 批注交互（v3 抽屉模式）：
//   点击正文锚点（mark.annotation / .annotation-dynamic）→ 激活批注 + 展开抽屉（drawer 订阅展开）
//   批注内容展示/评论线程/连线全部在 AnnotationDrawer.vue；本模块保留锚点激活 + 添加批注输入浮窗。
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { setActiveAnnotation, addAnnotation } from './service'

let activeTabId = ''
let editorRef: Editor | null = null

function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  const anchor = target?.closest?.('mark.annotation, .annotation-dynamic') as HTMLElement | null
  if (!anchor) return
  const tabId = activeTabId
  if (!tabId) return
  // 持久化批注：mark 元素 → pos → 线程 id（p-<pos>，与 service 一致）
  if (anchor.tagName.toLowerCase() === 'mark' && editorRef) {
    let pos = -1
    editorRef.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const raw = view.posAtDOM(anchor, 0)
      for (const p of [raw - 1, raw]) {
        const n = p >= 0 ? view.state.doc.nodeAt(p) : null
        if (n && n.type.name === 'annotation') {
          pos = p
          break
        }
      }
    })
    if (pos >= 0) setActiveAnnotation(tabId, `p-${pos}`)
    return
  }
  // 运行时批注（校验）：data-annotation-id
  const id = anchor.getAttribute('data-annotation-id')
  if (id) setActiveAnnotation(tabId, id)
}

export function initAnnotationCard(): void {
  document.addEventListener('click', onDocumentClick, true)
  // Ctrl+R（选中文字后）：快速弹出评论输入框
  document.addEventListener('keydown', onKeydown, true)
}

function onKeydown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'r') return
  if (!editorRef) return
  editorRef.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { from, to } = view.state.selection
    if (to <= from) return
    e.preventDefault()
    showAnnotationInput(editorRef!, from, to)
  })
}

export function setAnnotationCardContext(tabId: string, editor: Editor | null): void {
  activeTabId = tabId
  editorRef = editor
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
    ok.addEventListener('click', async () => {
      const text = ta.value.trim()
      if (text && inputEditor && inputTo > inputFrom) {
        const { resolveUserName } = await import('./user-name')
        const name = await resolveUserName()
        addAnnotation(inputEditor, inputFrom, inputTo, text, name)
        // 激活新批注（抽屉展开定位）
        inputEditor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const doc = view.state.doc
          let found = -1
          doc.descendants((n, p) => {
            if (n.type.name === 'annotation' && p >= inputFrom - 5 && p <= inputTo + 5) {
              found = p
              return false
            }
            return true
          })
          if (found >= 0) setActiveAnnotation('', `p-${found}`)
        })
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

export { LEVEL_COLOR } from './card-color'
