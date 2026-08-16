// M13：remark 解析——::: diff-add / diff-del / diff-mod 块级容器
//   diff-mod 内容按 thematicBreak（---）拆为 del + add 两个容器
// 未闭合的容器降级为原样文本（可读）
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { $remark } from '@milkdown/kit/utils'

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  [k: string]: unknown
}

function textOf(node: MdNode): string {
  if (!node.children) return ''
  return node.children
    .map((c) => (c.type === 'text' ? (c.value ?? '') : ''))
    .join('')
}

function makeContainer(kind: string, children: MdNode[]): MdNode {
  // milkdown 的 mdast 节点都带 marks 字段（parser 的 _runNode2 无条件访问 node.marks）
  // 收集的 children（blockquote/list 等）也需递归补 marks
  const fill = (n: MdNode) => {
    if (!n.marks) n.marks = []
    // milkdown 的 isFragment 判定要求 children 数组带 size 属性（标准 mdast 数组没有）
    if (Array.isArray(n.children) && !('size' in n.children)) {
      Object.defineProperty(n.children, 'size', { value: n.children.length, enumerable: false })
    }
    if (n.children) for (const c of n.children) fill(c)
    return n
  }
  return { type: 'diffContainer', kind, children: children.map(fill), marks: [] }
}

/** diff-mod：children 按 thematicBreak 拆为 del 段 + add 段 → 两个容器 */
function splitMod(children: MdNode[]): MdNode[] {
  const idx = children.findIndex((c) => c.type === 'thematicBreak')
  if (idx <= 0 || idx >= children.length - 1) {
    // 无有效分隔 → 整体当删除容器（保守）
    return [makeContainer('del', children)]
  }
  return [makeContainer('del', children.slice(0, idx)), makeContainer('add', children.slice(idx + 1))]
}

const remarkDiffContainerPlugin = $remark('remarkDiffContainer', () => () => {
  return (tree: MdNode) => {
    try {
      const walk = (parent: MdNode) => {
        const children = parent.children ?? []
        const next: MdNode[] = []
        let i = 0
        while (i < children.length) {
          const node = children[i]
          const text = node.type === 'paragraph' ? textOf(node).trim() : ''
          if (node.type === 'paragraph') console.log('[diff-remark] para:', JSON.stringify(text.slice(0, 30)))
          const m = /^:::\s*(diff-add|diff-del|diff-mod)\s*$/.exec(text)
          if (!m) {
            next.push(node)
            i++
            continue
          }
          // 收集到 ::: 结束
          const content: MdNode[] = []
          let j = i + 1
          let closed = false
          while (j < children.length) {
            const n = children[j]
            if (n.type === 'paragraph' && /^:::\s*$/.test(textOf(n).trim())) {
              closed = true
              j++
              break
            }
            content.push(n)
            j++
          }
          if (closed) {
            if (m[1] === 'diff-mod') next.push(...splitMod(content))
            else next.push(makeContainer(m[1] === 'diff-add' ? 'add' : 'del', content))
            i = j
          } else {
            next.push(node)
            i++
          }
        }
        parent.children = next
        for (const c of parent.children) walk(c)
      }
      walk(tree)
    } catch (e) {
      console.error('[diff-remark] container plugin error:', e)
    }
  }
})

export const remarkDiffContainer: MilkdownPlugin[] = [...remarkDiffContainerPlugin]
