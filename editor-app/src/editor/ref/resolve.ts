// 两段式解析的 resolve 阶段（设计文档 §6.4）——M1 简化版 + M2 单块物化 + M4 对象消歧
// + 多层块嵌入治理（docs/embed-nesting-governance.md）：
//   · 深度 = 嵌入链深度，与结构嵌套解耦（列表/引用/表格不计入）
//   · 环 = 本块 realPath 在祖先链（含宿主）中再次出现；兄弟重复 / 菱形引用不是环
//   · 第 11 层起折叠提示卡（提示，不渲染）；判定顺序：断链（读失败）→ 环 → 超深
//   · 判定唯一实现在 embed-chain.ts（纯模块）；本文件只做 realPath 探测（IO，LRU）与分流。
//   · 折叠是运行时 attrs（md 序列化不输出），round-trip 无损；折叠块不物化、不参与写回。
// 容错：任何失败只标记/提示，绝不中断编辑器（§7.1 异步容错原则）
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Node } from '@milkdown/kit/prose/model'
import type { Transaction } from '@milkdown/kit/prose/state'
import type { FsEntry } from '../../fs/types'
import { extractDoctype } from '../../template/service'
import { createSuggestContext } from '../../template/suggest-context'
import { getRefConfig, type RefConfig } from './config'
import {
  classifyEmbed,
  MAX_EMBED_DEPTH,
  buildCollapseChain,
  type CollapsedInfo,
} from './embed-chain'
import { diagEvent } from '../../diagnostics/logger'
import { docStore } from '../docstore/store'

// ---------- 源内容缓存（同前：限制条数，避免内存膨胀） ----------

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

/** Obsidian 风格路径读取：先原样尝试，再补常见扩展名（带缓存） */
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

// ---------- realPath 探测（嵌入链判定的输入；全库唯一归一） ----------

const CANDIDATE_EXTS = ['.md', '.markdown', '.txt']

/** realPath 探测缓存：请求路径 → 真实路径（断链缓存 null，只探测一次）。
 *  键含宿主路径——候选集随宿主目录不同；换宿主重判。 */
const realPathCache = new Map<string, string | null>()
const REALPATH_CACHE_LIMIT = 160

function realPathCacheSet(key: string, val: string | null) {
  if (realPathCache.size >= REALPATH_CACHE_LIMIT) {
    const first = realPathCache.keys().next().value
    if (first !== undefined) realPathCache.delete(first)
  }
  realPathCache.set(key, val)
}

/**
 * 解析嵌入引用的规范真实路径：候选扩展名 → 宿主相对目录 → 工作区全库文件名匹配。
 * 命中时把内容写入 contentCache（以 realPath 为键），后续物化阶段零重复 IO。
 * 返回值作为链判定的 realPath（比较用 chainKey 小写折叠对齐大小写不敏感文件系统）。
 */
export async function probeRealPath(
  cfg: RefConfig,
  reqPath: string,
  hostPath?: string | null
): Promise<string | null> {
  const key = `${hostPath ?? ''}::${reqPath}`
  const hit = realPathCache.get(key)
  if (hit !== undefined) return hit

  const candidates: string[] = [reqPath, ...CANDIDATE_EXTS.map((e) => reqPath + e)]
  // 宿主相对（支持 ![[../x]] 类别名；别名与全路径解析到同一 realPath → 环判定正确）
  if (hostPath) {
    const i = hostPath.lastIndexOf('/')
    const dir = i > 0 ? hostPath.slice(0, i) : ''
    if (dir) {
      const rel = dir + '/' + reqPath
      candidates.push(rel, ...CANDIDATE_EXTS.map((e) => rel + e))
    }
  }
  for (const c of candidates) {
    try {
      const content = await cfg.fs.readFile(c)
      cacheContent(c, content)
      realPathCacheSet(key, c)
      return c
    } catch {
      /* 下一候选 */
    }
  }
  // Obsidian 风格：无目录前缀时全库文件名匹配（取第一个命中；与 refPathExists/resolveRefPath 一致）
  const base = reqPath.split('/').pop() ?? reqPath
  try {
    const tree = await cfg.fs.readTree(true)
    let found: string | null = null
    const walk = (list: FsEntry[]) => {
      for (const n of list) {
        if (n.kind === 'file') {
          if (n.name === base || extNos(n.name, base)) {
            found = n.path ?? n.name
            break
          }
        } else if (n.kind === 'dir' && n.children && found === null) {
          walk(n.children)
        }
        if (found !== null) break
      }
    }
    walk(tree)
    if (found) {
      try {
        const content = await cfg.fs.readFile(found)
        cacheContent(found, content)
        realPathCacheSet(key, found)
        return found
      } catch {
        /* 找到但读失败 → 视为不存在 */
      }
    }
  } catch {
    /* 树读失败不阻塞判定 */
  }
  realPathCacheSet(key, null)
  return null
}

