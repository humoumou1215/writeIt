// M13：diff 节点 schema——diffDel / diffIns（内联高亮）；M14 移除 diffContainer（::: diff-* 容器废弃）
import { $nodeSchema } from '@milkdown/kit/utils'

console.log('[diff-nodes] schema module loaded')

/** diffDel：{--删除--} → 红底划线 */
export const diffDelSchema = $nodeSchema('diffDel', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: { value: { default: '' } },
  parseDOM: [
    {
      tag: 'span.diff-del',
      getAttrs: (dom) => ({ value: dom.textContent ?? '' }),
    },
  ],
  toDOM: (node) => ['span', { class: 'diff-del' }, node.attrs.value as string],
  parseMarkdown: {
    match: (node) => node.type === 'diffDel',
    runner: (state, node, type) => {
      state.addNode(type, { value: String((node.value as string) ?? '') })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'diffDel',
    runner: (state, node) => {
      state.addNode('text', undefined, `{--${node.attrs.value}--}`)
    },
  },
}))

/** diffIns：{++新增++} → 绿底 */
export const diffInsSchema = $nodeSchema('diffIns', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: { value: { default: '' } },
  parseDOM: [
    {
      tag: 'span.diff-ins',
      getAttrs: (dom) => ({ value: dom.textContent ?? '' }),
    },
  ],
  toDOM: (node) => ['span', { class: 'diff-ins' }, node.attrs.value as string],
  parseMarkdown: {
    match: (node) => node.type === 'diffIns',
    runner: (state, node, type) => {
      state.addNode(type, { value: String((node.value as string) ?? '') })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'diffIns',
    runner: (state, node) => {
      state.addNode('text', undefined, `{++${node.attrs.value}++}`)
    },
  },
}))

