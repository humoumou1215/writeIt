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
  /** remark-ref 拆出的引用节点（[[path#frag]]） */
  path?: string
  fragment?: string | null
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
  // remark-ref 已拆出的引用节点 → 按源码还原（拼接进 diff 值，保持往返一致）
  if (node.type === 'fileRef') {
    const p = String(node.path ?? '')
    const f = node.fragment as string | null | undefined
    return `[[${p}${f ? `#${f}` : ''}]]`
  }
  return ((node.children as MdNode[]) ?? []).map(flattenText).join('')
}

/** 找文本段中「最后一个未闭合」的 {++/{-- 标记（跳过 \{-- 转义字面） */
function lastUnclosedOpen(value: string): { open: string; idx: number } | null {
  let found: { open: string; idx: number } | null = null
  for (let i = 0; i < value.length - 2; i++) {
    const isPlus = value.startsWith('{++', i)
    const isMinus = value.startsWith('{--', i)
    if ((isPlus || isMinus) && !(i > 0 && value[i - 1] === '\\')) {
      found = { open: isPlus ? '{++' : '{--', idx: i }
    }
  }
  if (!found) return null
  // 本段内已有闭合（splitDiffInline 会先拆掉完整标记）→ 不需要合并
  const close = found.open === '{++' ? '++}' : '--}'
  if (value.indexOf(close, found.idx + 3) !== -1) return null
  return found
}

/** 从 children[idx] 起向后找闭合标记，合并为 diff 节点（内容 = 收集节点源码还原） */
function mergeForward(
  open: string,
  text: string,
  children: MdNode[],
  idx: number,
  openIdx: number
): { nodes: MdNode[]; consumed: number } | null {
  const close = open === '{++' ? '++}' : '--}'
  const prefix = text.slice(0, openIdx)
  const collected: MdNode[] = []
  // 标记起始与闭合之间的当前文本内容（{++![[..]] 的 "!"、{++- 参见 的 "- 参见 "）
  const initial = text.slice(openIdx + open.length)
  if (initial) collected.push({ type: 'text', value: initial, marks: [] })
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
      // 兼容：标记起始不在文本末尾（remark-ref 先拆出 fileRef，{++![[…]]++} → "{++!" + fileRef + "++}"）
      const om = lastUnclosedOpen(part.value as string)
      if (om) {
        const r = mergeForward(om.open, part.value as string, children, startIdx + consumed, om.idx)
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
