// M13：remark 解析——内联 {--删除--} / {++新增++} → diffDel / diffIns 节点
// 转义：\{-- 或 \{++ 输出字面（保留反斜杠前的花括号）
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { $remark } from '@milkdown/kit/utils'

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
}

const INLINE_RE = /\{--([\s\S]*?)--\}|\{\+\+([\s\S]*?)\+\+\}/g

export function splitDiffInline(value: string): MdNode[] | null {
  const out: MdNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let matched = false
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(value))) {
    // 转义：{-- 前是反斜杠 → 不解析（保留字面，含 \）
    if (m.index > 0 && value[m.index - 1] === '\\') continue
    matched = true
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index), marks: [] })
    if (m[1] !== undefined) out.push({ type: 'diffDel', value: m[1], marks: [] })
    else out.push({ type: 'diffIns', value: m[2], marks: [] })
    last = m.index + m[0].length
  }
  if (!matched) return null
  if (last < value.length) out.push({ type: 'text', value: value.slice(last), marks: [] })
  return out
}

const remarkDiffInlinePlugin = $remark('remarkDiffInline', () => () => {
  return (tree: MdNode) => {
    const walk = (parent: MdNode) => {
      if (!parent.children) return
      const next: MdNode[] = []
      for (const node of parent.children) {
        if (node.type === 'text' && typeof node.value === 'string') {
          const parts = splitDiffInline(node.value)
          if (parts && parts.length > 1) {
            next.push(...parts)
            continue
          }
        }
        if (node.children) walk(node)
        next.push(node)
      }
      parent.children = next
    }
    walk(tree)
  }
})

export const remarkDiffInline: MilkdownPlugin[] = [...remarkDiffInlinePlugin]