/** 文件名匹配（Base 或 Base+扩展名；Obsidian 全库匹配语义） */
function extNos(name: string, base: string): boolean {
  return CANDIDATE_EXTS.some((e) => name === base + e)
}

// ---------- 块收集（walk 只受结构嵌套护栏约束；链深由 materializeBlock 内按祖先链判定） ----------

interface BlockEntry {
  pos: number
  path: string
  readonly: boolean
  materialized: boolean
  collapsed: null | CollapsedInfo
}

/** 纯结构嵌套护栏（防病态深层文档的递归放大）；嵌入链深不受它影响（N3 修复） */
const STRUCT_CAP = 256

/** 收集文档中所有 file_block 的位置（倒序处理，避免位置漂移） */
function collectBlocks(editor: Editor): BlockEntry[] {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    const blocks: BlockEntry[] = []

    const walk = (node: typeof doc, pos: number, depth: number) => {
      node.forEach((child, offset) => {
        if (child.type.name === 'file_block') {
          const collapsed = child.attrs.collapsed as null | CollapsedInfo
          blocks.push({
            pos: pos + offset,
            path: child.attrs.path as string,
            readonly: child.attrs.readonly as boolean,
            materialized: Boolean(child.attrs.materialized),
            collapsed: collapsed ?? null,
          })
        }
        if (child.isBlock && depth < STRUCT_CAP) {
          walk(child, pos + offset + 1, depth + 1)
        }
      })
    }
    walk(doc, 0, 0)
    return blocks
  })
}

/** 块级祖先路径链：doc 结构中 pos 之上的 file_block 祖先（根在前；不含本块自身）
 *  PM 语义：node-start 位置的 resolve 路径最深节点是「父节点」（node(depth) = 父），
 *  本块是 nodeAfter —— 故从 d = depth 向上收父块。 */
function collectAncestorPaths(editor: Editor, pos: number): string[] {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const $pos = view.state.doc.resolve(pos)
    const out: string[] = []
    for (let d = $pos.depth; d >= 1; d--) {
      const n = $pos.node(d)
      if (n && n.type.name === 'file_block') {
        out.unshift(String(n.attrs.path ?? ''))
      }
    }
    return out
  })
}

/**
 * 空 file_block 防御：schema 的 file_block content 是 'block+'（要求 ≥1 块），
 * 直接创建的空块（菜单插入/粘贴/类型转换）对任何触碰它的 PM 事务不合法——
 * setNodeMarkup 的 validContent 校验会抛 RangeError「Invalid content for node type file_block」。
 * 注意 PM 的 deleteRange 在清空块时会自动补默认段落（所以「先删再设」的路径安全），
 * 但创建即空的块没有这层保护；这里统一补一个默认段落。
 */
function ensureBlockHasContent(tr: Transaction, pos: number): void {
  const node = tr.doc.nodeAt(pos)
  if (node && node.type.name === 'file_block' && node.nodeSize === 2) {
    tr.insert(pos + 1, tr.doc.type.schema.nodes.paragraph.create())
  }
}

/** 把块折叠（清空可能的内容 + 写折叠态 attrs；运行时态，不序列化） */
function foldBlock(editor: Editor, pos: number, collapsed: CollapsedInfo): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const atPos = view.state.doc.nodeAt(pos)
    if (!atPos || atPos.type.name !== 'file_block') return
    const tr = view.state.tr
    const from = pos + 1
    const to = pos + atPos.nodeSize - 1
    // 折叠块可能之前已物化（联动刷新引入环）→ 内容一并清空，避免折叠卡叠加旧内容
    if (to > from) tr.delete(from, to)
    // 空块兜底：折叠态要写进块内（content:'block+' 不允空块；PM deleteRange 会补默认段落，
    // 创建即空的块（菜单插入/粘贴）不会——显式补，否则 setNodeMarkup 抛 RangeError）
    ensureBlockHasContent(tr, pos)
    tr.setNodeMarkup(pos, undefined, { ...atPos.attrs, materialized: false, collapsed })
    view.dispatch(tr.setMeta('docstoreExternal', true))
  })
  diagEvent('embed:collapse', { data: { reason: collapsed.reason, chain: collapsed.chain } })
}

