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

/** mermaid 渲染后 DOM 标注（M14：不用 classDef/id:::class 语法）：
 *  flowchart / stateDiagram → 按节点 id 定位 SVG <g> 元素加 class（add 绿 / del 红 / mod 黄）
 *  sequence → 按消息文本定位加 class（M13 保留） */
function applyMermaidAnnotations(target: HTMLElement, mermaidList: MermaidNodeDiff[]) {
  for (const d of mermaidList) {
    const svg = target.querySelector(
      '.mermaid svg, svg[data-processed], .preview svg, .mmd-zoomable svg'
    ) as HTMLElement | null
    if (!svg) continue
    if (d.type === 'sequence') {
      if (!d.messages?.length) continue
      for (const msg of d.messages) {
        const el = [...svg.querySelectorAll('text, tspan, div')].find((e) =>
          (e.textContent || '').includes(msg.text)
        )
        if (el) el.classList.add(msg.kind === 'add' ? 'diff-seq-add' : 'diff-seq-mod')
      }
      continue
    }
    if (d.type !== 'flowchart' && d.type !== 'state') continue
    const prefix = d.type === 'flowchart' ? 'flowchart' : 'state'
    // 变更节点：新增绿 / 删除红 / 修改黄
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
    for (const m of d.mod) apply(m.id, 'diff-node-mod')
  }
}

/** M14：嵌入块源文件有未提交改动 → 卡片右上角「内容有改动」角标（场景 A 角标方案） */
async function annotateEmbedDiffBadges(target: HTMLElement) {
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
    if (card.querySelector('.ref-embed-diff-badge')) return
    const p = card.querySelector('.ref-file-block-path')?.textContent?.trim() ?? ''
    if (!p) return
    if (changed.some((sp) => sp === p || sp.endsWith('/' + p))) {
      const b = document.createElement('span')
      b.className = 'ref-embed-diff-badge'
      b.textContent = '内容有改动'
      b.title = `源文件 ${p} 有未提交改动`
      card.appendChild(b)
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
      void annotateEmbedDiffBadges(target)
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
