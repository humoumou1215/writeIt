// M18：渲染模式——确定性渲染管线（第四稿 lifecycle 状态机的替代，§4.1）
// 流程：prefetch(IO) → model(纯函数，diagram/embed records + mergedMd + FenceRegistry)
//   → 预填充 doc（write-once：editorStateOptionsCtx 在挂载前定稿，doc 自挂载起不再变化）
//   → 自有 mermaid NodeView（变更 eager / 未变更 lazy）
//   → 单点 settle（Promise.allSettled + 5s 兜底，无轮询/竞速截断）
//   → overlay（徽标 + class 注入失效时的 scoped DOM 标注 fallback）
// 降级链：Crepe 失败/渲染异常 → 双栏全文对比（renderSplitFallback，与主路径共享 mount 逻辑）
import { Crepe } from '@milkdown/crepe'
import { editorStateOptionsCtx, parserCtx } from '@milkdown/kit/core'
import type { Node } from '@milkdown/kit/prose/model'
import { Fragment } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose, $remark } from '@milkdown/kit/utils'
import { refPlugin, refConfigCtx, type RefConfig } from './ref'
import { resolveRefs } from './ref/resolve'
import { registerRefStringify } from './ref/stringify'
import { featureConfigs } from './features'
import { annotationSchema } from '../annotations/nodes'
import { remarkAnnotation } from '../annotations/remark-annotation'
import { annotationStringifyHandler } from '../annotations'
import {
  buildDiffDecorations,
  mermaidDiffText,
  makeNote,
  patchMermaidFences,
  extractMermaidBodies,
  type DiffNote,
} from './diff-deco'
import {
  computeDocDiffModel,
  docMermaidFences,
  docFileBlocks,
  type FenceRegistry,
} from './diff/model'
import { prefetchEmbedSources, collapsedInfoOf, type PrefetchResult } from './diff/prefetch'
import { docStore } from './docstore/store'
import { createDiffMermaidNodeView, SettleCollector } from './diff/nodeview'
import { fenceIdOf } from './diff/fence-pair'
import { diagRenderUnit, degradedState } from './diff/status'
import type { DiffBase, DiffHunk } from '../git/types'
import { diagEvent } from '../diagnostics/logger'
import './diff.css'

export type { DiffNote } from './diff-deco'

export interface RenderDiffOptions {
  oldMd: string
  newMd: string
  hunks: DiffHunk[]
  refCfg: RefConfig
  path: string
  /** M18 对比基准（DiffBase；嵌入摘要/批量 IO 用它计算源文件改动） */
  base: DiffBase
  onFallback?: (reason: string) => void
}

export interface RenderDiffHandle {
  destroy(): void
}

export interface RenderDiffResult {
  handle: RenderDiffHandle
  notes: DiffNote[]
  mermaid: import('./mermaid-diff').MermaidNodeDiff[]
  /** 新文件（旧版本为空）：整篇标绿 + 一张说明卡 */
  isNewFile: boolean
  /** 渲染 Crepe 实例（批注抽屉定位/连线用；调用方负责 register/destroy） */
  crepe: Crepe
}

let newFileNoteSeq = 0

// ---------- diff 装饰插件：mount 前预构建的 DecorationSet（write-once）+ meta 更新 ----------

const diffDecoKey = new PluginKey<DecorationSet>('writeit-diff-deco')

function diffDecoPlugin(getInitial: () => DecorationSet) {
  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key: diffDecoKey,
        state: {
          // 初始装饰 = 挂载前定稿的预填充 doc 坐标（不再有 mount 后物化导致的映射漂移）
          init: () => getInitial(),
          apply(tr, old) {
            const set = tr.getMeta(diffDecoKey)
            if (set) return set
            if (!tr.docChanged) return old
            // 残余事务（object_ref 消歧的等尺寸替换等）→ 位置映射跟随（双保险）
            return old.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return diffDecoKey.getState(state) ?? DecorationSet.empty
          },
        },
      })
  )
}

// ---------- 预填充（§4.1.1：mount 前同步，消灭异步物化与时序问题） ----------

