// M13：diffContainer 的 NodeView——块级底色容器（add 绿底 / del 红底划线）
import type { Node, NodeViewConstructor } from '@milkdown/kit/prose/view'

export class DiffContainerView {
  dom: HTMLDivElement
  contentDOM: HTMLDivElement

  constructor(node: unknown) {
    console.log('[diff-view] node:', JSON.stringify(node).slice(0, 200))
    const attrs = (node as { attrs?: { kind?: string } })?.attrs
    const kind = attrs?.kind === 'del' ? 'del' : 'add'
    this.dom = document.createElement('div')
    this.dom.className = `diff-container diff-${kind}`
    const label = document.createElement('div')
    label.className = 'diff-container-label'
    label.textContent = kind === 'add' ? '新增' : '删除'
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'diff-container-content'
    this.dom.appendChild(label)
    this.dom.appendChild(this.contentDOM)
  }
}

export const diffContainerNodeView: NodeViewConstructor = (node) =>
  new DiffContainerView(node) as unknown as ReturnType<NodeViewConstructor>
