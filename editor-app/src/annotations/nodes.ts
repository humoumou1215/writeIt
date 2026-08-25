// 批注 mark schema：`<mark data-a='id' data-note='评论线程JSON'>锚定文本</mark>`
// v8（方案A：node → mark 化）：
//   - 批注从 inline 节点改为 mark（文本属性）→ 天生支持任意重叠/嵌套批注（345⊂12345、23×34 交叉）、
//     同一文本多条独立批注、段内软换行跨行（mark 覆盖 hardbreak），文本增删的位置跟踪由 PM 自动处理。
//   - id（data-a 属性）= 逻辑批注唯一键：卡片/激活/回复/删除/跨段分段合并全部按 id。
//     旧文件（无 data-a）解析时生成 id 回填，保存时单向升级为新格式。
//   - 序列化：mark toMarkdown 用 state.withMark() 产出自定义 mdast 类型 'annotation'，
//     输出标签由 remarkStringifyOptionsCtx.handlers 的 annotation handler 负责（见 index.ts）。
//   - 属性值用单引号包裹 → note 里的 JSON 双引号原样保留（md 可读性），
//     仅转义会破坏标签的字符（' → &#39;、& → &amp;、< → &lt;）；旧格式（双引号 + &quot;）解析兼容。
import { $markSchema } from '@milkdown/kit/utils'
import type { ParserState, SerializerState } from '@milkdown/transformer'

export const annotationSchema = $markSchema('annotation', () => {
  return {
    attrs: {
      /** 逻辑批注 id（data-a 属性；唯一键） */
      id: { default: '' },
      /** 批注内容（评论线程 JSON）；校验的动态批注不落盘，人工评论持久化 */
      note: { default: '' },
    },
    /** inclusive:false —— 在批注文本尾部继续输入不继承批注（防止高亮无限蔓延）；中间编辑不受影响 */
    inclusive: false,
    /** prohibits:'' —— 关键：PM 默认同 type mark 互斥（第二个会替换第一个，第二个等于第二个 → 重建），
     *  这会破坏「同一文本多条/重叠批注」。excludes:'' 表示不排除任何 mark，
     *  允许任意多个 annotation mark 在同一文本上共存（addToSet 按序保留全部）。 */
    excludes: '',
    parseDOM: [
      {
        tag: 'mark[data-note]',
        getAttrs: (dom) => ({
          id: dom.getAttribute('data-a') ?? '',
          note: dom.getAttribute('data-note') ?? '',
        }),
      },
    ],
    toDOM: (mark) => [
      'mark',
      { 'data-a': mark.attrs.id, 'data-note': mark.attrs.note, class: 'annotation' },
      0,
    ],
    parseMarkdown: {
      // mdast 由 remark-annotation 插件转换为 annotation 类型（可嵌套）
      match: (node) => node.type === 'annotation',
      runner: (state: ParserState, node, type) => {
        // note 在 md 里是 HTML 属性值（escapeAttr 转义过）→ 解码回原始值存入节点，
        // 保证 PM 节点内 note 恒为原始 JSON。旧文件无 data-a → 生成 id 回填。
        state.openMark(type, {
          id: String(node.id ?? '') || genAnnotationId(),
          note: unescapeAttr(String(node.note ?? '')),
        })
        if (node.children?.length) state.next(node.children)
        state.closeMark(type)
      },
    },
    toMarkdown: {
      // mark 版序列化：withMark 产出 mdast 节点 {type:'annotation', id, note, children}，
      // 开/闭标签由 remarkStringifyOptionsCtx.handlers.annotation 输出（见 ../annotations/index.ts）。
      match: (node) => node.type.name === 'annotation',
      runner: (state: SerializerState, mark) => {
        state.withMark(mark, 'annotation', undefined, {
          id: String(mark.attrs.id ?? ''),
          note: String(mark.attrs.note ?? ''),
        })
      },
    },
  }
})

/** 逻辑批注 id 生成（时间戳 + 随机，保证同文档内唯一；持久化为 data-a） */
export function genAnnotationId(): string {
  return `a-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`
}

/**
 * 单引号 HTML 属性值转义（v7.1）：
 * 双引号原样保留（JSON 键/分隔符，可读性优先）；
 * 仅转义会破坏标签/属性的字符：' → &#39;（防属性提前闭合）、& → &amp;（防实体歧义）、< → &lt;（防标签注入）。
 */
export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
}

/** escapeAttr 的逆操作：HTML 属性值 → 原始值（&amp; 最后替换，兼容 &amp;quot; 等组合） */
export function unescapeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}