// remark 插件：把引用语法转换为独立 mdast 节点类型
//   [[path]] / [[path#frag]]  → fileRef（文本节点内拆分）
//   ![[path]] / ![[path|ro]]  → fileBlock（整段）
//   doctype:xxx               → doctype（整段）
// 同时利用 vfile 原文做转义检测（\[[ 不解析为引用）

/** 内联引用语法 */
const INLINE_REF_RE = /\[\[([^\[\]|]+?)(?:#([^\[\]]+))?\]\]/g

type MdastNode = {
  type: string
  value?: string
  children?: MdastNode[]
  position?: { start?: { offset?: number } }
  [key: string]: unknown
}

/** 计算文本节点 value 中 index 处字符对应的原文偏移（处理 \x 转义占位） */
function valueIndexToSourceOffset(src: string, node: MdastNode, valueIndex: number): number {
  const start = node.position?.start?.offset ?? 0
  let si = start
  let vi = 0
  while (vi < valueIndex) {
    if (src[si] === '\\') si++
    si++
    vi++
  }
  return si
}

export function remarkRef() {
  return (tree: MdastNode, file: { value?: unknown }) => {
    const src = String(file.value ?? '')

    /** 处理一个容器节点：先转换自身，再递归子节点 */
    const walk = (parent: MdastNode) => {
      if (!parent.children) return
      const children = parent.children
      const next: MdastNode[] = []

      for (let i = 0; i < children.length; i++) {
        const node = children[i]

        // 段落级：doctype / fileBlock（整段替换）
        if (node.type === 'paragraph') {
          const text = (node.children ?? [])
            .map((c) => (c.type === 'text' ? (c.value ?? '') : ''))
            .join('')
          const doctype = /^doctype:(\S+)$/.exec(text)
          if (doctype) {
            next.push({ type: 'doctype', value: doctype[1] })
            continue
          }
          const block = /^!\[\[(.+?)(?:\|ro)?\]\]$/.exec(text)
          if (block) {
            next.push({
              type: 'fileBlock',
              path: block[1],
              readonly: block[0].includes('|ro'),
            })
            continue
          }
        }

        // 文本节点：fileRef 拆分（含转义检测）
        if (node.type === 'text' && typeof node.value === 'string') {
          const value = node.value
          INLINE_REF_RE.lastIndex = 0
          const matches = [...value.matchAll(INLINE_REF_RE)]
          if (matches.length) {
            let last = 0
            let changed = false
            for (const m of matches) {
              const mIndex = m.index ?? 0
              const srcOff = valueIndexToSourceOffset(src, node, mIndex)
              if (src[srcOff] === '\\') {
                last = mIndex + m[0].length
                continue
              }
              if (mIndex > last) {
                next.push({ type: 'text', value: value.slice(last, mIndex) })
              }
              next.push({ type: 'fileRef', path: m[1], fragment: m[2] ?? null })
              last = mIndex + m[0].length
              changed = true
            }
            if (changed) {
              if (last < value.length) next.push({ type: 'text', value: value.slice(last) })
              continue
            }
          }
        }

        next.push(node)
      }

      parent.children = next
      // 递归处理子级（fileBlock 等被转换的节点没有文本子级，直接跳过）
      for (const child of next) {
        if (child.children) walk(child)
      }
    }

    walk(tree)
  }
}
