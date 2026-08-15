// 两段式解析的 resolve 阶段（设计文档 §6.4）——M1 简化版 + M2 单块物化 + M4 对象消歧
// 解析（同步）产生暂态节点后，本模块异步定型：
//   1. file_block：读取源文件（mock/tauri fs）→ 物化内容填入容器
//   2. file_ref#fragment：M4 起按 suggest 消歧 → 命中模板对象 → object_ref；否则保持 Obsidian 标题链接
//   3. object_ref：运行 suggest.resolve(ctx) → 写入 resolvedText
// 容错：任何失败只标记/提示，绝不中断编辑器（§7.1 异步容错原则）
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Node } from '@milkdown/kit/prose/model'
import { extractDoctype } from '../../template/service'
import { createSuggestContext } from '../../template/suggest-context'
import { getRefConfig, type RefConfig } from './config'

const MAX_DEPTH = 3
/** 源内容缓存：path → 原始 markdown（限制条数，避免内存膨胀） */
const contentCache = new Map<string, string>()
const CACHE_LIMIT = 60

function cacheContent(path: string, content: string) {
  if (contentCache.size >= CACHE_LIMIT) {
    const first = contentCache.keys().next().value
    if (first !== undefined) contentCache.delete(first)
  }
  contentCache.set(path, content)
}

/** Obsidian 风格路径解析：先原样尝试，再补常见扩展名（带缓存） */
async function readRefFile(cfg: RefConfig, path: string): Promise<string> {
  const cached = contentCache.get(path)
  if (cached !== undefined) return cached
  const candidates = [path, `${path}.md`, `${path}.markdown`, `${path}.txt`]
  let lastErr: unknown = null
  for (const c of candidates) {
    try {
      const content = await cfg.fs.readFile(c)
      cacheContent(c, content)
      return content
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`文件不存在: ${path}`)
}

export { readRefFile, cacheContent, collectBlocks }

/** 物化一个 file_block（基于编辑器 ctx） */
export async function materializeBlock(
  editor: Editor,
  pos: number,
  path: string,
  readonly: boolean
): Promise<void> {
  const cfg = getRefConfig(editor)
  if (!cfg) return
  let source: string
  try {
    source = await readRefFile(cfg, path)
  } catch {
    cfg.toast(`引用失败：找不到文件「${path}」`, 'error')
    return
  }

  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const parser = ctx.get(parserCtx)

    // 重新定位容器（期间文档可能被编辑）
    const atPos = view.state.doc.nodeAt(pos)
    if (!atPos || atPos.type.name !== 'file_block') return
    if (atPos.attrs.readonly !== readonly) return

    const parsed = parser(source)
    if (!parsed) return

    const from = pos + 1
    const to = pos + atPos.nodeSize - 1
    const tr = view.state.tr.replaceWith(from, to, parsed.content)
    view.dispatch(tr)
    // 物化 dispatch 后强制完整渲染：replaceWith 更新已创建的 NodeView 时
    // 内容 DOM 不会建立 pmViewDesc（块内输入因此失效）——强制重建视图
    try {
      view.updateState(view.state)
      const ob = (view as unknown as { domObserver?: { forceFlush?: () => void } }).domObserver
      ob?.forceFlush?.()
    } catch {
      /* 忽略 */
    }
  })
}

/** 收集文档中所有 file_block 的位置（倒序处理，避免位置漂移） */
function collectBlocks(editor: Editor): Array<{ pos: number; path: string; readonly: boolean; depth: number }> {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    const blocks: Array<{ pos: number; path: string; readonly: boolean; depth: number }> = []

    const walk = (node: typeof doc, pos: number, depth: number) => {
      node.forEach((child, offset) => {
        if (child.type.name === 'file_block') {
          blocks.push({
            pos: pos + offset,
            path: child.attrs.path as string,
            readonly: child.attrs.readonly as boolean,
            depth,
          })
        }
        if (child.isBlock && depth < MAX_DEPTH) {
          walk(child, pos + offset + 1, depth + 1)
        }
      })
    }
    walk(doc, 0, 0)
    return blocks
  })
}

