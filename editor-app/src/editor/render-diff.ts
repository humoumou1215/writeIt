// M17：渲染模式——单 Crepe 渲染「新文档 + 结构级 diff 装饰」（替代 M13 的组合 md 注入管线）
// 流程：patchMermaidFences（fence 节点级合并）→ 单 readonly Crepe（+ diff 装饰插件）渲染
//   → 用 parserCtx 解析旧文档 → computeDocDiff → 构建 DecorationSet → dispatch 注入
//   → 渲染后 DOM 标注（mermaid 节点/嵌入徽标）
// 降级链：Crepe 失败/渲染异常 → 双栏全文对比（renderSplitFallback）
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { refPlugin, refConfigCtx, type RefConfig } from './ref'
import { resolveRefs } from './ref/resolve'
import { registerRefStringify } from './ref/stringify'
import { featureConfigs } from './features'
import { buildDiffDecorations, patchMermaidFences, type DiffNote } from './diff-deco'
import type { MermaidNodeDiff } from './mermaid-diff'
import { extractFlowchartNodes, extractSequenceMessages, extractStates } from './mermaid-diff'
import type { DiffHunk } from '../git/types'
import './diff.css'

export type { DiffNote } from './diff-deco'

export interface RenderDiffOptions {
  oldMd: string
  newMd: string
  hunks: DiffHunk[]
  refCfg: RefConfig
  path: string
  /** 当前 diff 的对比基准（工作区 from=null to=HEAD；提交对比 from=sha^ to=sha）——嵌入摘要用它计算源文件改动 */
  from: string | null
  to: string
  baseLabel: string
  onFallback?: (reason: string) => void
}

export interface RenderDiffHandle {
  destroy(): void
}

export interface RenderDiffResult {
  handle: RenderDiffHandle
  notes: DiffNote[]
  mermaid: MermaidNodeDiff[]
  /** 渲染 Crepe 实例（批注抽屉定位/连线用；调用方负责 register/destroy） */
  crepe: Crepe
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- diff 装饰插件：meta 注入预构建的 DecorationSet ----------

/** 插件 key：transaction meta 携带构建好的 DecorationSet（构建于 doc 就绪后） */
const diffDecoKey = new PluginKey<DecorationSet>('writeit-diff-deco')

function diffDecoPlugin() {
  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key: diffDecoKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const set = tr.getMeta(diffDecoKey)
            if (set) return set
            if (!tr.docChanged) return old
            // 文档后续变化（嵌入物化等）→ 位置映射跟随
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

/** 等待 mermaid 预览渲染（renderPreview 异步） */
async function waitForRender(host: HTMLElement, waitMs = 2500): Promise<boolean> {
  const start = Date.now()
  const ready = () => !!host.querySelector('.mermaid, svg[data-processed], .preview-container, .preview svg, .mmd-zoomable')
  await sleep(200)
  if (ready()) return true
  while (Date.now() - start < waitMs) {
    await sleep(300)
    if (ready()) return true
  }
  return false
}

interface MountResult {
  crepe: Crepe
  notes: DiffNote[]
}

async function mountRenderCrepe(
  container: HTMLElement,
  md: string,
  refCfg: RefConfig,
  oldMd?: string
): Promise<MountResult | null> {
  try {
    const crepe = new Crepe({
      root: container,
      defaultValue: md,
      featureConfigs: featureConfigs(),
    })
    crepe.editor.config((ctx) => {
      ctx.set(refConfigCtx.key, refCfg)
      registerRefStringify(ctx)
    })
    // 先用 remark-ref 解析（[[path#frag]] / ![[path]] → fileRef / fileBlock），
    // diff 装饰插件全程无标记语法，不再需要 marker 先行拆分
    crepe.editor.use(refPlugin)
    crepe.editor.use(diffDecoPlugin())
    await crepe.create()
    // 结构级 diff：解析旧文档 → 构建装饰 → 注入（doc 坐标即渲染坐标，无需再映射）
    const notes: DiffNote[] = []
    if (oldMd) {
      try {
        const ok = await crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const parser = ctx.get(parserCtx)
          const oldDoc = parser(oldMd)
          const newDoc = view.state.doc
          if (!oldDoc) return false
          const { decorations, notes: ns } = buildDiffDecorations(oldDoc, newDoc)
          notes.push(...ns)
          const tr = view.state.tr.setMeta(diffDecoKey, DecorationSet.create(newDoc, decorations))
          view.dispatch(tr)
          return true
        })
        if (!ok) console.warn('[render-diff] 旧文档解析失败，跳过 diff 标注')
      } catch (e) {
        console.warn('[render-diff] diff 装饰构建失败（文档继续渲染，无标注）:', e)
      }
    }
    crepe.setReadonly(true)
    try {
      await Promise.race([resolveRefs(crepe.editor), sleep(1500)])
    } catch {
      /* 物化失败不影响渲染 */
    }
    return { crepe, notes }
  } catch (e) {
    console.warn('[render-diff] Crepe 挂载失败:', e, (e as Error).stack)
    return null
  }
}

