// 批注节点 schema：`<mark data-note="评论">锚定文本</mark>`
// inline 容器节点（content: 'text*'），渲染为高亮 mark（不显示 note 属性）。
// 持久化：toMarkdown 输出 html 开标签 + 子内容 + 闭标签（remark-stringify 对 html 节点原样输出）。
import { $nodeSchema } from '@milkdown/kit/utils'
import type { NodeType } from '@milkdown/kit/prose/model'
import type { ParserState, SerializerState } from '@milkdown/transformer'

export const annotationSchema = $nodeSchema('annotation', (_ctx) => {
  return {
    group: 'inline',
    inline: true,
    content: 'text*',
    marks: 'emphasis strong inlineCode link',
    defining: true,
    isolating: true,
    selectable: true,
    attrs: {
      /** 批注内容（评论/消息）；校验的动态批注不落盘，人工评论持久化 */
      note: { default: '' },
    },
    parseDOM: [
      {
        tag: 'mark[data-note]',
        getAttrs: (dom) => ({ note: dom.getAttribute('data-note') ?? '' }),
      },
    ],
    toDOM: (node) => [
      'mark',
      { 'data-note': node.attrs.note, class: 'annotation' },
      0,
    ],
    parseMarkdown: {
      // mdast 由 remark-annotation 插件转换为 annotation 类型
      match: (node) => node.type === 'annotation',
      runner: (state: ParserState, node, type: NodeType) => {
        state.openNode(type, { note: String(node.note ?? '') })
        if (node.children?.length) state.next(node.children)
        state.closeNode()
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'annotation',
      runner: (state: SerializerState, node) => {
        // 开标签 html 节点（remark-stringify 原样输出 value）
        state.addNode('html', undefined, `<mark data-note="${escapeAttr(node.attrs.note)}">`)
        // 子内容（锚定文本）正常序列化
        state.next(node.content)
        state.addNode('html', undefined, '</mark>')
      },
    },
  }
})

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
