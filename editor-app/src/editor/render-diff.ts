// M13：渲染模式——单 Crepe 渲染「组合 md」（替代 M11c 的双 Crepe + DOM 提取）
// 流程：composeDiff（hunks+words → 组合 md + 批注卡）→ 单 readonly Crepe（+ diff 节点插件）直接渲染
// 降级链：Crepe 失败/渲染异常 → 双栏全文对比（renderSplitFallback）
import { Crepe } from '@milkdown/crepe'
import { refPlugin, refConfigCtx, type RefConfig } from './ref'
import { resolveRefs } from './ref/resolve'
import { registerRefStringify } from './ref/stringify'
import { featureConfigs } from './features'
import { diffPlugin } from './diff-nodes'
import { composeDiff, type DiffNote } from './diff-compose'
import type { MermaidNodeDiff } from './mermaid-diff'
import type { DiffHunk } from '../git/types'

export interface RenderDiffOptions {
  oldMd: string
  newMd: string
  hunks: DiffHunk[]
  refCfg: RefConfig
  onFallback?: (reason: string) => void
}

export interface RenderDiffHandle {
  destroy(): void
}

export interface RenderDiffResult {
  handle: RenderDiffHandle
  notes: DiffNote[]
  mermaid: MermaidNodeDiff[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 等待 mermaid 预览渲染（renderPreview 异步） */
async function waitForRender(host: HTMLElement, waitMs = 2500): Promise<boolean> {
  const start = Date.now()
  const ready = () => !!host.querySelector('.mermaid, svg[data-processed], .preview-container')
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
    crepe.editor.use(refPlugin)
    // M13：diff 节点（{-- --}/{++ ++}/::: diff-*）
    crepe.editor.use(diffPlugin)
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

/** fenced code 块标注：diff-add / diff-del 语言 → 加类（绿/红底） */
function annotateDiffCodeBlocks(target: HTMLElement) {
  target.querySelectorAll('.milkdown-code-block').forEach((el) => {
    const btn = el.querySelector('.language-button')
    const lang = (btn?.textContent ?? '').trim().toLowerCase()
    if (lang === 'diff-add') el.classList.add('diff-code-add')
    else if (lang === 'diff-del') el.classList.add('diff-code-del')
  })
}

/** sequence 图：渲染后按消息文本定位 SVG 元素加 class（flowchart/state 用 classDef，无需操作） */
function applyMermaidAnnotations(target: HTMLElement, mermaidList: MermaidNodeDiff[]) {
  for (const d of mermaidList) {
    if (d.type !== 'sequence' || !d.messages?.length) continue
    const svg = target.querySelector('.mermaid svg, svg[data-processed]') as HTMLElement | null
    if (!svg) continue
    for (const msg of d.messages) {
      const el = [...svg.querySelectorAll('text, tspan, div')].find((e) =>
        (e.textContent || '').includes(msg.text)
      )
      if (el) el.classList.add(msg.kind === 'add' ? 'diff-seq-add' : 'diff-seq-mod')
    }
  }
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
    // CodeMirror 语言按钮可能晚于 mermaid 渲染 → 轮询标注
    const annotateNow = () => {
      annotateDiffCodeBlocks(target)
      applyMermaidAnnotations(target, mermaid)
    }
    annotateNow()
    setTimeout(annotateNow, 400)
    setTimeout(annotateNow, 1200)
    return {
      handle: {
        destroy: () => {
          void crepe?.destroy()
        },
      },
      notes,
      mermaid,
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
