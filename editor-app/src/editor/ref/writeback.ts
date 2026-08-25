// file_block 写回事务（设计文档 §6.7）：
//   保存 = 提交宿主文档 + 全部被引用文件变更（原子）
//   1. 收集可编辑 file_block（非只读）的当前内容（序列化）
//   2. 与源文件对比（读缓存），仅写差异（按路径去重，同源多处引用合并）
//   3. 写回后更新内容缓存 + 广播其他打开该源的标签刷新物化
// 只读变体不参与；失败降级 toast，不中断保存主流程（§7.1）。
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx, parserCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core'
import { readRefFile, cacheContent } from './resolve'
import { getRefConfig } from './config'
import { commit as registryCommit } from './registry'

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
/** 解析真实文件路径（Obsidian 风格补扩展名；不存在返回 null） */
export async function resolveRealPath(cfg: import('./config').RefConfig, path: string): Promise<string | null> {
  const candidates = [path, `${path}.md`, `${path}.markdown`, `${path}.txt`]
  for (const c of candidates) {
    try {
      await cfg.fs.readFile(c)
      return c
    } catch {
      /* try next */
    }
  }
  return null
}

export async function writeBackBlocks(editor: Editor): Promise<Map<string, string>> {
  const cfg = getRefConfig(editor)
  if (!cfg) return new Map()
  const written = new Map<string, string>()
  try {
    // 逐块收集（倒序无必要：分组后按路径独立写，同源只写一次）
    const perBlock = collectPerBlockSync(editor).filter((b) => b.materialized && !b.readonly && b.content !== '')
    // 按请求路径分组，收集各处内容
    const byPath = new Map<string, { contents: Set<string>; real: string | null }>()
    for (const b of perBlock) {
      const g = byPath.get(b.path) ?? { contents: new Set<string>(), real: null }
      g.contents.add(b.content)
      byPath.set(b.path, g)
    }
    for (const [path, group] of byPath) {
      // 同源多处嵌入内容不一致 → 数据有歧义：跳过 + 提示，避免静默 last-wins 写坏源文件
      if (group.contents.size > 1) {
        console.warn('[writeback] 同源嵌入内容不一致，跳过写回:', path, [...group.contents].map((u) => JSON.stringify(u.slice(0, 40))))
        cfg.toast(`嵌入内容不一致：${path} 有 ${group.contents.size} 处不同内容，已跳过写回（请先在宿主内同步）`, 'error')
        continue
      }
      const content = [...group.contents][0]
      let current: string
      try {
        current = await readRefFile(cfg, path)
      } catch {
        continue // 断链：源文件不存在，跳过写回
      }
      if (current === content) continue
      // 写回用真实路径（块 attrs.path 常缺扩展名，直接写会创建无扩展名新文件）
      const real = await resolveRealPath(cfg, path)
      if (!real) continue
      // 源标签有真实未保存编辑 → 宿主保存不覆盖它（最后保存者胜），提示用户先保存源文件
      if (cfg.isTabUserEdited?.(real)) {
        cfg.toast(`嵌入写回已跳过：源文件「${path}」有未保存编辑（请先保存源文件）`, 'info')
        console.warn('[writeback] 跳过写回（源标签有未保存编辑）:', real)
        continue
      }
      try {
        await cfg.fs.writeFile(real, content)
        group.real = real
        cacheContent(real, content) // 更新缓存，避免广播刷新读到旧内容
        registryCommit(real, content) // P2：真相追平磁盘（后续物化/广播读真相，不读旧盘）
        written.set(real, content)
        console.log('[writeback] 写回:', real)
      } catch (e) {
        cfg.toast(`嵌入内容写回失败：${path}`, 'error')
      }
    }
  } catch (e) {
    console.error('[writeback] 写回事务异常:', e)
    cfg.toast('嵌入内容写回异常（已降级）', 'error')
  }
  return written
}

/** 本标签所有可编辑块的源真实路径（写回/联动目标） */
export async function collectSourcePaths(editor: Editor): Promise<Set<string>> {
  const cfg = getRefConfig(editor)
  if (!cfg) return new Set()
  const entries = collectBlockEntries(editor).filter((b) => !b.readonly)
  const paths = new Set<string>()
  for (const b of entries) {
    const real = await resolveRealPath(cfg, b.path)
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