/**
 * 把宿主 doc 中所有 file_block 预填充为嵌入源的合并内容（write-once）：
 *  - 有 sourceMap 条目 → content = parse(scopeMergedMd).content + materialized=true
 *    （递归：该内容里的嵌套 file_block 同样预填充——bottom-up 内存重建，一次挂载）
 *  - 折叠（环/超深）→ collapsed attrs（FileBlockView 渲染折叠提示卡；不入 sourceMap）
 *  - 断链（读不到源）→ materialized=true + 空内容（避免 resolveRefs 读盘/toast，卡片空态提示）
 */
export function prefillDoc(hostDoc: Node, parser: (md: string) => Node | null, pf: PrefetchResult): Node {
  const collapsedQueue = new Map<string, typeof pf.collapsedScopes>()
  for (const c of pf.collapsedScopes) {
    const list = collapsedQueue.get(c.writePath) ?? []
    list.push(c)
    collapsedQueue.set(c.writePath, list)
  }
  const brokenSet = new Set(pf.brokenPaths)

  const rebuildChildren = (n: Node): Fragment => {
    const out: Node[] = []
    n.content.forEach((child) => out.push(rebuild(child)))
    return Fragment.fromArray(out)
  }

  const rebuild = (node: Node): Node => {
    if (node.type.name === 'file_block') {
      const path = String(node.attrs.path ?? '')
      const q = collapsedQueue.get(path)
      const collapsed = q && q.length ? q.shift()! : null
      if (collapsed) {
        // 折叠：清空内容 + 折叠态 attrs（FileBlockView 渲染提示卡；resolveRefs 跳过）
        return node.type.create(
          { ...node.attrs, materialized: false, collapsed: collapsedInfoOf(collapsed) },
          Fragment.empty
        )
      }
      const real = pf.writeToReal.get(path) ?? path
      const entry = pf.sourceMap.get(real)
      if (entry?.mergedMd != null) {
        const parsed = parser(entry.mergedMd)
        if (parsed) {
          // 递归预填充该源内容里的嵌套 file_block（bottom-up）
          return node.type.create(
            { ...node.attrs, materialized: true, collapsed: null },
            rebuildChildren(parsed)
          )
        }
      }
      // 断链/无内容：标记已物化（空容器），resolveRefs 不再重复读盘
      if (brokenSet.has(real) || brokenSet.has(path)) {
        return node.type.create(
          { ...node.attrs, materialized: true, collapsed: null },
          Fragment.empty
        )
      }
      // 源无改动且未知（防御）：保持原容器（resolveRefs 残留路径兜底，不影响 write-once）
      return node
    }
    if (node.isBlock && node.content.childCount > 0) {
      return node.copy(rebuildChildren(node))
    }
    return node
  }

  return hostDoc.copy(rebuildChildren(hostDoc))
}

// ---------- 图内标注 fallback（§4.8：主路径 classDef/class 由 mermaid 原生渲染；
// 仅当 class 注入失效——渲染了 SVG 但无 diff 类——时按 NodeView scope 做 DOM class 手术） ----------

function applyMermaidClassesFallback(host: HTMLElement, registry: FenceRegistry) {
  for (const f of registry.fences.values()) {
    if (!f.changed || f.skip) continue
    // sequence：消息级红绿已由 NodeView 按 messageText 标注（diff-seq-add/del），
    // 不适用 flowchart/state 的节点 class 手术（消息不是 g.node/g.state）
    if (f.type === 'sequence') continue
    const view = host.querySelector(
      `.diff-mermaid-fence[data-fence-id="${CSS.escape(f.fenceId)}"]`
    ) as HTMLElement | null
    if (!view) continue
    const svg = view.querySelector('svg') as SVGSVGElement | null
    if (!svg) continue
    if (svg.querySelector('.diffAdd') || svg.querySelector('.diffDel')) continue
    const nodes = [...svg.querySelectorAll('g.node, g.state')] as HTMLElement[]
    const findById = (id: string) =>
      nodes.find((g) => {
        const gid = g.id || ''
        return gid.includes(`-${id}-`) || gid.endsWith(`-${id}`)
      })
    for (const id of [...f.add, ...f.mod.map((m) => m.id)]) findById(id)?.classList.add('diff-node-add')
    for (const id of f.del) findById(id)?.classList.add('diff-node-del')
    diagRenderUnit(`mermaid:${f.fenceId}`, degradedState('classDef 注入失效，走 DOM class 手术 fallback', f.fenceId))
  }
}

