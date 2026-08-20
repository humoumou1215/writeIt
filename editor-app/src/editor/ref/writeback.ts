// file_block 写回事务（设计文档 §6.7）：
//   保存 = 提交宿主文档 + 全部被引用文件变更（原子）
//   1. 收集可编辑 file_block（非只读）的当前内容（序列化）
//   2. 与源文件对比（读缓存），仅写差异（按路径去重，同源多处引用合并）
//   3. 写回后更新内容缓存 + 广播其他打开该源的标签刷新物化
// 只读变体不参与；失败降级 toast，不中断保存主流程（§7.1）。
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx, parserCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core'
import { readRefFile, cacheContent, collectBlocks, materializeBlock } from './resolve'
import { getRefConfig } from './config'

/** 保存后更新源内容缓存（broadcastBlockRefresh 物化时读缓存） */
export function cacheRefFileContent(path: string, content: string): void {
  cacheContent(path, content)
}

export interface BlockEntry {
  pos: number
  path: string
  readonly: boolean
  size: number
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

/** 序列化可编辑块内容（同步）：Map<path, markdown>；同源多处引用以最后一处为准（内容一致时无差异）。
 * 注意：不能用 getMarkdown(range)（slice 在嵌套上下文会输出标记行）——直接取 file_block 的 content
 * （物化时来自源文件解析）包成临时 doc 序列化。 */
export function collectBlockContentsSync(editor: Editor): Map<string, string> {
  const byPath = new Map<string, string>()
  const entries = collectBlockEntries(editor).filter((b) => !b.readonly)
  for (const b of entries) {
    try {
      const content = editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const schema = ctx.get(schemaCtx)
        const parser = ctx.get(parserCtx)
        const serializer = ctx.get(serializerCtx)
        const node = view.state.doc.nodeAt(b.pos)
        if (!node || node.type.name !== 'file_block') return ''
        const doc = schema.topNodeType.createAndFill(null, node.content)
        if (!doc) return ''
        // round-trip 稳定化：序列化 → 再解析 → 再序列化。
        // 否则「块序列化值」与「源标签 replaceAll 后的 round-trip 值」差末尾换行，
        // 导致保存时误判"源标签有用户编辑"而跳过刷新。
        const md = serializer(doc)
        const reparsed = parser(md)
        const stable = reparsed ? serializer(reparsed) : md
        if (md.length !== stable.length) console.log('[writeback] roundtrip diff:', md.length, '->', stable.length, JSON.stringify(md.slice(-30)), '|', JSON.stringify(stable.slice(-30)))
        return stable
      })
      byPath.set(b.path, content)
    } catch (e) {
      console.warn('[writeback] 序列化块失败:', b.path, e)
    }
  }
  return byPath
}

/**
 * 写回事务：对比源文件，仅写有差异的可编辑块（§6.7 步骤 1-3）。
 * 返回写回的 { 真实路径 → 内容 }（供源标签刷新/广播）。
 */
/** 解析真实文件路径（Obsidian 风格补扩展名；不存在返回 null） */
async function resolveRealPath(cfg: import('./config').RefConfig, path: string): Promise<string | null> {
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
    const byPath = collectBlockContentsSync(editor)
    for (const [path, content] of byPath) {
      let current: string
      try {
        current = await readRefFile(cfg, path)
      } catch {
        continue // 断链：源文件不存在，跳过写回
      }
      if (current === content) continue
      try {
        // 写回用真实路径（块 attrs.path 常缺扩展名，直接写会创建无扩展名新文件）
        const real = await resolveRealPath(cfg, path)
        if (!real) continue
        await cfg.fs.writeFile(real, content)
        cacheContent(real, content) // 更新缓存，避免广播刷新读到旧内容
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

/** 判断两个引用路径是否指向同一源文件（忽略扩展名差异，如 笔记/待办清单 vs 笔记/待办清单.md） */
function sameSource(a: string, b: string): boolean {
  if (a === b) return true
  const norm = (p: string) => p.replace(/\.(md|markdown|txt)$/i, '')
  return norm(a) === norm(b)
}

/** 广播：其他打开该源文件的标签刷新对应 file_block 的物化内容（§6.7 步骤 5） */
export async function broadcastBlockRefresh<P extends { crepe: { editor: Editor } }>(
  path: string,
  exceptTabId: string,
  instances: Map<string, P>
): Promise<string[]> {
  const refreshed: string[] = []
  for (const [tabId, inst] of instances) {
    if (tabId === exceptTabId) continue
    try {
      const blocks = collectBlocks(inst.crepe.editor)
      // 倒序处理避免位置漂移；路径匹配兼容扩展名差异（块 attrs 常无 .md）
      const targets = blocks
        .filter((b) => sameSource(b.path, path))
        .sort((a, b) => b.pos - a.pos)
      if (targets.length) {
        for (const b of targets) {
          await materializeBlock(inst.crepe.editor, b.pos, b.path, b.readonly)
        }
        refreshed.push(tabId)
      }
    } catch {
      /* 单个标签刷新失败不影响其他 */
    }
  }
  return refreshed
}

/** 脏检测第二条件：任一可编辑块内容 ≠ 保存时快照（§6.7 缺口修复） */
export function hasBlockChanges(editor: Editor, snapshot: Map<string, string> | null): boolean {
  if (!snapshot) return false
  const now = collectBlockContentsSync(editor)
  if (now.size !== snapshot.size) return true
  for (const [path, content] of now) {
    const prev = snapshot.get(path)
    if (prev === undefined || prev !== content) return true
  }
  return false
}
