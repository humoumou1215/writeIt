// 运行时批注 decorations（persist=false，如校验违规）
//   非空范围 → inline 高亮（不改变布局）
//   空范围（from == to，如空单元格）→ 降级锚定行：找所在 block 容器 → node decoration 整块高亮（§M6 决策）
// 由 AnnotationService 更新后 dispatch 空事务（setMeta('annotationRefresh')）触发重算。
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Annotation } from './service'

export const annotationPluginKey = new PluginKey<DecorationSet>('annotation-decorations')

export function annotationDecorationsPlugin(
  getList: () => Annotation[]
): Plugin {
  return new Plugin({
    key: annotationPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => {
        if (tr.getMeta('annotationRefresh')) {
          const list = getList()
          const decorations: Decoration[] = []
          for (const a of list) {
            if (a.from < 0 || a.to > tr.doc.content.size) continue
            if (a.to > a.from) {
              // 非空范围：inline 高亮
              decorations.push(
                Decoration.inline(a.from, a.to, {
                  class: `annotation-dynamic annotation-level-${a.level}`,
                  'data-annotation-id': a.id,
                })
              )
            } else {
              // 空范围：锚定行（所在 block 容器整块高亮）
              const block = findBlockAt(tr.doc, a.from)
              if (block) {
                decorations.push(
                  Decoration.node(block.pos, block.pos + block.node.nodeSize, {
                    class: `annotation-dynamic annotation-level-${a.level}`,
                    'data-annotation-id': a.id,
                  })
                )
              }
            }
          }
          return DecorationSet.create(tr.doc, decorations)
        }
        return set.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations: (state) => {
        const s = annotationPluginKey.getState(state)
        return s ?? DecorationSet.empty
      },
    },
  })
}

/** 空位置所在的可锚定块容器（paragraph / heading / list_item / table_row / code_block 等） */
function findBlockAt(doc: import('@milkdown/kit/prose/model').Node, pos: number): {
  pos: number
  node: import('@milkdown/kit/prose/model').Node
} | null {
  let found: { pos: number; node: import('@milkdown/kit/prose/model').Node } | null = null
  doc.descendants((node, p) => {
    if (found) return false
    const size = node.nodeSize
    if (p <= pos && pos < p + size && node.isBlock) {
      const ok =
        node.type.name === 'paragraph' ||
        node.type.name === 'heading' ||
        node.type.name === 'list_item' ||
        node.type.name === 'table_row' ||
        node.type.name === 'code_block' ||
        node.type.name === 'blockquote'
      if (ok) {
        found = { pos: p, node }
        return false
      }
    }
    return true
  })
  return found
}