// ---------- 嵌入卡片徽标（保留：新引用） ----------

const EMBED_LINE_RE = /^\s*!\[\[([^\]]+)\]\]\s*$/

interface EmbedChange {
  kind: 'add' | 'del' | 'mod'
  path: string
}

function collectEmbedChanges(hunks: DiffHunk[]): EmbedChange[] {
  const addSet = new Set<string>()
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind !== 'add') continue
      const m = EMBED_LINE_RE.exec(l.text)
      if (!m) continue
      addSet.add(String(m[1]).trim())
    }
  }
  return [...addSet].map((path) => ({ kind: 'add' as const, path }))
}

function addCardBadge(card: Element, cls: string, text: string, title: string) {
  let wrap = card.querySelector('.ref-embed-badges') as HTMLElement | null
  if (!wrap) {
    wrap = document.createElement('div')
    wrap.className = 'ref-embed-badges'
    card.appendChild(wrap)
  }
  if (wrap.querySelector('.' + cls)) return
  const b = document.createElement('span')
  b.className = 'ref-embed-badge ' + cls
  b.textContent = text
  b.title = title
  wrap.appendChild(b)
}

function annotateEmbedDiffBadges(target: HTMLElement, hunks: DiffHunk[] | undefined) {
  const embeds = collectEmbedChanges(hunks ?? [])
  const cards = [...target.querySelectorAll('.ref-file-block')]
  for (const card of cards) {
    const p = card.querySelector('.ref-file-block-path')?.textContent?.trim() ?? ''
    if (!p) continue
    if (embeds.some((c) => c.path === p) && !card.querySelector('.ref-embed-add')) {
      addCardBadge(card, 'ref-embed-add', '新增引用', '当前文件新增了此引用')
    }
    // Issue 1：移除「内容有改动」徽标——嵌入块内的具体改动已由内容级批注卡标注，
    // 概览徽标与「源文件有改动」说明卡冗余
  }
}

// ---------- 主渲染管线 ----------

/** 合并后批注全局去重：text/ref/annotation/diagram/embed 卡可能产同名 id（同值多处），
 *  追加序号保证 data-dnote 唯一 → 连线/定位分别命中各自锚点 */
function dedupeNotes(all: DiffNote[]): DiffNote[] {
  const seen = new Set<string>()
  const out: DiffNote[] = []
  for (const n of all) {
    if (seen.has(n.id)) {
      let i = 2
      while (seen.has(n.id + '-' + i)) i++
      const id = n.id + '-' + i
      seen.add(id)
      out.push({ ...n, id })
    } else {
      seen.add(n.id)
      out.push(n)
    }
  }
  return out
}

interface PipelineState {
  initialDecorations: DecorationSet
  notes: DiffNote[]
  diagramNotes: DiffNote[]
  embedNotes: DiffNote[]
}

interface MountedPipeline {
  crepe: Crepe
  state: PipelineState
  isNewFile: boolean
  registry: FenceRegistry
  collector: SettleCollector
  pf: PrefetchResult
}