/**
 * 物化一个 file_block —— 唯一入口（resolve 轮次 / 联动刷新 / …全部经此）。
 * 判定顺序：断链（读失败，现有警告态）→ 环 → 超深 → 正常物化。
 * 判定语义与 diff 视图共用 embed-chain 纯模块，两视图呈现同一展开形态。
 */
export async function materializeBlock(
  editor: Editor,
  pos: number,
  path: string,
  readonly: boolean
): Promise<'ok' | 'fold' | 'broken' | 'skip'> {
  const cfg = getRefConfig(editor)
  if (!cfg) return 'skip'
  const hostPath = cfg.hostPath ?? null
  const selfReal = await probeRealPath(cfg, path, hostPath)
  if (!selfReal) {
    // 断链：现有行为（卡片警告态 + toast），不是环、不是折叠
    cfg.toast(`引用失败：找不到文件「${path}」`, 'error')
    return 'broken'
  }

  // 祖先链（根在前）：宿主 realPath + 各级父嵌入块 realPath（不含本块自身——本块重现即环）
  const ancestors: string[] = []
  if (hostPath) {
    const hostReal = await probeRealPath(cfg, hostPath)
    if (hostReal) ancestors.push(hostReal)
  }
  const parentPaths = collectAncestorPaths(editor, pos)
  for (const p of parentPaths) {
    const rp = await probeRealPath(cfg, p, hostPath)
    if (rp) ancestors.push(rp)
  }

  const verdict = classifyEmbed(ancestors, selfReal)
  if (verdict.kind === 'cycle' || verdict.kind === 'too-deep') {
    foldBlock(editor, pos, {
      reason: verdict.kind === 'cycle' ? 'cycle' : 'depth',
      chain: buildCollapseChain(ancestors, selfReal),
    })
    return 'fold'
  }

  // 正常物化（ok）：内容 = DocStore 模型（M4 §6.1：运行态内容统一从文档层取，取代 registry 字符串真源）。
  // 模型未加载/未解析 → 读盘 + 惰性建模型（行为等价；模型随后成为该文件后续物化的取值点）。
  let source: string
  const modelSnap = docStore.snapshot(selfReal)
  if (modelSnap && modelSnap.canonical != null) {
    source = modelSnap.canonical
  } else {
    try {
      source = await readRefFile(cfg, selfReal)
      if (!docStore.has(selfReal)) {
        await docStore.load(selfReal) // 建模型（磁盘 → 解析）；后续物化/广播读模型
      }
    } catch {
      cfg.toast(`引用失败：找不到文件「${path}」`, 'error')
      return 'broken'
    }
  }

  const blockId = fillBlockContent(editor, pos, path, readonly, source)
  // M4：块订阅由 syncTabViewsToRegistry（物化完成后）统一登记到 docStore——
  // 此处不再注册 registry 视图（registry 已下线；只读变体本身不订阅，保持固定快照）。
  return 'ok'
}

/**
 * 把给定内容解析并填入已存在的 file_block 容器（物化/兄弟块收敛/广播刷新共用）。
 * 本函数的 dispatch 带 docstoreExternal meta——拦截器/同步链路识别为程序化变更（防回环）。
 * P2：缺 blockId 时分配运行时块身份（不序列化）——registry 精确定位的基础。
 * 返回块 id（成功）或 null（块不存在 / 只读属性不匹配 / 内容解析失败）。
 */
