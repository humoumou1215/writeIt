// 批注语法解析（remark 插件）：`<mark data-a='id' data-note='评论线程JSON'>锚定文本</mark>`
// v8（方案A：嵌套/重叠支持）：
//   - 栈式解析：开标签 push 上下文、闭标签 pop → 嵌套/重叠的 mark 标签原样还原为嵌套的
//     annotation mdast 节点（{type:'annotation', id, note, children}），交由 mark parseMarkdown
//     openMark/closeMark 逐层应用（PM mark 天然叠加/交叉）。
//   - 属性顺序兼容：data-a 在前（新格式）或 data-note 在前（旧格式/无 data-a）都能解析。
//   - 转义检测：`\<mark` 开头的标签不解析（与引用机制的 \[[ 一致）；未闭合的标签按普通 html 原样保留。
// remark-parse 会把开标签/内容/闭标签拆成多个 inline 节点（html + text + html）。
type MdastNode = {
  type: string
  value?: string
  children?: MdastNode[]
  position?: { start?: { offset?: number } }
  [key: string]: unknown
}

// 开标签：包装引号感知的 data-note（值内允许出现与包裹引号不同的引号，含 JSON 双引号）
// 且兼容 data-a 在 data-note 前后两种顺序。值内 `(?:(?!\1).)*` 负向前瞻——匹配任意不等于当前包裹引号的字符。
// 组：note = m[2]（data-note 在前）或 m[8]（data-a 在前）；id = m[4] 或 m[6]。
const OPEN_RE = /^<mark\s+(?:data-note=(["'])((?:(?!\1).)*)\1(?:\s+data-a=(["'])([^"']*)\3)?|data-a=(["'])([^"']*)\5\s+data-note=(["'])((?:(?!\7).)*)\7)\s*>$/i

interface MarkCtx {
  /** 原始开标签文本（未闭合时原样还原） */
  raw: string
  id: string
  note: string
  children: MdastNode[]
}

export function remarkAnnotation() {
  return (tree: MdastNode, file: { value?: unknown }) => {
    const src = String(file.value ?? '')

    const walk = (parent: MdastNode) => {
      if (!parent.children) return
      const children = parent.children
      const next: MdastNode[] = []
      // 当前嵌套栈（栈顶 = 最内层未闭合批注）
      const stack: MarkCtx[] = []

      const pushTo = (node: MdastNode) => {
        const top = stack[stack.length - 1]
        if (top) top.children.push(node)
        else next.push(node)
      }

      for (const node of children) {
        if (node.type === 'html' && typeof node.value === 'string') {
          const v = node.value.trim()
          const m = OPEN_RE.exec(v)
          if (m) {
            const startOffset = node.position?.start?.offset ?? 0
            // 转义检测：标签前一个字符是反斜杠 → 不解析
            if (src[startOffset - 1] === '\\') {
              pushTo(node)
              continue
            }
            // 开标签：记录原始文本（未闭合还原用）+ id/note，进入嵌套上下文
            stack.push({
              raw: v,
              id: (m[4] ?? m[6] ?? '').trim(),
              note: m[2] ?? m[8] ?? '',
              children: [],
            })
            continue
          }
          if (v.toLowerCase() === '</mark>') {
            const top = stack.pop()
            if (top) {
              // 合并为 annotation mdast 节点（children = 锚定区间内的所有 inline 节点）
              pushTo({ type: 'annotation', id: top.id, note: top.note, children: top.children })
            } else {
              // 孤立的闭标签 → 普通 html
              pushTo(node)
            }
            continue
          }
        }
        // 非标签节点（text / 其他 html / break 等）：进入当前最内层 context
        pushTo(node)
      }

      // 未闭合的开标签（栈剩余）：还原为「原始开标签 + 已收集 children」的普通节点序列
      // （后续内容因栈未弹出已并入 children，按序展开输出即与原文一致）
      while (stack.length) {
        const top = stack.pop()!
        const list: MdastNode[] = [{ type: 'html', value: top.raw }, ...top.children]
        const outer = stack[stack.length - 1]
        if (outer) outer.children.push(...list)
        else next.push(...list)
      }

      parent.children = next
      for (const child of next) {
        if (child.children) walk(child)
      }
    }

    walk(tree)
  }
}