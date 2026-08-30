// file_block 内容工具（M4：写回事务 writeBackBlocks 已删——嵌入块编辑在拦截器内即时进模型，
// 保存 = flush 脏模型；本文件保留块序列化与源路径收集，供提交/保存用）。
//   · serializeBlockContent —— 块内容序列化（提交/物化基线）
//   · collectSourcePaths —— 保存时本标签全部可编辑块的源真实路径（flush 目标）
// 只读变体不参与（固定快照）。
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx, parserCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core'
import { probeRealPath } from './resolve'
import { getRefConfig } from './config'

export interface BlockEntry {
  pos: number
  path: string
  readonly: boolean
  size: number
}

/** 收集文档中所有已物化的 file_block（含 size，用于范围序列化）。 */
function collectBlockEntries(editor: Editor): BlockEntry[] {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const blocks: BlockEntry[] = []
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'file_block' && Boolean(node.attrs.materialized)) {
        blocks.push({
          pos,
          path: node.attrs.path as string,
          readonly: Boolean(node.attrs.readonly),
          size: node.nodeSize,
        })
      }
      return true
    })
    return blocks
  })
}

/** 序列化单个 file_block 的内容（同步，round-trip 稳定化）。
 * 不可直接用 getMarkdown(range)（slice 在嵌套上下文会输出标记行）——直接取 file_block 的
 * content（物化时来自源文件解析）包成临时 doc 序列化。
 * round-trip：序列化 → 再解析 → 再序列化，避免弄脏保存基线。 */
export function serializeBlockContent(editor: Editor, pos: number): string {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const schema = ctx.get(schemaCtx)
    const parser = ctx.get(parserCtx)
    const serializer = ctx.get(serializerCtx)
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'file_block') return ''
    const doc = schema.topNodeType.createAndFill(null, node.content)
    if (!doc) return ''
    const md = serializer(doc)
    const reparsed = parser(md)
    const stable = reparsed ? serializer(reparsed) : md
    if (md.length !== stable.length) console.log('[writeback] roundtrip diff:', md.length, '->', stable.length, JSON.stringify(md.slice(-30)), '|', JSON.stringify(stable.slice(-30)))
    return stable
  })
}

/** 本标签所有可编辑块的源真实路径（flush 目标） */
export async function collectSourcePaths(editor: Editor): Promise<Set<string>> {
  const cfg = getRefConfig(editor)
  if (!cfg) return new Set()
  const entries = collectBlockEntries(editor).filter((b) => !b.readonly)
  const paths = new Set<string>()
  for (const b of entries) {
    const real = await probeRealPath(cfg, b.path, cfg.hostPath)
    if (real) paths.add(real)
  }
  return paths
}
