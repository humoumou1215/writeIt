// M13：渲染模式——单 Crepe 渲染「组合 md」（替代 M11c 的双 Crepe + DOM 提取）
// 流程：composeDiff（hunks+words → 组合 md + 批注卡）→ 单 readonly Crepe（+ diff 节点插件）直接渲染
// 降级链：Crepe 失败/渲染异常 → 双栏全文对比（renderSplitFallback）
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { refPlugin, refConfigCtx, type RefConfig } from './ref'
import { resolveRefs } from './ref/resolve'
import { registerRefStringify } from './ref/stringify'
import { featureConfigs } from './features'
import { diffPlugin } from './diff-nodes'
import { composeDiff, type DiffNote } from './diff-compose'
import type { MermaidNodeDiff } from './mermaid-diff'
import { extractFlowchartNodes, extractSequenceMessages, extractStates } from './mermaid-diff'
import type { DiffHunk } from '../git/types'

export interface RenderDiffOptions {
  oldMd: string
  newMd: string
  hunks: DiffHunk[]
  refCfg: RefConfig
  path: string
  onFallback?: (reason: string) => void
}

export interface RenderDiffHandle {
  destroy(): void
}

export interface RenderDiffResult {
  handle: RenderDiffHandle
  notes: DiffNote[]
  mermaid: MermaidNodeDiff[]
  /** M14：渲染 Crepe 实例（批注抽屉定位/连线用；调用方负责 register/destroy） */
  crepe: Crepe
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

async function mountRenderCrepe(
  container: HTMLElement,
  md: string,
  refCfg: RefConfig
): Promise<Crepe | null> {
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
    // 先注册 remarkDiffInline 再注册 remark-ref：保证 {++..++}/{--..--} 先拆分成 diff 节点，
    // 否则 [[path#frag]] / ![[path]] 会先被 remark-ref 拆成 fileRef/fileBlock，
    // 把标记拆成孤立文本 → 花括号泄漏 / 嵌入退化为文件链接
    crepe.editor.use(diffPlugin)
    crepe.editor.use(refPlugin)
    await crepe.create()
    // [调试] schema 检查
    try {
      crepe.editor.action((ctx) => {
        const nodes = Object.keys(ctx.get(editorViewCtx).state.schema.nodes)
        const names: string[] = []
        ctx.get(editorViewCtx).state.doc.descendants((n) => { names.push(n.type.name); return true })
        console.log('[render-diff] doc nodes:', names.filter((n, i) => names.indexOf(n) === i).join(','))
        console.log('[render-diff] schema has diff:', ['diffContainer', 'diffDel', 'diffIns'].filter((n) => nodes.includes(n)).join(',') || 'NONE')
      })
    } catch (e) {
      console.log('[render-diff] schema check err:', (e as Error).message)
    }
    crepe.setReadonly(true)
    try {
      await Promise.race([resolveRefs(crepe.editor), sleep(1500)])
    } catch {
      /* 物化失败不影响渲染 */
    }
    return crepe
  } catch (e) {
    console.warn('[render-diff] Crepe 挂载失败:', e, (e as Error).stack)
    return null
  }
}

/** mermaid 渲染后 DOM 标注（M14：不用 classDef/id:::class 语法）：
 *  flowchart / stateDiagram → 按节点 id 定位 SVG <g> 元素加 class（add 绿 / del 红虚线划线）
 *  sequence → 按消息文本定位加 class（add 绿 / del 红）——M16：去掉黄色 mod，二元增删语义 */
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
    // <g class="node|state"> 的 id 形如 "mmd-N-flowchart-A-0"（带 mermaid 实例前缀）→ 子串匹配
    const nodes = [...svg.querySelectorAll('g.node, g.state')] as HTMLElement[]
    const apply = (id: string, cls: string) => {
      if (!id) return
      const el = nodes.find((g) => {
        const gid = g.id || ''
        return gid.includes(`-${prefix}-${id}-`) || gid.endsWith(`-${prefix}-${id}`)
      })
      if (el) el.classList.add(cls)
    }
    for (const id of d.add) apply(id, 'diff-node-add')
    for (const id of d.del) apply(id, 'diff-node-del')
  }
}

