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
        // note 在 md 里是 HTML 属性值（escapeAttr 转义过）→ 解码回原始值存入节点，
        // 保证 PM 节点内 note 恒为原始 JSON（与 parseDOM / 运行时 setNodeMarkup 一致）。
        // 否则 writeback 的 round-trip（序列化→再解析→再序列化）会二次转义成 &amp;quot;，
        // 源文件打开后 parseThread 只解一层导致 JSON.parse 失败（作者未知/内容变原始字符串）。
        state.openNode(type, { note: unescapeAttr(String(node.note ?? '')) })
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

/** escapeAttr 的逆操作：HTML 属性值 → 原始值（&amp; 最后替换，兼容 &amp;quot; 等组合） */
function unescapeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
