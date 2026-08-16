// M13：remark 解析——内联 {--删除--} / {++新增++} → diffDel / diffIns 节点
// 转义：\{-- 或 \{++ 输出字面（保留反斜杠前的花括号）
// M14 修复：
//   ① 整行/整段单标记也替换（parts 全为非 text 时）
//   ② 标记内容含 markdown 语法时被强调/加粗先拆开（{++**词级**++} → text"{" + strong + "}"）
//      → 文本末尾未闭合的 {++/{-- 向后跨节点合并，内容按源码还原（strong→**..**）
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { $remark } from '@milkdown/kit/utils'

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  marks?: unknown[]
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

/** 跨节点内容按源码还原（strong→**..** / em→*..* / inlineCode→`..`） */
function flattenText(node: MdNode): string {
  if (node.type === 'text') return (node.value as string) ?? ''
  if (node.type === 'strong') {
    return '**' + ((node.children as MdNode[]) ?? []).map(flattenText).join('') + '**'
  }
  if (node.type === 'emphasis') {
    return '*' + ((node.children as MdNode[]) ?? []).map(flattenText).join('') + '*'
  }
  if (node.type === 'inlineCode') return '`' + String((node.value as string) ?? '') + '`'
  if (node.type === 'delete') {
    return '~~' + ((node.children as MdNode[]) ?? []).map(flattenText).join('') + '~~'
  }
  return ((node.children as MdNode[]) ?? []).map(flattenText).join('')
}

const OPEN_RE = /(\{\+\+|\{--)\s*$/

/** 从 children[idx] 起向后找闭合标记，合并为 diff 节点（内容 = 收集节点源码还原） */
function mergeForward(
  open: string,
  text: string,
  children: MdNode[],
  idx: number
): { nodes: MdNode[]; consumed: number } | null {
  const close = open === '{++' ? '++}' : '--}'
  const prefix = text.slice(0, -open.length)
  const collected: MdNode[] = []
  let j = idx
  while (j < children.length) {
    const n2 = children[j]
    if (n2.type === 'text' && typeof n2.value === 'string' && n2.value.includes(close)) {
      const tail = n2.value
      const ci = tail.indexOf(close)
      const after = tail.slice(ci + close.length)
      const inner = collected.map(flattenText).join('') + tail.slice(0, ci)
      const nodes: MdNode[] = []
      if (prefix) nodes.push({ type: 'text', value: prefix, marks: [] })
      nodes.push({ type: open === '{++' ? 'diffIns' : 'diffDel', value: inner, marks: [] })
      if (after) nodes.push({ type: 'text', value: after, marks: [] })
      return { nodes, consumed: j - idx + 1 }
    }
    collected.push(n2)
    j++
  }
  return null
}

/** 拆分 text 节点；尾部未闭合标记跨节点合并。返回替换节点 + 消费的原始子节点数 */
function splitAndMerge(
  text: string,
  children: MdNode[],
  startIdx: number
): { nodes: MdNode[]; consumed: number } | null {
  const parts = splitDiffInline(text)
  if (!parts || !parts.some((p) => p.type !== 'text')) return null
  const nodes: MdNode[] = []
  let consumed = 1 // 当前 text 节点
  for (const part of parts) {
    if (part.type === 'text') {
      const om = OPEN_RE.exec(part.value as string)
      if (om) {
        const r = mergeForward(om[1], part.value as string, children, startIdx + consumed)
        if (r) {
          nodes.push(...r.nodes)
          consumed += r.consumed
          continue
        }
      }
    }
    nodes.push(part)
  }
  return { nodes, consumed }
}

const remarkDiffInlinePlugin = $remark('remarkDiffInline', () => () => {
  return (tree: MdNode) => {
    const walk = (parent: MdNode) => {
      if (!parent.children) return
      const children = parent.children
      const next: MdNode[] = []
      let i = 0
      while (i < children.length) {
        const node = children[i]
        if (node.type === 'text' && typeof node.value === 'string') {
          const r = splitAndMerge(node.value, children, i)
          if (r) {
            next.push(...r.nodes)
            i += r.consumed
            continue
          }
        }
        if (node.children) walk(node)
        next.push(node)
        i++
      }
      parent.children = next
    }
    walk(tree)
  }
})

export const remarkDiffInline: MilkdownPlugin[] = [...remarkDiffInlinePlugin]