/** 收集需要消歧/定型的引用：object_ref（未解析）+ file_ref#fragment */
function collectRefs(
  editor: Editor
): Array<{ pos: number; type: 'object_ref' | 'file_ref'; path: string; fragment: string | null; object: string | null }> {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const refs: Array<{ pos: number; type: 'object_ref' | 'file_ref'; path: string; fragment: string | null; object: string | null }> = []
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'object_ref' && node.attrs.resolvedText == null) {
        refs.push({
          pos,
          type: 'object_ref',
          path: node.attrs.path as string,
          fragment: null,
          object: node.attrs.object as string,
        })
      } else if (node.type.name === 'file_ref' && node.attrs.fragment) {
        refs.push({
          pos,
          type: 'file_ref',
          path: node.attrs.path as string,
          fragment: node.attrs.fragment as string,
          object: null,
        })
      }
      return true
    })
    return refs
  })
}

/** 解析一个对象引用（消歧或定型）：读目标 → doctype → suggest → resolve → 替换/更新节点 */
async function resolveObjectRef(
  editor: Editor,
  ref: { pos: number; type: 'object_ref' | 'file_ref'; path: string; fragment: string | null; object: string | null }
): Promise<void> {
  const cfg = getRefConfig(editor)
  if (!cfg) return
  let target: string
  try {
    target = await readRefFile(cfg, ref.path)
  } catch {
    return // 断链：文件不存在（断链警告由 app-plugin 处理）
  }
  const doctype = extractDoctype(target)
  if (!doctype) return
  const tpl = cfg.templateService.get(doctype)
  if (!tpl) return
  const staticObjs = (await cfg.templateService.ensureSuggest(tpl)) ?? []
  const objectId = ref.type === 'object_ref' ? ref.object : ref.fragment

  // 先解析目标：动态对象 objectsFor 与对象 resolve 都需要 SuggestContext
  let parsed: Node | null = null
  let ctxObj: ReturnType<typeof createSuggestContext> | null = null
  try {
    const parser = editor.action((c) => c.get(parserCtx))
    parsed = parser(target)
    if (parsed) ctxObj = createSuggestContext(parsed)
  } catch (e) {
    console.error('[ref] parser 失败:', ref.path, e)
    return
  }
  // 合并动态对象（objectsFor 现场 ctx 生成；id 冲突静态优先）
  const dynObjs = tpl.suggestFactory && ctxObj ? (tpl.suggestFactory(ctxObj) ?? []) : []
  const objects = [...staticObjs, ...dynObjs]
  const obj = objects.find((o) => o.id === objectId)
  if (!obj) return // 对象不存在 → 保持现状（断链态）
  const anchor = obj.fragment ?? null
  const label = obj.label ?? null

  let text: string | null = null
  if (ctxObj) {
    try {
      text = obj.resolve(ctxObj)
    } catch (e) {
      console.error('[ref] suggest resolve 失败:', ref.path, e)
      return
    }
  }

  editor.action((c) => {
    const view = c.get(editorViewCtx)
    const atPos = view.state.doc.nodeAt(ref.pos)
    if (!atPos) return
    const schema = view.state.schema
    const tr = view.state.tr
    if (ref.type === 'object_ref') {
      if (atPos.type.name !== 'object_ref') return
      tr.setNodeMarkup(ref.pos, undefined, { ...atPos.attrs, resolvedText: text, fragment: anchor, label })
    } else if (ref.type === 'file_ref' && atPos.type.name === 'file_ref') {
      // 消歧：file_ref#fragment → object_ref（命中 suggest 对象）
      tr.replaceWith(
        ref.pos,
        ref.pos + atPos.nodeSize,
        schema.nodes.object_ref.create({ path: ref.path, object: objectId, resolvedText: text, fragment: anchor, label })
      )
    }
    view.dispatch(tr)
  })
}

/** 全文档 resolve：物化 file_block + 消歧/定型对象引用（循环/深度有上限） */
export async function resolveRefs(editor: Editor): Promise<void> {
  const cfg = getRefConfig(editor)
  if (!cfg) return
  try {
    // 1. 块物化（倒序，避免位置漂移）
    const blocks = collectBlocks(editor).sort((a, b) => b.pos - a.pos)
    for (const b of blocks) {
      if (b.depth >= MAX_DEPTH) {
        cfg.toast(`引用深度超过 ${MAX_DEPTH} 层，已截断`, 'info')
        continue
      }
      await materializeBlock(editor, b.pos, b.path, b.readonly)
    }
    // 2. 对象引用消歧/定型（倒序）
    const refs = collectRefs(editor).sort((a, b) => b.pos - a.pos)
    for (const r of refs) {
      await resolveObjectRef(editor, r)
    }
  } catch (e) {
    cfg.toast(`引用解析失败：${(e as Error).message}`, 'error')
  }
}