async function mountRenderCrepe(target: HTMLElement, opts: RenderDiffOptions): Promise<MountedPipeline | null> {
  const { oldMd, newMd, refCfg, base, path } = opts
  const isNewFile = !oldMd || oldMd.trim() === ''

  try {
    // 0) 预取（IO）：嵌入源批量发现（一次往返）+ 链判定
    const pf = await prefetchEmbedSources(
      {
        base,
        hostPath: path,
        fetchEntries: async (paths) => {
          const { git } = await import('../git')
          const res = await git.showFiles(paths, base)
          // M4 §6.2：worktree/unstaged 基准下，new 侧内容查 DocStore（未保存编辑进 diff；
          // 已加载模型直接覆盖 e.next；未加载由后端 worktree 批量读补齐，语义等价）。
          // staged/range 的 new 侧是 index/commit 内容（与工作区模型无关）→ 不做覆盖。
          if (base.kind === 'worktree' || base.kind === 'unstaged') {
            for (const e of res.entries) {
              const snap = docStore.snapshot(e.realPath)
              if (snap && snap.canonical != null) {
                if (snap.canonical !== e.next) e.next = snap.canonical
                if (e.old != null) e.changed = e.old !== snap.canonical
              }
            }
          }
          return res.entries
        },
        readFile: async (p) => {
          const { git } = await import('../git')
          try {
            return await git.showFile(p, 'WORKTREE')
          } catch {
            return null
          }
        },
      },
      newMd
    )

    // 1) model（纯函数第一趟：diagram/embed/collapse records + mergedMd + registry）
    const modelDiff = computeDocDiffModel({
      oldMd,
      newMd,
      base,
      parser: undefined,
      sourceMap: pf.sourceMap,
      collapsedScopes: pf.collapsedScopes,
    })
    const registry = modelDiff.fences

    // 2) Crepe 挂载：editorStateOptionsCtx 注入预填充 doc（write-once）+ 预构建装饰
    const state: PipelineState = { initialDecorations: DecorationSet.empty, notes: [], diagramNotes: [], embedNotes: [] }
    // Issue 5：跨调用共享的 note id 去重集——宿主与各嵌入块内容 diff 的「同文案同内容」改动会算出
    // 相同内容派生 id（如宿主「二层说明」与嵌入块「明细说明」都含“新增\"（修订版）\"”），导致
    // data-dnote 冲突、连线/定位指向错误改动。整次渲染共享同一集合，使 note id（含装饰 data-dnote）全局唯一。
    const usedNoteIds = new Set<string>()
    const uniqId = (id: string): string => {
      if (!usedNoteIds.has(id)) {
        usedNoteIds.add(id)
        return id
      }
      let i = 2
      while (usedNoteIds.has(id + '-' + i)) i++
      const out = id + '-' + i
      usedNoteIds.add(out)
      return out
    }
    const crepe = new Crepe({
      root: target,
      defaultValue: modelDiff.mergedMd,
      featureConfigs: featureConfigs(),
    })
    crepe.editor.config((ctx) => {
      ctx.set(refConfigCtx.key, refCfg)
      registerRefStringify(ctx)
      // 挂载前定稿：doc = 预填充 doc；装饰/卡片 = 该 doc 坐标（自 mount 起不再变化）
      ctx.set(editorStateOptionsCtx, (give) => {
        try {
          if (!give.doc) return give
          const parser = ctx.get(parserCtx) as (md: string) => Node | null
          const prefilled = prefillDoc(give.doc, parser, pf)
          const notes: DiffNote[] = []
          const decorations: Decoration[] = []
          if (!isNewFile) {
            const oldDoc = parser(oldMd)
            if (oldDoc) {
              const r = buildDiffDecorations(oldDoc, prefilled, { usedNoteIds })
              notes.push(...r.notes)
              decorations.push(...r.decorations)
            }
          }
          // 预取到所有 mermaid 栅栏（正文级 + 嵌套级，host 坐标）——diagram / 嵌入图级卡锚定共用
          const allFences = docMermaidFences(prefilled)
          // diagram 卡片锚定：变更 fence 位置 = 预填充 doc 中的 code_block（正文级 + 嵌套级）
          const diagramNotes: DiffNote[] = []
          for (const f of allFences) {
            const fid = fenceIdOf(f.body)
            const fe = registry.fences.get(fid)
            if (!fe?.changed || fe.skip) continue
            const dto = {
              type: fe.type,
              add: fe.add,
              del: fe.del,
              mod: fe.mod,
              merged: fe.mergedBody ?? '',
            } as import('./mermaid-diff').MermaidNodeDiff
            const n = makeNote('mermaid', mermaidDiffText(dto), undefined, undefined, mermaidDiffText(dto), f.from, Math.min(f.from + 1, prefilled.content.size))
            diagramNotes.push({ ...n, id: uniqId(n.id) })
          }
          // 嵌入卡片锚定（Issue 1：移除笼统「源文件有改动」卡——具体改动已由嵌入块内容 diff 卡表达）
          const embedNotes: DiffNote[] = []
          for (const blk of docFileBlocks(prefilled)) {
            const real = pf.writeToReal.get(blk.path) ?? blk.path
            const entry = pf.sourceMap.get(real)
            if (entry?.changed) {
              const baseName = real.split('/').pop() ?? real
              // Issue 2：嵌套源的 mermaid 图级卡锚定到具体 mermaid 栅栏（host 坐标），而非整块。
              // 用 changedFenceIds（= fenceIdOf(合并后 body)，与预览 doc 栅栏同源）⊃ docMermaidFences 位置。
              try {
                const patched = patchMermaidFences(entry.oldMd ?? '', entry.newMd ?? '')
                // Issue：嵌入源变更的 mermaid 栅栏并入 registry——NodeView（含 sequence）借此
                // 拿到 add/del 做图内红绿标注（宿主 registry 只有宿主自身 fence，嵌入 fence 无 entry）。
                const regBodies = extractMermaidBodies(entry.mergedMd ?? '')
                regBodies.forEach((body, j) => {
                  const p = patched.pairs.find((pp) => pp.newIdx === j)
                  const dmd = patched.mermaid[j] as import('./mermaid-diff').MermaidNodeDiff | undefined
                  if (!p || p.oldIdx == null || !dmd) return
                  if (!(dmd.add?.length || dmd.del?.length || dmd.mod?.length)) return
                  const mergedBody = dmd.merged ?? body
                  const fid = fenceIdOf(mergedBody)
                  if (registry.fences.has(fid)) return
                  registry.fences.set(fid, {
                    fenceId: fid,
                    changed: true,
                    eager: true,
                    skip: false,
                    type: dmd.type,
                    add: dmd.add,
                    del: dmd.del,
                    mod: dmd.mod,
                    mergedBody,
                  })
                })
                const embedFences = allFences.filter((f) => f.from >= blk.from && f.from < blk.from + blk.size)
                for (let i = 0; i < patched.notes.length; i++) {
                  const pn = patched.notes[i]
                  let from = blk.from
                  let to = blk.from + blk.size
                  if (i < patched.changedFenceIds.length) {
                    const fid = patched.changedFenceIds[i]
                    const fence = embedFences.find((f) => fenceIdOf(f.body) === fid)
                    if (fence) {
                      from = fence.from
                      to = Math.min(fence.from + 1, prefilled.content.size)
                    }
                  }
                  embedNotes.push({
                    ...pn,
                    id: uniqId(pn.id),
                    text: `嵌入「${baseName}」：${pn.text}`,
                    anchor: `嵌入「${baseName}」：${pn.anchor}`,
                    from,
                    to,
                  })
                }
              } catch {
                /* 嵌套图级卡失败不影响其它 */
              }
              // Issue 7b / §4.4：嵌入块内容级 diff——源文档坐标 offset 映射进宿主 doc 该块的 content 区
              // （与「直接打开该源文件」相同的渲染规则；词/块级红绿 + 卡片）
              if (entry.oldMd != null && entry.mergedMd != null) {
                const oldSrcDoc = parser(entry.oldMd)
                const newSrcDoc = parser(entry.mergedMd)
                if (oldSrcDoc && newSrcDoc) {
                  try {
                    const r = buildDiffDecorations(oldSrcDoc, newSrcDoc, { offset: blk.from + 1, usedNoteIds })
                    decorations.push(...r.decorations)
                    for (const n of r.notes) {
                      notes.push({ ...n, text: `嵌入「${baseName}」：${n.text}` })
                    }
                  } catch (e) {
                    console.warn('[render-diff] 嵌入块内容 diff 失败:', real, e)
                  }
                }
              }
            }
          }
          state.notes = notes
          state.diagramNotes = diagramNotes
          state.embedNotes = embedNotes
          state.initialDecorations = DecorationSet.create(prefilled, decorations)
          return { ...give, doc: prefilled }
        } catch (e) {
          console.warn('[render-diff] 预填充/装饰构建失败（降级为无标注渲染）:', e)
          return give
        }
      })
    })
    crepe.editor.use(refPlugin)
    // M18：批注实体解析（<mark data-note> → annotation 节点）——使批注增删改作为实体参与 diff（结构实体卡）
    // 装配必须与主编辑器 annotationPlugin 对齐：schema（mark schema）+ 解析插件（md → annotation 节点）
    // + stringify handler（annotation 节点 → <mark> 标签）。缺 stringify handler 时，任何对含批注内容的
    // markdown 序列化（如 gfm 表格挂载时的 mdast 重写）都会以
    // 「Cannot handle unknown node `annotation`」抛错 → 主渲染降级双栏。
    crepe.editor.use([
      annotationStringifyHandler,
      ...annotationSchema,
      ...$remark('renderDiffAnnotationRemark', () => remarkAnnotation as never),
    ])
    // 自有 mermaid NodeView（覆写 code_block 视图；非 mermaid 委托 CodeMirrorBlock）
    // ——必须在 features 之后 use（nodeViewCtx 后者生效）
    const collector = new SettleCollector()
    crepe.editor.use(createDiffMermaidNodeView({ registry, settleCollector: collector }))
    crepe.editor.use(diffDecoPlugin(() => state.initialDecorations))
    await crepe.create()
    crepe.setReadonly(true)
    // 残余：object_ref 消歧（等尺寸 attr 替换，不改 doc 尺寸；不参与 settle）
    void resolveRefs(crepe.editor)
    return { crepe, state, isNewFile, registry, collector, pf }
  } catch (e) {
    console.warn('[render-diff] Crepe 挂载失败:', e, (e as Error).stack)
    return null
  }
}

