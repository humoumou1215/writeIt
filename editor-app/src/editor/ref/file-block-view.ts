// file_block 静态投影 NodeView。
// 宿主 ProseMirror 只保留 marker/占位节点；嵌入正文由 app 层从 DocStore 渲染，
// 因而不会再把 B/C/D 的可编辑副本放进 A 的编辑状态。
import type { NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { ViewMutationRecord, EditorView } from 'prosemirror-view'
import type { Ctx } from '@milkdown/kit/ctx'
import { MAX_EMBED_DEPTH, type CollapsedInfo } from './embed-chain'

export interface FileBlockProjectionCallbacks {
  render: (node: ProseNode, content: HTMLElement, view: EditorView) => void
  edit: (node: ProseNode, view: EditorView) => void
}

let callbacks: FileBlockProjectionCallbacks | null = null
const liveViews = new Set<FileBlockView>()

export function setFileBlockProjectionCallbacks(next: FileBlockProjectionCallbacks | null): void {
  callbacks = next
}

/** 模型更新后刷新全部静态投影；不生成 ProseMirror transaction。 */
export function refreshFileBlockProjections(): void {
  for (const view of liveViews) view.refreshProjection()
}

export class FileBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement | null = null
  private readonly header: HTMLElement
  private readonly content: HTMLElement
  private curNode: ProseNode
  private readonly editorView: EditorView

  constructor(node: ProseNode, editorView: unknown, getPos: () => number | undefined) {
    this.curNode = node
    this.editorView = editorView as EditorView
    const collapsed = (node.attrs.collapsed as null | CollapsedInfo) ?? null
    const locked = Boolean(node.attrs.readonly) || Boolean(collapsed)

    this.dom = document.createElement('div')
    this.dom.className = 'ref-file-block' + (node.attrs.readonly ? ' readonly' : '') + (collapsed ? ' is-collapsed' : '')
    // 宿主文档坐标供大纲把嵌入标题插回正确顺序；静态投影不在宿主 PM doc 内，
    // 因而不能事后从投影 root 反推这个位置。
    const pos = getPos()
    if (typeof pos === 'number') this.dom.dataset.outlineHostPos = String(pos)
    if (collapsed) {
      this.dom.dataset.collapsed = ''
      this.dom.dataset.chain = collapsed.chain.join('|')
    }

    this.header = document.createElement('div')
    this.header.className = 'ref-file-block-header'
    const badge = document.createElement('span')
    badge.className = 'ref-file-block-badge'
    badge.textContent = node.attrs.readonly ? '🔒 只读引用' : '📄 引用'
    const path = document.createElement('span')
    path.className = 'ref-file-block-path'
    path.textContent = String(node.attrs.path ?? '')
    this.header.append(badge, path)

    if (!locked) {
      const edit = document.createElement('button')
      edit.type = 'button'
      edit.className = 'ref-file-block-edit'
      edit.textContent = '编辑源文件'
      edit.addEventListener('mousedown', (e) => e.preventDefault())
      edit.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        callbacks?.edit(this.curNode, this.editorView)
      })
      this.header.append(edit)
    }

    this.content = document.createElement('div')
    this.content.className = 'ref-file-block-content'
    this.dom.append(this.header)
    if (collapsed) this.dom.append(this.makeCollapseHint(collapsed, String(node.attrs.path ?? '')))
    this.dom.append(this.content)
    liveViews.add(this)
    if (collapsed) this.content.style.display = 'none'
    else this.refreshProjection()
  }

  private makeCollapseHint(collapsed: CollapsedInfo, path: string): HTMLElement {
    const hint = document.createElement('div')
    hint.className = 'ref-file-block-collapsed'
    const line = document.createElement('div')
    line.className = 'ref-hint-line'
    line.textContent = collapsed.reason === 'cycle'
      ? `↻ 循环引用：${path} 已在上级层级出现`
      : `⤓ 嵌套层级超过 ${MAX_EMBED_DEPTH} 层，已折叠`
    hint.append(line)
    const chain = document.createElement('div')
    chain.className = 'ref-hint-chain'
    collapsed.chain.forEach((p, i) => {
      if (i) chain.append(' › ')
      const a = document.createElement('a')
      a.className = 'ref-file'
      a.dataset.path = p
      a.textContent = p
      chain.append(a)
    })
    hint.append(chain)
    return hint
  }

  refreshProjection(): void {
    if (this.curNode.attrs.collapsed || !callbacks) return
    callbacks.render(this.curNode, this.content, this.editorView)
  }

  ignoreMutation(_mutation: ViewMutationRecord): boolean {
    return true
  }

  stopEvent(event: Event): boolean {
    const target = event.target as Node | null
    if (!target || !this.dom.contains(target)) return false
    // 编辑按钮由 NodeView 自己处理；链接 click 交给 PM 的引用插件，
    // 普通静态正文只拦截按下事件，避免把它误当成宿主选区。
    if ((target as HTMLElement).closest?.('.ref-file-block-edit')) return true
    return event.type === 'mousedown' || event.type === 'beforeinput' || event.type === 'input'
  }

  update(node: ProseNode): boolean {
    const changed = this.curNode.attrs.path !== node.attrs.path ||
      this.curNode.attrs.readonly !== node.attrs.readonly ||
      Boolean(this.curNode.attrs.collapsed) !== Boolean(node.attrs.collapsed)
    if (changed) return false
    this.curNode = node
    this.refreshProjection()
    return true
  }

  destroy(): void {
    liveViews.delete(this)
    this.dom.remove()
  }
}

