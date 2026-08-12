// file_block 的 NodeView：卡片边框 + 头部（路径/只读徽标）+ 内容区
// 内容区是 contentDOM，ProseMirror 原生渲染容器内的块；只读变体禁用编辑
import type { NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { ViewMutationRecord } from 'prosemirror-view'
import type { Ctx } from '@milkdown/kit/ctx'

export class FileBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement | null
  private readonly header: HTMLElement

  constructor(node: ProseNode, _view: unknown, _getPos: () => number | undefined) {
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
    content.contentEditable = node.attrs.readonly ? 'false' : 'true'

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
