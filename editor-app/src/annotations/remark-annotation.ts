// 批注语法解析（remark 插件）：`<mark data-note="评论">锚定文本</mark>`
// remark-parse 会把开标签/内容/闭标签拆成 3 个 inline 节点（html + text + html），
// 这里识别 mark data-note 模式，合并为一个 annotation mdast 节点（children = 锚定文本）。
// 转义检测：`\<mark` 开头的标签不解析（与引用机制的 \[[ 一致）。
type MdastNode = {
  type: string
  value?: string
  children?: MdastNode[]
  position?: { start?: { offset?: number } }
  [key: string]: unknown
}

const OPEN_RE = /^<mark\s+data-note="([^"]*)"\s*>$/i

export function remarkAnnotation() {
  return (tree: MdastNode, file: { value?: unknown }) => {
    const src = String(file.value ?? '')

    const walk = (parent: MdastNode) => {
      if (!parent.children) return
      const children = parent.children
      const next: MdastNode[] = []

      for (let i = 0; i < children.length; i++) {
        const node = children[i]
        // 匹配开标签 <mark data-note="...">（仅 html 节点）
        if (node.type === 'html' && typeof node.value === 'string') {
          const m = OPEN_RE.exec(node.value.trim())
          if (m) {
            const startOffset = node.position?.start?.offset ?? 0
            // 转义检测：标签前一个字符是反斜杠 → 不解析
            if (src[startOffset - 1] === '\\') {
              next.push(node)
              continue
            }
            // 收集后续内容直到闭标签 </mark>
            const inner: MdastNode[] = []
            let j = i + 1
            let closed = false
            for (; j < children.length; j++) {
              const c = children[j]
              if (c.type === 'html' && typeof c.value === 'string' && c.value.trim().toLowerCase() === '</mark>') {
                closed = true
                break
              }
              inner.push(c)
            }
            if (closed) {
              next.push({ type: 'annotation', note: m[1], children: inner })
              i = j // 跳过闭标签
              continue
            }
            // 没有闭标签 → 按普通文本处理
            next.push(node)
            continue
          }
        }
        next.push(node)
      }

      parent.children = next
      for (const child of next) {
        if (child.children) walk(child)
      }
    }

    walk(tree)
  }
}
