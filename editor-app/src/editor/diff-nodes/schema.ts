// M13：diff 节点 schema——diffDel / diffIns（内联高亮）+ diffContainer（块级容器）
import { $nodeSchema } from '@milkdown/kit/utils'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'

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

/** diffContainer：::: diff-add / diff-del 块级容器（kind: add | del） */
export const diffContainerSchema = $nodeSchema('diffContainer', () => ({
  group: 'block',
  content: 'block*',
  attrs: { kind: { default: 'add' } },
  parseDOM: [
    {
      tag: 'div.diff-container',
      getAttrs: (dom) => ({
        kind: (dom as HTMLElement).classList.contains('diff-del') ? 'del' : 'add',
      }),
    },
  ],
  toDOM: (node) => ['div', { class: `diff-container ${node.attrs.kind === 'del' ? 'diff-del' : 'diff-add'}` }, 0],
  parseMarkdown: {
    match: (node) => (node as { type?: string }).type === 'diffContainer',
    runner: (state, node, type) => {
      const kind = (node.kind as string) ?? 'add'
      state.openNode(type, { kind })
      // next 的 isFragment 判定（对象有 size 属性）不认数组 → 逐节点 next
      const kids = (node.children as Array<Record<string, unknown>>) ?? []
      for (const c of kids) state.next(c as never)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'diffContainer',
    runner: (state, node) => {
      state.addNode('text', undefined, `::: diff-${node.attrs.kind}\n`)
      state.next(node.content?.content ?? [])
      state.addNode('text', undefined, `\n:::\n`)
    },
  },
}))

export const diffSchemas: MilkdownPlugin[] = [
  ...diffDelSchema,
  ...diffInsSchema,
  ...diffContainerSchema,
]
