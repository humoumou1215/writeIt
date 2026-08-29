// file_block 内容工具（M4b：写回事务 writeBackBlocks 已删——嵌入块编辑在拦截器内即时进模型，
// 保存 = flush 脏模型；本文件保留块序列化/收集/脏检测/源路径收集，供 dispatcher/保存/诊断用）。
//   · serializeBlockContent / collectPerBlockSync / collectBlockContentsSync —— 块内容序列化基线
//   · hasBlockChanges —— 脏检测第二条件（可编辑嵌入内容 ≠ 保存时快照）
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

export interface PerBlockContent {
  pos: number
  path: string
  readonly: boolean
  materialized: boolean
  /** 序列化后的块内容（未物化/序列化失败为 ''） */
  content: string
}

/** 收集文档中所有已物化的 file_block（含 size，用于范围序列化）。
 * 只收集 materialized=true 的块：未物化的块内容为空（物化失败/断链/多层嵌入尚未展开），
 * 若参与写回会把源文件误写空 → 数据丢失。 */
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
 * 不能直接用 getMarkdown(range)（slice 在嵌套上下文会输出标记行）——直接取 file_block 的
 * content（物化时来自源文件解析）包成临时 doc 序列化。
 * round-trip：序列化 → 再解析 → 再序列化，避免「块序列化值」与「源标签 replaceAll 后的
 * round-trip 值」差末尾换行，导致保存时误判"源标签有用户编辑"而跳过刷新。 */
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

/** 逐块收集（含内容；未物化块 content=''）。块编辑传播 / 写回一致性判断的基础。 */
export function collectPerBlockSync(editor: Editor): PerBlockContent[] {
  return collectBlockEntries(editor).map((b) => ({
    pos: b.pos,
    path: b.path,
    readonly: b.readonly,
    materialized: true, // collectBlockEntries 只收已物化块
    content: serializeBlockContent(editor, b.pos),
  }))
}

/** 序列化可编辑块内容（同步）：Map<path, markdown>（保留既有"同源末块为准"快照语义，
 * 仅用于脏检测/诊断；写回与传播已改用 collectPerBlockSync 逐块处理）。 */
export function collectBlockContentsSync(editor: Editor): Map<string, string> {
  const byPath = new Map<string, string>()
  const perBlock = collectPerBlockSync(editor).filter((b) => !b.readonly && b.materialized && b.content !== '')
  for (const b of perBlock) {
    byPath.set(b.path, b.content)
  }
  return byPath
}

/**
 * 写回事务：对比源文件，仅写有差异的可编辑块（§6.7 步骤 1-3）。
 * P1 改造（消静默数据丢失）：
 *  · 逐块收集（不再 Map<path, content> 末块为准）——同源多处嵌入内容不一致 = 陈旧块/并发编辑，
 *    跳过该路径写回 + toast（绝不静默覆盖）；一致时只写一次。
 *  · 源文件在标签中打开且"有真实未保存编辑"（isTabUserEdited）→ 跳过写回 + toast
 *    （最后保存者胜：宿主保存不覆盖源标签的未保存编辑，等源标签保存再收敛）。
 * 返回写回的 { 真实路径 → 内容 }（供源标签刷新/广播）。
 */
/** 本标签所有可编辑块的源真实路径（写回/联动目标） */
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

/** 脏检测第二条件：任一可编辑块内容 ≠ 保存时快照（§6.7 缺口修复 + P1 逐块化）。
 *  必须逐块比较：同源多处嵌入时，某一块（非末块）被编辑而其兄弟块未变 ——
 *  Map<path, content> 末块为准会漏检（编辑首块 → 快照值取自末块 → 误判无变化，
 *  传播不触发，正是脏读/不同步的根因之一）。 */
export function hasBlockChanges(editor: Editor, snapshot: Map<string, string> | null): boolean {
  if (!snapshot) return false
  for (const b of collectPerBlockSync(editor)) {
    if (b.readonly || !b.materialized || b.content === '') continue
    const prev = snapshot.get(b.path)
    if (prev === undefined || prev !== b.content) return true
  }
  return false
}
