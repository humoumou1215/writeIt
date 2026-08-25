// file_block 的 NodeView：卡片边框 + 头部（路径/只读徽标）+ 内容区
// 内容区是 contentDOM，ProseMirror 原生渲染容器内的块；只读变体禁用编辑
// + 多层嵌入治理：collapsed 非空（环 / 超深折叠）→ 渲染折叠提示卡（不可编辑），
//   点击链路路径跳到对应源文件（经 refClickPlugin 的 a.ref-file 处理，无新接线）。
import type { NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { ViewMutationRecord, EditorView } from 'prosemirror-view'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { Ctx } from '@milkdown/kit/ctx'
import { MAX_EMBED_DEPTH, type CollapsedInfo } from './embed-chain'

export class FileBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement | null
  private readonly header: HTMLElement
  private curNode: ProseNode

  private readonly editorView: unknown
  constructor(node: ProseNode, editorViewRef: unknown, getPosRef: () => number | undefined) {
    this.editorView = editorViewRef
    this.curNode = node
    const collapsed = (node.attrs.collapsed as null | CollapsedInfo) ?? null
    const locked = Boolean(node.attrs.readonly) || Boolean(collapsed)
    this.dom = document.createElement('div')
    this.dom.className =
      'ref-file-block' +
      (node.attrs.readonly ? ' readonly' : '') +
      (collapsed ? ' is-collapsed' : '')
    if (collapsed) {
      this.dom.setAttribute('data-collapsed', '')
      this.dom.setAttribute('data-chain', collapsed.chain.join('|'))
    }

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

    // 折叠提示卡（collapsed 非空）：与 contentDOM 同级的手写 DOM（B4：不污染内容 DOM），
    // contentDOM 保持空 + 禁编辑；点击链路路径 → refClickPlugin 打开对应源文件。
    if (collapsed) {
      const hint = document.createElement('div')
      hint.className = 'ref-file-block-collapsed'
      const line = document.createElement('div')
      line.className = 'ref-hint-line'
      line.textContent =
        collapsed.reason === 'cycle'
          ? `↻ 循环引用：${node.attrs.path} 已在上级层级出现`
          : `⤓ 嵌套层级超过 ${MAX_EMBED_DEPTH} 层，已折叠`
      hint.append(line)
      if (collapsed.chain && collapsed.chain.length) {
        const chainEl = document.createElement('div')
        chainEl.className = 'ref-hint-chain'
        collapsed.chain.forEach((p, i) => {
          if (i > 0) chainEl.append(' › ')
          const a = document.createElement('a')
          a.className = 'ref-file'
          a.setAttribute('data-path', p)
          a.textContent = p
          a.title = p
          chainEl.append(a)
        })
        hint.append(chainEl)
      }
      this.dom.append(this.header, hint)
    } else {
      this.dom.append(this.header)
    }

    const content = document.createElement('div')
    content.className = 'ref-file-block-content'
    // 只读 / 折叠变体禁编辑；可编辑块不显式设 contenteditable（继承编辑器根的可编辑性——
    // 显式 'true' 造成嵌套 contenteditable，可能干扰 ProseMirror 的输入/IME 组合同步）
    if (locked) content.contentEditable = 'false'

    // 头部点击（非编辑区，ProseMirror 不自行处理）→ 聚焦 + 光标移入块内开头，
    // 并同步 DOM selection（否则 DOM 光标与 view selection 不一致，ProseMirror 丢弃输入）。
    // 注意：内容区点击不要干预（ProseMirror 自然处理 selection——干预会破坏 DOM/view 一致性，
    // 导致输入进 DOM 但不进 doc）。
    this.header.addEventListener('mousedown', (e) => {
      if (locked) return
      e.preventDefault()
      const pos = getPosRef()
      const editorView = editorViewRef as unknown as EditorView | null
      if (pos == null || !editorView) return
      try {
        const doc = editorView.state.doc
        const block = doc.nodeAt(pos)
        if (!block || block.type.name !== 'file_block') return
        const target = pos + 1
        const $pos = doc.resolve(target)
        const sel = TextSelection.near($pos)
        if (!editorView.state.selection.eq(sel)) {
          editorView.dispatch(editorView.state.tr.setSelection(sel))
        }
        editorView.focus()
        // DOM selection 同步到块内开头（确保与 view selection 一致）
        const dom = editorView.domAtPos(target)
        const range = document.createRange()
        try {
          range.setStart(dom.node, dom.offset)
        } catch {
          range.selectNodeContents(editorView.dom)
          range.collapse(true)
        }
        range.collapse(true)
        const sel2 = window.getSelection()
        if (sel2) {
          sel2.removeAllRanges()
          sel2.addRange(range)
        }
      } catch {
        /* 忽略 */
      }
    })

    // 实验：dom 仅含 contentDOM（header 分离——验证 header 元素干扰输入映射的假设）
    // 拦截内容区文本输入（NodeView 内容 DOM 无 pmViewDesc → DOMObserver 不同步）
    content.addEventListener('beforeinput', this.handleContentBeforeInput)

    // header 已在上面按折叠/非折叠分支追加；
    // 折叠时 content 保持空容器（提示卡是 contentDOM 外的手写 DOM，不污染内容结构）
    this.dom.append(content)
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

  /**
   * 兜底：拦截块内容区的文本输入（beforeinput insertText/insertCompositionText），
   * 手动 dispatch 到 doc（NodeView 内容 DOM 的 DOMObserver 同步不可靠）。
   * 不再强制 update() 重建（频繁重建会引发监听竞态）。
   * 根因：物化（replaceWith）后的 NodeView 内容 DOM 没有 pmViewDesc，ProseMirror 的
   * DOMObserver 无法把块内 DOM 文本变化同步到 doc（表格/宿主段落正常——它们有 desc）。
   * 这里在浏览器把文本插入 DOM 前拦截，直接用 ProseMirror 事务插入 → doc 与 DOM 一致。
   */
  private handleContentBeforeInput = (e: Event) => {
    const ev = e as InputEvent
    const inputType = ev.inputType || ''
    const view = this.editorView as unknown as EditorView | null
    if (!view) return
    // 普通文本插入 + IME 组合文本：拦截默认（浏览器改 DOM）→ 手动 dispatch 到 doc。
    // 根因：NodeView 内容 DOM 无 pmViewDesc → DOMObserver 不把块内文本变化同步到 doc。
    if ((inputType === 'insertText' || inputType === 'insertCompositionText') && ev.data) {
      e.preventDefault()
      try {
        const { from, to } = view.state.selection
        view.dispatch(view.state.tr.insertText(ev.data, from, to).scrollIntoView())
      } catch {
        /* 忽略 */
      }
    }
    // insertFromPaste / drop 等由 ProseMirror 的 clipboard 处理（dispatch），不需要拦截
    // deleteContentBackward 等由 ProseMirror keymap 处理（keydown → dispatch）
  }

  update(node: ProseNode): boolean {
    // 返回 true → PM 用 updateChildren 维护 contentDOM 子节点（desc 保留、DOM 复用、光标稳定）。
    // 之前恒返回 false → 每次输入/物化都强制重建 NodeView → 光标/selection 丢失（用户问题2根因），
    // 且 beforeinput 手动 dispatch 与 PM 原生输入叠加产生双插（问题1根因）。
    // attrs 变化（collapsed 折叠态 / readonly）影响卡片 UI 结构（折叠提示卡/只读徽标）——
    // 这些由 PM 重建承载（返回 false 安全重建），普通 content 变化返回 true 让 PM 增量更新。
    const prev = this.curNode
    this.curNode = node
    if (
      !prev ||
      Boolean(prev.attrs.collapsed) !== Boolean(node.attrs.collapsed) ||
      prev.attrs.readonly !== node.attrs.readonly
    ) {
      return false // 折叠/只读态切换 → 交还 PM 完整重建（卡面结构变化）
    }
    return true
  }

  destroy() {
    this.dom.remove()
  }
}

export const fileBlockView = (_ctx: Ctx): NodeViewConstructor => {
  return (node, view, getPos) => new FileBlockView(node, view, getPos)
}