export function fillBlockContent(
  editor: Editor,
  pos: number,
  _path: string,
  readonly: boolean,
  source: string
): string | null {
  let blockId: string | null = null
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
    // 空源文件（解析为空）会留下空块：block+ 不允空块，setNodeMarkup 会抛错——补默认段落
    ensureBlockHasContent(tr, pos)
    // P2：分配块身份（幂等；已存在则保留，保证跨广播稳定）
    const existing = atPos.attrs.blockId as string | null
    const id = existing ?? genBlockId()
    // 标记物化成功：未物化的块（内容为空）不参与写回，避免保存时覆盖源文件
    tr.setNodeMarkup(pos, undefined, { ...atPos.attrs, materialized: true, collapsed: null, blockId: id })
    // M4：物化 fill 是程序化变更——docstoreExternal meta 使拦截器跳过回流（防回环/防误判用户编辑）
    view.dispatch(tr.setMeta('docstoreExternal', true))
    blockId = id
    // 物化后：FileBlockView.update() 返回 false → PM 重建该 NodeView（新 contentDOM → content
    // 渲染 + 建立 view desc）→ 块内光标/输入正常。不再用 updateState+forceFlush 粗暴重建
    // （那会破坏 desc：块内光标不渲染、输入只能靠 beforeinput 兜底）。
  })
  return blockId
}

/** 生成运行时块身份（浏览器 crypto.randomUUID；兜底自增+随机） */
function genBlockId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* 降级 */
  }
  return `b${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export { genBlockId }

/** 用内存中已知内容物化块（同源兄弟块收敛 / 广播刷新；不读文件，内容来源为最新块/registry） */
export function materializeBlockFromContent(
  editor: Editor,
  pos: number,
  path: string,
  readonly: boolean,
  content: string
): string | null {
  return fillBlockContent(editor, pos, path, readonly, content)
}

/** 收集需要消歧/定型的引用：object_ref（未解析）+ file_ref#fragment */
function collectRefs(
  editor: Editor,
  from?: number,
  to?: number
): Array<{ pos: number; type: 'object_ref' | 'file_ref'; path: string; fragment: string | null; object: string | null }> {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const refs: Array<{ pos: number; type: 'object_ref' | 'file_ref'; path: string; fragment: string | null; object: string | null }> = []
    view.state.doc.descendants((node, pos) => {
      // 范围过滤（块内消歧用；默认全文档）
      if (from != null && (pos < from || pos + node.nodeSize > (to ?? Number.MAX_SAFE_INTEGER))) return true
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
    view.dispatch(tr.setMeta('docstoreExternal', true))
  })
}

/** 块内引用消歧：广播填充块内容后，块内 file_ref#fragment / 未定型 object_ref 需重新
 *  消歧（与打开文件时的完整 resolve 流程一致）——否则块显示原始链接而非对象文本
 *  （用户问题3根因：保存后块内容“消失/被替换”）。返回处理的引用数。 */
export async function resolveBlockRefs(editor: Editor, blockPos: number): Promise<number> {
  const cfg = getRefConfig(editor)
  if (!cfg) return 0
  let count = 0
  try {
    const node = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      return view.state.doc.nodeAt(blockPos)
    })
    if (!node || node.type.name !== 'file_block') return 0
    const to = blockPos + node.nodeSize
    // 倒序防位置漂移
    const refs = collectRefs(editor, blockPos, to).sort((a, b) => b.pos - a.pos)
    for (const r of refs) {
      const prev = editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        return view.state.doc.nodeAt(r.pos)
      })
      if (!prev || prev.type.name !== r.type) continue
      await resolveObjectRef(editor, r)
      count++
    }
  } catch (e) {
    console.warn('[ref] 块内引用消歧失败:', blockPos, e)
  }
  return count
}

/** 全文档 resolve：物化 file_block + 消歧/定型对象引用（链判定收敛，不再依赖跑满深度轮数） */
export async function resolveRefs(editor: Editor): Promise<void> {
  const cfg = getRefConfig(editor)
  if (!cfg) return
  try {
    // 1. 块物化（多轮）：物化一层把下一层嵌入引入 doc；折叠块不入队（collapsed 跳过）→ 天然收敛。
    //    轮数上限是防御（合法链每层至多需要一轮；第 10 层在 10 轮内全部物化）。
    let foldToast = false
    for (let round = 0; round <= MAX_EMBED_DEPTH + 1; round++) {
      const all = collectBlocks(editor)
      const todo = all
        .filter((b) => !b.materialized && !b.collapsed)
        .sort((a, b) => b.pos - a.pos)
      if (todo.length === 0) break
      let folded = 0
      for (const b of todo) {
        const r = await materializeBlock(editor, b.pos, b.path, b.readonly)
        if (r === 'fold') folded++
      }
      if (folded > 0 && !foldToast) {
        cfg.toast(`检测到循环引用或超过 ${MAX_EMBED_DEPTH} 层的嵌套嵌入，已折叠（见卡片）`, 'info')
        foldToast = true
      }
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