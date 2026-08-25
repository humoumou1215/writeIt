// 批注交互（v3 抽屉模式 / v8 重叠批注）：
//   点击正文锚点（mark.annotation / .annotation-dynamic）→ 激活批注 + 展开抽屉（drawer 订阅展开）
//   v8：批注为 mark（可嵌套/重叠）——点击处可能命中多条批注（DOM 嵌套）→
//       1 条直接激活；≥2 条弹「批注选择气泡」，点选后激活对应卡片
//   批注内容展示/评论线程/连线全部在 AnnotationDrawer.vue；本模块保留锚点激活 + 添加批注输入浮窗。
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import {
  setActiveAnnotation,
  addAnnotation,
  findCodeBlockInSelection,
  findCrossFileBlockInSelection,
  addBlockAnnotation,
  getPersistedAnnotations,
  type Annotation,
} from './service'
import { state, toast } from '../state/store'

let activeTabId = ''
let editorRef: Editor | null = null

function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  const anchor = target?.closest?.('mark.annotation, .annotation-dynamic') as HTMLElement | null
  if (!anchor) return
  const tabId = activeTabId
  if (!tabId) return
  // 持久化批注（mark）：从 target 向上收集所有嵌套 annotation mark 的 id（重叠批注）
  if (anchor.tagName.toLowerCase() === 'mark') {
    const ids: string[] = []
    let el: HTMLElement | null = anchor
    while (el) {
      const id = el.getAttribute('data-a')
      if (id && !ids.includes(id)) ids.push(id)
      el = el.parentElement
        ? (el.parentElement.closest('mark.annotation, .annotation-dynamic') as HTMLElement | null)
        : null
    }
    if (!ids.length) return
    if (ids.length === 1) {
      setActiveAnnotation(tabId, ids[0])
      return
    }
    // 该处有多条批注 → 选择气泡（列出各批注，点选激活）
    showAnnotationPicker(tabId, ids, e.clientX, e.clientY)
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
  if (tab?.viewMode === 'source') {
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

// ---------- 重叠批注选择气泡 ----------
let pickerEl: HTMLDivElement | null = null
let onPickerDocClick: ((e: MouseEvent) => void) | null = null

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

/** 点击处命中 ≥2 条批注 → 气泡列出（作者 + 锚文本 + 首条评论），点选激活对应卡片 */
function showAnnotationPicker(tabId: string, ids: string[], x: number, y: number): void {
  hideAnnotationPicker()
  // 从当前编辑器 doc 收集批注详情（mark id → Annotation）
  const annsById = new Map<string, Annotation>()
  editorRef?.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    for (const a of getPersistedAnnotations(view.state.doc)) annsById.set(a.id, a)
  })
  const el = document.createElement('div')
  el.className = 'annotation-picker'
  el.setAttribute('role', 'listbox')
  const title = document.createElement('div')
  title.className = 'annotation-picker-title'
  title.textContent = `该处有 ${ids.length} 条批注`
  el.appendChild(title)
  for (const id of ids) {
    const ann = annsById.get(id)
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'annotation-picker-item'
    const author = esc(ann?.thread[0]?.author ?? '?')
    const anchor = esc(ann?.anchorText ?? '')
    const content = esc(ann?.thread[0]?.content ?? '')
    item.innerHTML = `<span class="ap-author">${author}</span><span class="ap-anchor">${anchor}</span><span class="ap-content">${content}</span>`
    item.addEventListener('click', () => {
      hideAnnotationPicker()
      setActiveAnnotation(tabId, id)
    })
    el.appendChild(item)
  }
  const MARGIN = 8
  const w = Math.min(280, window.innerWidth - MARGIN * 2)
  el.style.left = `${Math.max(MARGIN, Math.min(x, window.innerWidth - w - MARGIN))}px`
  el.style.top = `${Math.min(y + 12, window.innerHeight - 160)}px`
  document.body.appendChild(el)
  pickerEl = el
  // 点击气泡外部关闭（capture 阶段，避免与 onDocumentClick 冲突）
  onPickerDocClick = () => {
    if (!pickerEl) {
      document.removeEventListener('click', onPickerDocClick!, true)
      onPickerDocClick = null
      return
    }
    hideAnnotationPicker()
  }
  setTimeout(() => {
    if (onPickerDocClick) document.addEventListener('click', onPickerDocClick, true)
  }, 0)
}

function hideAnnotationPicker(): void {
  pickerEl?.remove()
  pickerEl = null
  if (onPickerDocClick) {
    document.removeEventListener('click', onPickerDocClick, true)
    onPickerDocClick = null
  }
}

// ---------- 添加批注输入浮窗（Toolbar / Ctrl+R 入口）----------
let inputEl: HTMLDivElement | null = null
let inputEditor: Editor | null = null
let inputFrom = -1
let inputTo = -1
// v7 变体 D：选区涉及 code_block → 整块批注（锚点=代码块摘要，批注 mark 放代码块上方段落）
let inputBlockMode = false
let inputBlockPos = -1

// Enter 确认提交（Ctrl+R / Toolbar 共用逻辑）
// 返回 { from, to }（恢复选区用；addMark 不改变文档结构，原选区位置即新批注位置）。
async function submitAnnotation(
  text: string
): Promise<{ from: number; to: number; shift?: number } | null> {
  if (!inputEditor || inputTo <= inputFrom) return null
  const { resolveUserName } = await import('./user-name')
  const name = await resolveUserName()
  // 变体 D：代码块内选中 → 整块批注（返回的 shift 供光标恢复到代码块内原位）
  if (inputBlockMode && inputBlockPos >= 0) {
    const info = addBlockAnnotation(inputEditor, inputBlockPos, text, name)
    if (info) {
      setActiveAnnotation('', info.id)
      return { from: inputFrom, to: inputTo, shift: info.shift }
    }
    return null
  }
  const id = addAnnotation(inputEditor, inputFrom, inputTo, text, name)
  // 激活新批注（抽屉展开定位）
  if (id) setActiveAnnotation('', id)
  return { from: inputFrom, to: inputTo }
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
  // v8.1：选区「跨越」嵌入块（file_block）→ 不支持，toast 提示（完全在块内选中不拦截，m6d 语义）
  let embedCrossed = false
  // 变体 D：检测选区是否涉及 code_block → 整块批注模式
  inputBlockMode = false
  inputBlockPos = -1
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (findCrossFileBlockInSelection(view.state.doc, from, to)) {
      embedCrossed = true
      return
    }
    const cb = findCodeBlockInSelection(view.state.doc, from, to)
    if (cb) {
      inputBlockMode = true
      inputBlockPos = cb.pos
    }
  })
  if (embedCrossed) {
    toast('暂不支持跨越嵌入块选区的批注，请对嵌入块，或在嵌入块内单独选中文本添加批注', 'info')
    return
  }
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
          // 提交是异步的（用户名解析）：恢复选区要等插入完成后
          void submitAnnotation(text)
            .then((info) => {
              if (info) {
                // addMark 不改变文档结构：直接恢复原选区；变体D 插入段落使代码块内位置后移 shift
                restoreEditorFocusSeq(
                  info.from + (info.shift ?? 0),
                  info.to + (info.shift ?? 0)
                )
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
  // 块级批注提示：告知用户将以整个代码块为锚点
  ta.placeholder = inputBlockMode
    ? '代码块内批注将以整个代码块为锚点；esc取消，enter确认'
    : '在此输入评论，esc取消，enter确认，shift+enter换行'
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