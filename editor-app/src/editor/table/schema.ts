// 表格增强插件——hardbreak 在表格内的序列化 + <nbr/> 的 round-trip（需求1）
// 方案（已验证需求1的两种机制）：
//  - milkdown 默认剥掉表格单元格里的 `<br>`，但**自定义标签 `<nbr/>` 会以一个 html 节点原样存活**。
//  1. Enter 插入 hardbreak → 渲染为 <br>；其在表格内的 toMarkdown 输出 `<nbr />`（自定义标签，可 round-trip）。
//  2. 重开含 `<nbr/>` 的文件 → 解析为 html 节点 → 本插件把“值为表格换行标签”的 html 节点**转成 hardbreak**
//     （原生渲染为 <br>，且再次序列化仍是 `<nbr />`）→ round-trip 达成。
import { $nodeSchema, $prose } from '@milkdown/kit/utils'
import { hardbreakAttr } from '@milkdown/kit/preset/commonmark'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'

/** 单元格内换行的自定义标签（milkdown 不剥、可 round-trip；外部渲染器不识别，导出时可按需归一为 <br/>） */
export const TABLE_BREAK_TAG = '<nbr />'

/** 值是否为表格换行标签（<nbr> / <nbr/> 等；兼容 <br>） */
export function isBreakHtml(value: string): boolean {
  return /^<(?:n?br)\s*\/?>?$/i.test(value.trim())
}

/** 判断序列化时当前是否位于表格内（SerializerState 是 Stack，保存打开的容器节点） */
function isInsideTable(state: { elements?: Array<{ type: unknown }> }): boolean {
  const el = state.elements
  if (!el) return false
  return el.some((e) => {
    const t = String(e.type)
    return t === 'table' || t === 'tableRow' || t === 'tableCell' || t === 'tableHeader'
  })
}

/// 覆盖 hardbreak：仅 toMarkdown（表格内换行 → `<nbr />`）；解析维持默认
export const tableHardbreakSchema = $nodeSchema('hardbreak', (ctx) => ({
  inline: true,
  group: 'inline',
  attrs: {
    isInline: {
      default: false,
      validate: 'boolean',
    },
  },
  selectable: false,
  parseDOM: [
    { tag: 'br' },
    {
      tag: 'span[data-type="hardbreak"]',
      getAttrs: () => ({ isInline: true }),
    },
  ],
  toDOM: (node: { attrs: { isInline: boolean } }) =>
    node.attrs.isInline
      ? ['span', ctx.get(hardbreakAttr.key)(node), ' ']
      : ['br', ctx.get(hardbreakAttr.key)(node)],
  parseMarkdown: {
    match: ({ type }: { type?: string }) => type === 'break',
    runner: (
      state: { addNode: (t: never, attrs?: never) => void },
      node: { data?: { isInline?: boolean } },
      type: never
    ) => {
      state.addNode(type as never, {
        isInline: Boolean(node.data?.isInline),
      } as never)
    },
  },
  leafText: () => '\n',
  toMarkdown: {
    match: (node: { type: { name: string } }) => node.type.name === 'hardbreak',
    runner: (
      state: { addNode: (t: string, v?: unknown, c?: unknown) => void },
      node: { attrs: { isInline: boolean } }
    ) => {
      // 表格内换行 → `<nbr />`
      if (isInsideTable(state as never)) {
        state.addNode('html', undefined, TABLE_BREAK_TAG)
        return
      }
      if (node.attrs.isInline) state.addNode('text', undefined, '\n')
      else state.addNode('break')
    },
  },
}))

/// 把文档里「值为表格换行标签」的 html 节点转成 hardbreak（让 <nbr/> 显示为真换行）
function buildHtmlToBreakTr(state: {
  tr: { replaceWith: (a: number, b: number, c: unknown) => void; steps: unknown[] }
  doc: { descendants: (fn: (n: { type: { name: string }; attrs: { value: string }; nodeSize: number }, pos: number) => void) => void }
  schema: { nodes: { hardbreak: { create: () => unknown } } }
}): {
  replaceWith: (a: number, b: number, c: unknown) => void
  steps: unknown[]
} | null {
  let tr: {
    replaceWith: (a: number, b: number, c: unknown) => void
    steps: unknown[]
  } | null = null
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'html' && isBreakHtml(node.attrs.value)) {
      if (!tr) tr = state.tr
      tr.replaceWith(pos, pos + node.nodeSize, state.schema.nodes.hardbreak.create())
    }
  })
  return tr
}

/** 需1 round-trip：html(<nbr/>) → hardbreak。初始加载 + 粘贴/插入后都会转换（幂等，无循环） */
export const htmlBreakToHardbreakPlugin = $prose(() => {
  const key = new PluginKey('WRITEIT_HTML_TO_BREAK')
  return new Plugin({
    key,
    view(view) {
      requestAnimationFrame(() => {
        const tr = buildHtmlToBreakTr(view.state as never)
        if (tr) view.dispatch(tr)
      })
      return {}
    },
    appendTransaction: (_trs, _old, state) => {
      const tr = buildHtmlToBreakTr(state as never)
      return tr && tr.steps.length ? tr : null
    },
  })
})