/** 渲染单 Crepe「预填充 doc + 结构级 diff 装饰」到 target。返回句柄 + 批注卡 + 变更（调用方负责 destroy） */
export async function renderDiffToContainer(
  target: HTMLElement,
  opts: RenderDiffOptions
): Promise<RenderDiffResult | null> {
  const { hunks, onFallback, path } = opts
  let crepe: Crepe | null = null
  try {
    target.textContent = ''
    const mounted = await mountRenderCrepe(target, opts)
    if (!mounted) {
      onFallback?.('Crepe 渲染失败，降级为双栏全文对比')
      return null
    }
    crepe = mounted.crepe
    const { registry, collector } = mounted
    const notes: DiffNote[] = dedupeNotes([
      ...mounted.state.notes,
      ...mounted.state.diagramNotes,
      ...mounted.state.embedNotes,
    ])
    const isNewFile = mounted.isNewFile

    // 2c) 新文件：整篇标绿 + 一张「新增文件」说明卡
    if (isNewFile) {
      target.classList.add('rd-new-file')
      notes.push({
        id: `dn-newfile-${++newFileNoteSeq}`,
        kind: 'block',
        text: `新增文件（${opts.newMd.trim() ? opts.newMd.split('\n').length : 0} 行内容，全文标绿）`,
        anchor: '新增文件',
        from: -1,
        to: -1,
      })
    }

    // 3) 单点 settle：变更 fence 的 eager 渲染（Promise.allSettled + 5s 兜底；无轮询补标）
    const settled = await collector.settle(5000)

    // 4) overlay：徽标 + class 注入失效时的 scoped DOM fallback（一次性；连线由事件/ResizeObserver 重绘）
    annotateEmbedDiffBadges(target, hunks)
    applyMermaidClassesFallback(target, registry)
    diagEvent('diff:render', {
      target: path,
      ok: settled.every((r) => r.ok),
      data: { fences: settled.length, degraded: settled.filter((r) => !r.ok).map((r) => r.reason) },
    })

    const handle: RenderDiffHandle = {
      destroy: () => {
        void crepe?.destroy()
      },
    }
    const mermaidList = [...registry.fences.values()]
      .filter((f) => f.changed)
      .map((f) => ({
        type: f.type,
        add: f.add,
        del: f.del,
        mod: f.mod,
        merged: f.mergedBody ?? '',
      }))
    return {
      handle,
      notes,
      mermaid: mermaidList as import('./mermaid-diff').MermaidNodeDiff[],
      isNewFile,
      crepe,
    }
  } catch (e) {
    console.warn('[render-diff] 渲染异常:', e)
    onFallback?.('渲染异常，降级为双栏全文对比')
    void crepe?.destroy()
    return null
  }
}