export const fileBlockView = (_ctx: Ctx): NodeViewConstructor =>
  (node, view, getPos) => new FileBlockView(node, view, getPos)

/** Diff 专用只读 NodeView：正文必须由 ProseMirror 通过 contentDOM 挂载，
 * 才能保留预填充结构、DecorationSet 和 data-dnote 锚点。 */
export const diffFileBlockView = (_ctx: Ctx): NodeViewConstructor =>
  (node) => {
    const dom = document.createElement('div')
    const collapsed = (node.attrs.collapsed as null | CollapsedInfo) ?? null
    dom.className = 'ref-file-block readonly' + (collapsed ? ' is-collapsed' : '')
    if (collapsed) {
      dom.dataset.collapsed = ''
      dom.dataset.chain = collapsed.chain.join('|')
    }

    const header = document.createElement('div')
    header.className = 'ref-file-block-header'
    const badge = document.createElement('span')
    badge.className = 'ref-file-block-badge'
    badge.textContent = '🔒 引用对比'
    const path = document.createElement('span')
    path.className = 'ref-file-block-path'
    path.textContent = String(node.attrs.path ?? '')
    header.append(badge, path)
    dom.append(header)

    if (collapsed) {
      const hint = document.createElement('div')
      hint.className = 'ref-file-block-collapsed'
      const line = document.createElement('div')
      line.className = 'ref-hint-line'
      line.textContent = collapsed.reason === 'cycle'
        ? `↻ 循环引用：${String(node.attrs.path ?? '')} 已在上级层级出现`
        : `⤓ 嵌套层级超过 ${MAX_EMBED_DEPTH} 层，已折叠`
      hint.append(line)
      dom.append(hint)
      return { dom, contentDOM: null, ignoreMutation: () => true, stopEvent: () => true }
    }

    const contentDOM = document.createElement('div')
    contentDOM.className = 'ref-file-block-content'
    dom.append(contentDOM)
    return {
      dom,
      contentDOM,
      ignoreMutation: () => false,
      stopEvent: () => true,
      update: (next: ProseNode) => next.type === node.type &&
        next.attrs.path === node.attrs.path && !next.attrs.collapsed,
    }
  }