/** mermaid 渲染后 DOM 标注（M14：不用 classDef/id:::class 语法）：
 *  flowchart / stateDiagram → 按节点 id 定位 SVG <g> 元素加 class（add 绿 / del 红虚线划线）
 *  mod（同 id 标签变化）→ 节点绿（新）+ 节点下追加红划线旧值小字；
 *  sequence → 按消息文本精确匹配加 class（add 绿 / del 红）——M16b：二元语义 */
function applyMermaidAnnotations(target: HTMLElement, mermaidList: MermaidNodeDiff[]) {
  for (const d of mermaidList) {
    const svg = target.querySelector(
      '.mermaid svg, svg[data-processed], .preview svg, .mmd-zoomable svg'
    ) as HTMLElement | null
    if (!svg) continue
    if (d.type === 'sequence') {
      if (!d.messages?.length) continue
      for (const msg of d.messages) {
        const els = [...svg.querySelectorAll('text, tspan')]
        // 精确匹配优先：避免「推送客户」误命中「推送客户资料」（includes 前缀包含）
        const el =
          els.find((e) => (e.textContent || '').trim() === msg.text) ??
          els.find((e) => (e.textContent || '').includes(msg.text))
        if (el) el.classList.add(msg.kind === 'add' ? 'diff-seq-add' : 'diff-seq-del')
      }
      continue
    }
    if (d.type !== 'flowchart' && d.type !== 'state') continue
    const prefix = d.type === 'flowchart' ? 'flowchart' : 'state'
    const nodes = [...svg.querySelectorAll('g.node, g.state')] as HTMLElement[]
    const findById = (id: string) =>
      nodes.find((g) => {
        const gid = g.id || ''
        return gid.includes(`-${prefix}-${id}-`) || gid.endsWith(`-${prefix}-${id}`)
      })
    const apply = (id: string, cls: string) => {
      if (!id) return
      const el = findById(id)
      if (el) el.classList.add(cls)
    }
    for (const id of d.add) apply(id, 'diff-node-add')
    for (const id of d.del) apply(id, 'diff-node-del')
    // M16b：标签修改 → 节点绿（新值）+ 节点下方红划线旧值（体现「删除后新增」）
    for (const m of d.mod) {
      const g = findById(m.id)
      if (!g) continue
      g.classList.add('diff-node-add')
      g.classList.add('diff-node-mod')
      const old = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      old.setAttribute('class', 'diff-mod-old')
      old.textContent = m.old
      const label = g.querySelector('.nodeLabel, .state-label, text') as SVGTextElement | null
      if (label) {
        const b = label.getBBox ? label.getBBox() : null
        old.setAttribute('x', String(b ? b.x + b.width / 2 : 0))
        old.setAttribute('y', String(b ? b.y + b.height + 14 : 14))
        old.setAttribute('text-anchor', 'middle')
        g.appendChild(old)
      }
    }
  }
}