/** 双栏全文对比（降级）：旧 | 新 各自渲染全文 */
export async function renderSplitFallback(
  target: HTMLElement,
  opts: RenderDiffOptions
): Promise<RenderDiffHandle | null> {
  const { oldMd, newMd, refCfg } = opts
  const oldLayer = document.createElement('div')
  oldLayer.style.cssText = 'position:fixed;inset:0;opacity:0.01;pointer-events:none;z-index:-1;'
  const newLayer = document.createElement('div')
  newLayer.style.cssText = 'position:fixed;inset:0;opacity:0.01;pointer-events:none;z-index:-1;'
  document.body.appendChild(oldLayer)
  document.body.appendChild(newLayer)
  let oldCrepe: Crepe | null = null
  let newCrepe: Crepe | null = null
  let disposed = false
  const cleanup = () => {
    disposed = true
    void oldCrepe?.destroy()
    void newCrepe?.destroy()
    oldLayer.remove()
    newLayer.remove()
  }
  try {
    const waitForRender = (host: HTMLElement, waitMs = 2500) => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const start = Date.now()
      const ready = () => !!host.querySelector('.mermaid, svg[data-processed], .preview, .mmd-zoomable')
      return (async () => {
        await sleep(200)
        if (ready()) return true
        while (Date.now() - start < waitMs) {
          await sleep(300)
          if (ready()) return true
        }
        return false
      })()
    }
    ;[oldCrepe, newCrepe] = await Promise.all([
      mountPlainCrepe(oldLayer, oldMd, refCfg),
      mountPlainCrepe(newLayer, newMd, refCfg),
    ])
    if (disposed) {
      cleanup()
      return null
    }
    await Promise.all([waitForRender(oldLayer, 2000), waitForRender(newLayer, 2000)])
    const oldProse = oldLayer.querySelector('.ProseMirror') as HTMLElement | null
    const newProse = newLayer.querySelector('.ProseMirror') as HTMLElement | null
    const wrap = document.createElement('div')
    wrap.className = 'rd-split-fallback'
    const oldCol = document.createElement('div')
    oldCol.className = 'rd-col'
    const newCol = document.createElement('div')
    newCol.className = 'rd-col'
    if (oldProse) {
      const c = oldProse.cloneNode(true) as HTMLElement
      c.removeAttribute('style')
      oldCol.appendChild(c)
    }
    if (newProse) {
      const c = newProse.cloneNode(true) as HTMLElement
      c.removeAttribute('style')
      newCol.appendChild(c)
    }
    wrap.appendChild(oldCol)
    wrap.appendChild(newCol)
    target.textContent = ''
    target.appendChild(wrap)
    return { destroy: cleanup }
  } catch (e) {
    console.warn('[render-diff] 降级渲染异常:', e)
    cleanup()
    return null
  }
}

/** 降级链共享的最小化 mount（无 diff 装饰/预填充的普通 readonly Crepe） */
async function mountPlainCrepe(root: HTMLElement, md: string, refCfg: RefConfig): Promise<Crepe | null> {
  try {
    const crepe = new Crepe({ root, defaultValue: md, featureConfigs: featureConfigs() })
    crepe.editor.config((ctx) => {
      ctx.set(refConfigCtx.key, refCfg)
      registerRefStringify(ctx)
    })
    crepe.editor.use(refPlugin)
    await crepe.create()
    crepe.setReadonly(true)
    return crepe
  } catch (e) {
    console.warn('[render-diff] 降级 mount 失败:', e)
    return null
  }
}

export type { FenceRegistry }