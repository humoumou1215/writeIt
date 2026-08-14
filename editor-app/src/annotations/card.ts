// 批注交互（v3 抽屉模式）：
//   点击正文锚点（mark.annotation / .annotation-dynamic）→ 激活批注 + 展开抽屉（drawer 订阅展开）
//   批注内容展示/评论线程/连线全部在 AnnotationDrawer.vue；本模块保留锚点激活 + 添加批注输入浮窗。
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { setActiveAnnotation, addAnnotation } from './service'
import { state, toast } from '../state/store'

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
  // M7：源码模式禁用批注——doc 是同步前的旧内容，选区错位；且不 preventDefault 会触发浏览器刷新
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  if (tab?.sourceMode) {
    e.preventDefault()
    toast('源码模式下暂不支持添加批注，请按 Ctrl+E 切回编辑模式', 'info')
    return
  }
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

// ---------- 添加批注输入浮窗（Toolbar / Ctrl+R 入口）----------
let inputEl: HTMLDivElement | null = null
let inputEditor: Editor | null = null
let inputFrom = -1
let inputTo = -1

// Enter 确认提交（Ctrl+R / Toolbar 共用逻辑）
// 返回新批注节点在 doc 中的位置（其后的光标恢复用；doc 已插入节点，原选区已漂移）
async function submitAnnotation(
  text: string
): Promise<{ pos: number; nodeSize: number } | null> {
  if (!inputEditor || inputTo <= inputFrom) return null
  const { resolveUserName } = await import('./user-name')
  const name = await resolveUserName()
  addAnnotation(inputEditor, inputFrom, inputTo, text, name)
  // 激活新批注（抽屉展开定位）
  let info: { pos: number; nodeSize: number } | null = null
  inputEditor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    doc.descendants((n, p) => {
      if (n.type.name === 'annotation' && p >= inputFrom - 5 && p <= inputTo + 5) {
        info = { pos: p, nodeSize: n.nodeSize }
        setActiveAnnotation('', `p-${p}`)
        return false
      }
      return true
    })
  })
  return info
}

// 关闭浮窗后把焦点还给编辑器，并把选区恢复到原选中文本（或新批注文本）
// 注意：Editor.action 是同步方法（返回 T 而非 Promise），同步异常用 try/catch 兜底
function restoreEditorFocusSeq(from: number, to: number): void {
  const editor = inputEditor
  if (!editor) return
  try {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const doc = view.state.doc
      const max = doc.content.size
      const f = Math.min(Math.max(from, 0), max)
      const t = Math.min(Math.max(to, from), max)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, f, t)))
      view.focus()
    })
  } catch {
    /* 编辑器可能已销毁 */
  }
}

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
    ta.placeholder = '在此输入评论，esc取消，enter确认，shift+enter换行'
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        hideAnnotationInput()
        // doc 未变：选区直接恢复到原选中文本
        restoreEditorFocusSeq(inputFrom, inputTo)
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const text = ta.value.trim()
        hideAnnotationInput()
        if (text && inputEditor && inputTo > inputFrom) {
          // 提交是异步的（用户名解析）：恢复选区要等插入完成后，定位到新批注文本内部
          void submitAnnotation(text)
            .then((info) => {
              if (info) {
                restoreEditorFocusSeq(info.pos + 1, info.pos + info.nodeSize - 1)
              } else {
                restoreEditorFocusSeq(inputFrom, inputTo)
              }
            })
            .catch(() => {
              try {
                restoreEditorFocusSeq(inputFrom, inputTo)
              } catch {
                /* 编辑器已销毁 */
              }
            })
        } else {
          // 空文本：等同取消
          restoreEditorFocusSeq(inputFrom, inputTo)
        }
      }
      // Shift+Enter：保留 textarea 默认换行
    })
    inputEl.appendChild(ta)
    document.body.appendChild(inputEl)
  }
  const ta = inputEl.querySelector('.annotation-input-ta') as HTMLTextAreaElement
  ta.value = ''
  // 先显示再测量（display:none 时 offsetHeight=0），同步 reflow 拿到真实尺寸后定位
  inputEl.classList.add('annotation-input-visible')
  // 定位：跟随选区（用编辑器 view 的 coords，视口相对）
  // 垂直：优先在选区下方；下方放不下（锚点在视口底部附近）→ 上翻到选区上方（类 tooltip）；
  //       极端情况上下都不够 → 贴顶保底。水平：左右钳制（留边距，防贴边/出屏）。
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const coords = view.coordsAtPos(to)
    if (inputEl) {
      const h = inputEl.offsetHeight || 104
      const w = inputEl.offsetWidth || 240
      const GAP = 6
      const MARGIN = 8
      let top = coords.bottom + GAP
      if (top + h + MARGIN > window.innerHeight) {
        top = coords.top - GAP - h
        if (top < MARGIN) top = MARGIN
      }
      const maxLeft = window.innerWidth - w - MARGIN
      const left = Math.min(Math.max(MARGIN, coords.left), Math.max(MARGIN, maxLeft))
      inputEl.style.left = `${left}px`
      inputEl.style.top = `${top}px`
    }
  })
  ta.focus()
}

export function hideAnnotationInput(): void {
  inputEl?.classList.remove('annotation-input-visible')
}

export { LEVEL_COLOR } from './card-color'