/** 嵌入块源文件有未提交改动 → 卡片角标 + 内嵌改动摘要；
 *  ① 嵌入行本身是本次改动的增/删/改 → 卡片头部徽标（新增引用/移除引用）
 *  ② 源文件有未提交改动 → 「内容有改动」角标 + 底部源文件改动摘要
 */
const EMBED_LINE_RE = /^\s*!\[\[([^\]]+)\]\]\s*$/

interface EmbedChange {
  kind: 'add' | 'del' | 'mod'
  path: string
}

/** 从 hunks 收集嵌入引用行的变化（path 保持源码形式，无扩展名）。
 *  M16：二元语义——删除的引用由装饰层输出红色占位行，不挂卡片徽标；
 *  此处只统计新增引用（挂卡片绿徽标）。 */
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

/** 卡片头部徽标容器（.ref-embed-badges 绝对定位于卡片右上，多徽标纵向排列；同一徽标不重复） */
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

/** 从变更行推断 mermaid 结构变化概要（fence 开/闭行可能在 hunk 外无上下文，
 *  直接对 del 行集 / add 行集提取节点/消息集合做差集） */
function buildMermaidSummary(delLines: string[], addLines: string[]): string | null {
  const cand = [...delLines, ...addLines]
  const HAS_SEQ = /->>|-->>/
  const HAS_STATE = /^\s*state\s/m
  const HAS_FLOW = /-->|==>|-\.->/
  const labelOf = (t: string) =>
    t === 'sequence' ? '时序图' : t === 'state' ? '状态图' : '流程图'
  let parts: string[] = []
  let label = ''

  if (cand.some((t) => HAS_SEQ.test(t))) {
    const o = extractSequenceMessages(delLines.join('\n'))
    const n = extractSequenceMessages(addLines.join('\n'))
    const added = n.filter((m) => !o.includes(m))
    const removed = o.filter((m) => !n.includes(m))
    label = labelOf('sequence')
    if (added.length) parts.push(`新增 ${added.length} 个消息`)
    if (removed.length) parts.push(`删除 ${removed.length} 个消息`)
  } else if (cand.some((t) => HAS_STATE.test(t))) {
    const o = extractStates(delLines.join('\n'))
    const n = extractStates(addLines.join('\n'))
    label = labelOf('state')
    const addIds = [...n.keys()].filter((id) => !o.has(id))
    const delIds = [...o.keys()].filter((id) => !n.has(id))
    if (addIds.length) parts.push(`新增 ${addIds.length} 个状态`)
    if (delIds.length) parts.push(`删除 ${delIds.length} 个状态`)
  } else if (cand.some((t) => HAS_FLOW.test(t))) {
    const o = extractFlowchartNodes(delLines.join('\n'))
    const n = extractFlowchartNodes(addLines.join('\n'))
    label = labelOf('flowchart')
    const addIds = [...n.keys()].filter((id) => !o.has(id))
    const delIds = [...o.keys()].filter((id) => !n.has(id))
    if (addIds.length) parts.push(`新增 ${addIds.length} 个节点`)
    if (delIds.length) parts.push(`删除 ${delIds.length} 个节点`)
  }
  if (!parts.length) return null
  return `◆ ${label}：${parts.join('、')}`
}

/** 内嵌源文件改动摘要：仅变化行（+/-） + mermaid 结构变化概要；表格分隔行噪音省略 */
/** 引用路径候选解析：优先带 .md 的已跟踪文件（diffFile 需要真实路径） */
function resolveRefFilePath(p: string, base: DiffBaseRef): Promise<string | null> {
  return (async () => {
    const { git } = await import('../git')
    for (const cand of [p, `${p}.md`, `${p}.markdown`, `${p}.txt`]) {
      try {
        const d = await git.diffFile(cand, base.from, base.to)
        if (d && (d.hunks.length || d.exists)) return cand
      } catch {
        /* 尝试下一候选 */
      }
    }
    return null
  })()
}