/** M14/M16：嵌入块源文件有未提交改动 → 卡片角标 + 内嵌改动摘要；
 *  ① 嵌入行本身是本次改动的增/删/改 → 卡片头部徽标（新增引用/移除引用/引用变更）
 *  ② 源文件有未提交改动（v16：修复无扩展名路径匹配失败的旧 bug）→ 「内容有改动」角标 + 底部源文件改动摘要
 */
const EMBED_LINE_RE = /^\s*!\[\[([^\]]+)\]\]\s*$/

interface EmbedChange {
  kind: 'add' | 'del' | 'mod'
  path: string
}

/** 从 hunks 收集嵌入引用行的变化（path 保持源码形式，无扩展名）。
 *  M16：二元语义——删除的引用由组合器输出缩略红行（见 diff-compose），不挂卡片徽标；
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

/** 卡片路径（无扩展名）→ git 状态路径匹配（可能带 .md/.markdown/.txt 后缀） */
function matchChangedPath(p: string, changed: string[]): string | null {
  if (changed.includes(p)) return p
  return changed.find((sp) => {
    for (const ext of ['.md', '.markdown', '.txt']) {
      if (sp === p + ext || sp.endsWith('/' + p + ext)) return true
    }
    return false
  }) ?? null
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
async function renderEmbedDiffSummary(changedPath: string): Promise<HTMLElement | null> {
  const { git } = await import('../git')
  let diff: Awaited<ReturnType<typeof git.diffFile>>
  try {
    diff = await git.diffFile(changedPath, null, 'HEAD')
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
  title.title = '被嵌入模块（源文件）相对 HEAD 的未提交改动'
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
}

async function annotateEmbedDiffBadges(target: HTMLElement, hunks?: DiffHunk[]) {
  const { git } = await import('../git')
  if (!git.available) return
  let changed: string[] = []
  try {
    changed = (await git.status()).map((s) => s.path)
  } catch {
    return
  }
  if (!changed.length) return
  target.querySelectorAll('.ref-file-block').forEach((card) => {
    const p = card.querySelector('.ref-file-block-path')?.textContent?.trim() ?? ''
    if (!p) return
    // ① 引用行本身是本次改动（新增/移除/变更）→ 头部徽标
    const embeds = collectEmbedChanges(hunks ?? [])
    const ec = embeds.find((c) => c.path === p)
    if (ec) {
      addCardBadge(card, 'ref-embed-add', '新增引用', '当前文件新增了此引用')
    }
    // ② 源文件有未提交改动 → 「内容有改动」角标 + 内嵌改动摘要
    const changedPath = matchChangedPath(p, changed)
    if (changedPath) {
      addCardBadge(card, 'ref-embed-diff-badge', '内容有改动', `源文件 ${changedPath} 有未提交改动`)
      if (!card.querySelector('.ref-embed-diff-summary')) {
        void renderEmbedDiffSummary(changedPath).then((el) => {
          if (el && card.isConnected) card.appendChild(el)
        })
      }
    }
  })
}

/** 渲染单 Crepe 组合 md 到 target。返回句柄 + 批注卡 + mermaid 变更（调用方负责 destroy） */
export async function renderDiffToContainer(
  target: HTMLElement,
  opts: RenderDiffOptions
): Promise<RenderDiffResult | null> {
  const { oldMd, newMd, hunks, refCfg, path, onFallback } = opts
  let crepe: Crepe | null = null
  try {
    const { composedMd, notes, mermaid } = composeDiff({ oldMd, newMd, hunks, path })

    target.textContent = ''
    crepe = await mountRenderCrepe(target, composedMd, refCfg)
    if (!crepe) {
      onFallback?.('Crepe 渲染失败，降级为双栏全文对比')
      return null
    }
    await waitForRender(target, 2500)
    // mermaid 渲染完成 + 节点标注（异步）→ 立即 + 轮询补标
    const annotateNow = () => {
      applyMermaidAnnotations(target, mermaid)
      void annotateEmbedDiffBadges(target, hunks)
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
      mountRenderCrepe(oldLayer, oldMd, refCfg),
      mountRenderCrepe(newLayer, newMd, refCfg),
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
