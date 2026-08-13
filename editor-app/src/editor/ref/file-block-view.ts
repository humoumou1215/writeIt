// file_block 的 NodeView：卡片边框 + 头部（路径/只读徽标）+ 内容区
// 内容区是 contentDOM，ProseMirror 原生渲染容器内的块；只读变体禁用编辑
import type { NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { ViewMutationRecord, EditorView } from 'prosemirror-view'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { Ctx } from '@milkdown/kit/ctx'

export class FileBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement | null
  private readonly header: HTMLElement

  constructor(node: ProseNode, editorViewRef: unknown, getPosRef: () => number | undefined) {
    this.dom = document.createElement('div')
    this.dom.className = 'ref-file-block' + (node.attrs.readonly ? ' readonly' : '')

    this.header = document.createElement('div')
    this.header.className = 'ref-file-block-header'
    const badge = node.attrs.readonly ? '🔒 只读引用' : '📄 引用'
    this.header.innerHTML = ''
    const badgeEl = document.createElement('span')
    badgeEl.className = 'ref-file-block-badge'
    badgeEl.textContent = badge
    const pathEl = document.createElement('span')
    pathEl.className = 'ref-file-block-path'
    pathEl.textContent = node.attrs.path
    this.header.append(badgeEl, pathEl)

    const content = document.createElement('div')
    content.className = 'ref-file-block-content'
    // 只读变体禁编辑；可编辑块不显式设 contenteditable（继承编辑器根的可编辑性——
    // 显式 'true' 造成嵌套 contenteditable，可能干扰 ProseMirror 的输入/IME 组合同步）
    if (node.attrs.readonly) content.contentEditable = 'false'

    // 点击块任意部分（含头部徽标/边缘）→ 强制聚焦编辑器并把光标移入块内容。
    // 用户反馈：点击块内有时编辑器未获焦点（输入丢失、userEditedAt 无更新）。
    const focusIntoBlock = () => {
      if (node.attrs.readonly) return
      const pos = getPosRef()
      if (pos == null) return
      const editorView = editorViewRef as unknown as EditorView | null
      if (!editorView) return
      editorView.focus()
      // 若点击的是头部/非内容区（ProseMirror 未自行设置 selection），把光标移到块内开头
      try {
        const doc = editorView.state.doc
        const block = doc.nodeAt(pos)
        if (!block || block.type.name !== 'file_block') return
        const $pos = doc.resolve(pos + 1)
        const sel = TextSelection.near($pos)
        if (!editorView.state.selection.eq(sel)) {
          editorView.dispatch(editorView.state.tr.setSelection(sel))
        }
      } catch {
        /* 忽略 */
      }
    }
    this.header.addEventListener('mousedown', (e) => {
      e.preventDefault()
      focusIntoBlock()
    })
    // 内容区：延后聚焦，避免与 ProseMirror 自身的 click selection 处理冲突
    content.addEventListener('mousedown', () => {
      setTimeout(focusIntoBlock, 0)
    })

    this.dom.append(this.header, content)
    this.contentDOM = content
  }

  // 只读模式下忽略 ProseMirror 对内容 DOM 的变更（防止误改）
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (this.contentDOM?.getAttribute('contenteditable') === 'false') return true
    // 头部自身的变更由我们管理
    return this.header.contains(mutation.target as unknown as Node) ?? false
  }

  stopEvent(event: Event): boolean {
    // 只读模式下拦截内容区的输入
    if (this.contentDOM?.getAttribute('contenteditable') === 'false') {
      const target = event.target as HTMLElement | null
      return this.contentDOM.contains(target) && !this.header.contains(target)
    }
    return false
  }

  destroy() {
    this.dom.remove()
  }
}

export const fileBlockView = (_ctx: Ctx): NodeViewConstructor => {
  return (node, view, getPos) => new FileBlockView(node, view, getPos)
}