/** 嵌入摘要结果缓存（path+from+to） */
const embedSummaryCache = new Map<string, Promise<HTMLElement | null>>()

async function renderEmbedDiffSummary(changedPath: string, base: DiffBaseRef): Promise<HTMLElement | null> {
  const key = `${base.from ?? ''}..${base.to}::${changedPath}`
  const hit = embedSummaryCache.get(key)
  if (hit) return hit
  const run = (async () => {
    const { git } = await import('../git')
    let diff: Awaited<ReturnType<typeof git.diffFile>>
    try {
      diff = await git.diffFile(changedPath, base.from, base.to)
    } catch {
      return null
    }
    const lines = diff.hunks.flatMap((h) => h.lines)
    if (!lines.length) return null

    const wrap = document.createElement('div')
    wrap.className = 'ref-embed-diff-summary'
    const title = document.createElement('div')
    title.className = 'eds-title'
    title.textContent = `源文件改动 → ${changedPath}`
    title.title = `被嵌入模块（源文件）在「${base.label}」范围内的改动`
    wrap.appendChild(title)

    const delLines: string[] = []
    const addLines: string[] = []
    for (const l of lines) {
      if (l.kind === 'add') addLines.push(l.text)
      else if (l.kind === 'del') delLines.push(l.text)
    }
    // mermaid 结构变化概要
    const mermaidRow = buildMermaidSummary(delLines, addLines)
    if (mermaidRow) {
      const row = document.createElement('div')
      row.className = 'eds-line eds-mermaid'
      row.textContent = mermaidRow
      wrap.appendChild(row)
    }
    // mermaid 语法行已并入概要，避免重复逐行展示
    const isMermaidSyntax = (t: string) => /->>|-->>|-->|==>|-\.->|^\s*state\s/.test(t)
    const isSep = (s: string) => /^\s*\|/.test(s) && s.split('|').slice(1, -1).every((c) => /^:?-+:?$/.test(c.trim()))
    for (const h of diff.hunks) {
      for (const l of h.lines) {
        if (l.kind === 'ctx') continue
        if (isSep(l.text)) continue
        if (isMermaidSyntax(l.text)) continue
        const row = document.createElement('div')
        row.className = 'eds-line ' + (l.kind === 'add' ? 'eds-add' : 'eds-del')
        row.textContent = (l.kind === 'add' ? '+ ' : '− ') + l.text
        wrap.appendChild(row)
      }
    }
    return wrap
  })()
  embedSummaryCache.set(key, run)
  return run
}

/** 嵌入 diff 对比基准 */
interface DiffBaseRef {
  from: string | null
  to: string
  label: string
}

/** 嵌入块源文件在对比范围内有改动 → 卡片角标 + 内嵌改动摘要；
 *  ① 引用行本身是本次改动（新增引用）→ 卡片头部绿徽标（删除由装饰层输出红色占位行）
 *  ② 源文件在 from..to 有改动（工作区 / commit 对比统一）→ 「内容有改动」角标 + 底部源文件改动摘要 */
async function annotateEmbedDiffBadges(target: HTMLElement, hunks: DiffHunk[] | undefined, base: DiffBaseRef) {
  const embeds = collectEmbedChanges(hunks ?? [])
  const cards = [...target.querySelectorAll('.ref-file-block')]
  await Promise.all(
    cards.map(async (card) => {
      const p = card.querySelector('.ref-file-block-path')?.textContent?.trim() ?? ''
      if (!p) return
      // ① 引用行本身是本次改动（新增引用）→ 绿徽标
      if (embeds.some((c) => c.path === p) && !card.querySelector('.ref-embed-add')) {
        addCardBadge(card, 'ref-embed-add', '新增引用', '当前文件新增了此引用')
      }
      // ② 源文件在对比范围内有改动 → 角标 + 摘要
      if (card.querySelector('.ref-embed-diff-badge') || card.querySelector('.ref-embed-diff-summary')) return
      const changedPath = await resolveRefFilePath(p, base)
      if (!changedPath) return
      const d = await (async () => {
        const { git } = await import('../git')
        try {
          return await git.diffFile(changedPath, base.from, base.to)
        } catch {
          return null
        }
      })()
      if (d && d.hunks.length) {
        addCardBadge(card, 'ref-embed-diff-badge', '内容有改动', `源文件 ${changedPath} 在「${base.label}」有改动`)
        const el = await renderEmbedDiffSummary(changedPath, base)
        if (el && card.isConnected) card.appendChild(el)
      }
    })
  )
}

/** 在渲染 doc 中按类型/路径给 -1 位置的 note 定位（mermaid → 按序 code_block；引用 → file_block 按 path） */
function locateNotesByDoc(crepe: Crepe, notes: DiffNote[]) {
  const mermaidNotes = notes.filter((n) => n.kind === 'mermaid')
  const embedNotes = notes.filter((n) => n.kind === 'block' && n.text.startsWith('移除了引用'))
  if (!mermaidNotes.length && !embedNotes.length) return
  try {
    crepe.editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc
      const mermaidPositions: number[] = []
      doc.descendants((n, pos) => {
        if (n.type.name === 'code_block' && (n.attrs.language as string) === 'mermaid') mermaidPositions.push(pos)
        return true
      })
      mermaidNotes.forEach((n, i) => {
        if (mermaidPositions[i] !== undefined) {
          n.from = mermaidPositions[i]
          n.to = mermaidPositions[i] + 1
        }
      })
      if (embedNotes.length) {
        doc.descendants((n, pos) => {
          if (n.type.name === 'file_block') {
            const p = String(n.attrs.path ?? '')
            const hit = embedNotes.find((no) => no.from < 0 && (no.del === p || no.anchor.includes(p)))
            if (hit) {
              hit.from = pos
              hit.to = pos + 1
            }
          }
          return true
        })
      }
    })
  } catch {
    /* 编辑器已销毁 */
  }
}

/** 渲染单 Crepe「新文档 + 结构级 diff 装饰」到 target。返回句柄 + 批注卡 + mermaid 变更（调用方负责 destroy） */
export async function renderDiffToContainer(
  target: HTMLElement,
  opts: RenderDiffOptions
): Promise<RenderDiffResult | null> {
  const { oldMd, newMd, hunks, refCfg, from, to, baseLabel, onFallback } = opts
  const base = { from: from ?? null, to, label: baseLabel }
  let crepe: Crepe | null = null
  try {
    // 1) mermaid fence 节点级预合并（新源码为底 + 删除节点加回），其余照旧
    const { md: patchedMd, mermaid, notes: mermaidNotes } = patchMermaidFences(oldMd, newMd)

    target.textContent = ''
    const mounted = await mountRenderCrepe(target, patchedMd, refCfg, oldMd)
    if (!mounted) {
      onFallback?.('Crepe 渲染失败，降级为双栏全文对比')
      return null
    }
    crepe = mounted.crepe
    const notes = [...mounted.notes]
    // 2) mermaid / 移除引用 note 的 -1 位置按 doc 定位
    notes.push(...mermaidNotes)
    locateNotesByDoc(crepe, notes)

    await waitForRender(target, 2500)
    // 3) mermaid 渲染完成 + 节点标注（异步）→ 立即 + 轮询补标；嵌入徽标/摘要
    const annotateNow = () => {
      applyMermaidAnnotations(target, mermaid)
      void annotateEmbedDiffBadges(target, hunks, base)
    }
    annotateNow()
    setTimeout(annotateNow, 400)
    setTimeout(annotateNow, 1200)
    setTimeout(annotateNow, 2500)
    return {
      handle: {
        destroy: () => {
          void crepe?.destroy()
        },
      },
      notes,
      mermaid,
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
    ;[oldCrepe, newCrepe] = await Promise.all([
      mountRenderCrepe(oldLayer, oldMd, refCfg).then((r) => r?.crepe ?? null),
      mountRenderCrepe(newLayer, newMd, refCfg).then((r) => r?.crepe ?? null),
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