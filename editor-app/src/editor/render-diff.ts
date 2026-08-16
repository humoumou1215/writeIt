// M11c 渲染模式：单栏融合 diff
// 原理：新旧 markdown 各自解析为块序列（轻量扫描）→ LCS 对齐 → 双 readonly Crepe 渲染
//   → 按对齐结果从两 DOM 提取块节点 → 组装进单栏视图（新增绿底/删除红底划线/未变正常）
// 降级链：Crepe 挂载失败或块数不匹配 → 双栏全文渲染（fallback），用户仍可对比 mermaid/嵌入
import { Crepe } from '@milkdown/crepe'
import { refPlugin, refConfigCtx, type RefConfig } from './ref'
import { resolveRefs } from './ref/resolve'
import { registerRefStringify } from './ref/stringify'
import { featureConfigs } from './features'

// ---------- 轻量 markdown 块扫描 ----------

export interface Block {
  type: 'heading' | 'fence' | 'table' | 'list' | 'quote' | 'hr' | 'paragraph'
  start: number
  end: number
  text: string
}

const FENCE_RE = /^```/
const HEADING_RE = /^#{1,6}\s/
const TABLE_RE = /^\s*\|/
const LIST_RE = /^(\s*)([-*+]|\d+\.)\s/
const QUOTE_RE = /^>\s?/

/** 按行扫描 markdown → 块序列（忽略空行；块文本 trim 后比较） */
export function parseBlocks(md: string): Block[] {
  const lines = md.split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trim = line.trim()
    if (!trim) {
      i++
      continue
    }
    let type: Block['type'] = 'paragraph'
    if (/^#{1,6}\s/.test(line)) type = 'heading'
    else if (FENCE_RE.test(trim)) type = 'fence'
    else if (/^\s*\|/.test(line)) type = 'table'
    else if (LIST_RE.test(line)) type = 'list'
    else if (QUOTE_RE.test(line)) type = 'quote'
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(trim)) type = 'hr'
    let j = i
    if (type === 'fence') {
      j++
      while (j < lines.length && !FENCE_RE.test(lines[j].trim())) j++
      j++
    } else if (type === 'table') {
      while (j < lines.length && TABLE_RE.test(lines[j])) j++
    } else if (type === 'list') {
      while (j < lines.length && LIST_RE.test(lines[j])) j++
    } else if (type === 'quote') {
      while (j < lines.length && QUOTE_RE.test(lines[j])) j++
    } else if (type === 'heading') {
      j++
      while (
        j < lines.length &&
        lines[j].trim() &&
        !FENCE_RE.test(lines[j].trim()) &&
        !HEADING_RE.test(lines[j]) &&
        !TABLE_RE.test(lines[j]) &&
        !LIST_RE.test(lines[j]) &&
        !QUOTE_RE.test(lines[j])
      ) {
        j++
      }
    } else {
      // paragraph / hr
      while (
        j < lines.length &&
        lines[j].trim() &&
        !FENCE_RE.test(lines[j].trim()) &&
        !HEADING_RE.test(lines[j]) &&
        !TABLE_RE.test(lines[j]) &&
        !LIST_RE.test(lines[j]) &&
        !QUOTE_RE.test(lines[j])
      ) {
        j++
      }
    }
    const text = lines.slice(i, j).join('\n').trim()
    if (text) blocks.push({ type, start: i, end: j, text })
    i = Math.max(j, i + 1)
  }
  return blocks
}

// ---------- LCS 块对齐 ----------

export type AlignOp =
  | { kind: 'same'; oldIdx: number; newIdx: number }
  | { kind: 'del'; oldIdx: number }
  | { kind: 'add'; newIdx: number }

/** 块序列 LCS 对齐（同 type + 同文本视为相同） */
export function alignBlocks(oldB: Block[], newB: Block[]): AlignOp[] {
  const n = oldB.length
  const m = newB.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldB[i].type === newB[j].type && oldB[i].text === newB[j].text
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: AlignOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldB[i].type === newB[j].type && oldB[i].text === newB[j].text) {
      ops.push({ kind: 'same', oldIdx: i, newIdx: j })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'del', oldIdx: i })
      i++
    } else {
      ops.push({ kind: 'add', newIdx: j })
      j++
    }
  }
  while (i < n) {
    ops.push({ kind: 'del', oldIdx: i })
    i++
  }
  while (j < m) {
    ops.push({ kind: 'add', newIdx: j })
    j++
  }
  return ops
}

// ---------- readonly Crepe 渲染 ----------

function createRenderLayer(): { layer: HTMLDivElement; host: HTMLDivElement } {
  // 隐藏层必须在视口内（IntersectionObserver 懒加载：CodeMirror/mermaid 需要 IO 触发）
  const layer = document.createElement('div')
  layer.style.cssText =
    'position:fixed;inset:0;opacity:0.01;pointer-events:none;z-index:-1;overflow:auto;'
  const host = document.createElement('div')
  host.style.cssText = 'min-height:100%;width:100%;'
  layer.appendChild(host)
  document.body.appendChild(layer)
  return { layer, host }
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
    await crepe.create()
    crepe.setReadonly(true)
    // 物化引用（![[ 嵌入卡片 / [[ chip）——await 保证提取前完成；容错 1.5s 超时
    try {
      await Promise.race([resolveRefs(crepe.editor), new Promise((r) => setTimeout(r, 1500))])
    } catch {
      /* 物化失败不影响渲染 */
    }
    return crepe
  } catch (e) {
    console.warn('[render-diff] Crepe 挂载失败:', e)
    return null
  }
}

/** 等待 mermaid 预览渲染（renderPreview 异步）；最多 waitMs，未完成返回 false */
async function waitForRender(host: HTMLElement, waitMs = 2500): Promise<boolean> {
  const start = Date.now()
  // mermaid 预览 / 嵌入引用物化（resolveRefs 异步）都算就绪
  const ready = () =>
    !!host.querySelector('.mermaid, svg[data-processed], .preview-container, .ref-file-block')
  // 至少等一帧，然后轮询
  await new Promise((r) => setTimeout(r, 200))
  if (ready()) return true
  while (Date.now() - start < waitMs) {
    await new Promise((r) => setTimeout(r, 300))
    if (ready()) return true
  }
  return false
}

function extractBlockEls(prose: HTMLElement): HTMLElement[] {
  return [...prose.children].filter((el) => {
    const cls = (el.className || '').toString()
    // 虚拟光标/gapcursor 不是内容块
    if (cls.includes('prosemirror-virtual-cursor') || cls.includes('gapcursor')) return false
    // 空段落（物化/行尾产生的无内容块）忽略，保持与 parseBlocks 块序一致
    if (
      (el.tagName === 'P' || /^H[1-6]$/.test(el.tagName)) &&
      !(el.textContent || '').trim()
    ) {
      return false
    }
    return ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR', 'DIV', 'LI'].includes(el.tagName)
  }) as HTMLElement[]
}

function cloneEl(el: HTMLElement, cls: string): HTMLElement {
  const clone = el.cloneNode(true) as HTMLElement
  clone.removeAttribute('style')
  clone.className = `${cls} ${clone.className || ''}`.trim()
  return clone
}

// ---------- 单栏融合组装 ----------

function buildMerged(ops: AlignOp[], oldEls: HTMLElement[], newEls: HTMLElement[]): HTMLElement[] {
  const out: HTMLElement[] = []
  let i = 0
  while (i < ops.length) {
    const op = ops[i]
    if (op.kind === 'same') {
      out.push(cloneEl(newEls[op.newIdx] ?? newEls[0], 'rd-block rd-same'))
      i++
    } else {
      // 连续 del 段 + 连续 add 段 → 按顺序配对成修改块（避免 LCS 在连续修改时错配）
      const dels: number[] = []
      const adds: number[] = []
      let j = i
      while (j < ops.length && ops[j].kind === 'del') {
        dels.push(ops[j].oldIdx)
        j++
      }
      while (j < ops.length && ops[j].kind === 'add') {
        adds.push(ops[j].newIdx)
        j++
      }
      const n = Math.min(dels.length, adds.length)
      for (let k = 0; k < n; k++) {
        const wrap = document.createElement('div')
        wrap.className = 'rd-block rd-mod'
        wrap.appendChild(cloneEl(oldEls[dels[k]] ?? oldEls[0], 'rd-side rd-old'))
        wrap.appendChild(cloneEl(newEls[adds[k]] ?? newEls[0], 'rd-side rd-new'))
        out.push(wrap)
      }
      for (let k = n; k < dels.length; k++) {
        out.push(cloneEl(oldEls[dels[k]] ?? oldEls[0], 'rd-block rd-del'))
      }
      for (let k = n; k < adds.length; k++) {
        out.push(cloneEl(newEls[adds[k]] ?? newEls[0], 'rd-block rd-add'))
      }
      i = j
    }
  }
  return out
}

export interface RenderDiffOptions {
  oldMd: string
  newMd: string
  refCfg: RefConfig
  /** 渲染失败/降级回调（返回原因文本） */
  onFallback?: (reason: string) => void
}

export interface RenderDiffHandle {
  /** 销毁渲染层与 Crepe 实例 */
  destroy(): void
}

/** 渲染单栏融合 diff 到 target（清空后追加）。返回句柄（调用方负责 destroy）。 */
export async function renderDiffToContainer(
  target: HTMLElement,
  opts: RenderDiffOptions
): Promise<RenderDiffHandle | null> {
  const { oldMd, newMd, refCfg, onFallback } = opts
  const oldLayer = createRenderLayer()
  const newLayer = createRenderLayer()
  let oldCrepe: Crepe | null = null
  let newCrepe: Crepe | null = null
  let disposed = false

  const cleanup = () => {
    disposed = true
    void oldCrepe?.destroy()
    void newCrepe?.destroy()
    oldLayer.layer.remove()
    newLayer.layer.remove()
  }

  try {
    ;[oldCrepe, newCrepe] = await Promise.all([
      mountRenderCrepe(oldLayer.host, oldMd, refCfg),
      mountRenderCrepe(newLayer.host, newMd, refCfg),
    ])
    if (disposed) {
      cleanup()
      return null
    }
    if (!oldCrepe || !newCrepe) {
      onFallback?.('Crepe 渲染失败，降级为双栏全文对比')
      return { destroy: cleanup }
    }
    // 等 mermaid 渲染（超时不阻塞，未完成块显示 placeholder）
    // 等 mermaid / 嵌入渲染（超时不阻塞，未完成块显示 placeholder）
    await Promise.all([
      waitForRender(oldLayer.host, 2000),
      waitForRender(newLayer.host, 2000),
    ])
    if (disposed) {
      cleanup()
      return null
    }
    const oldProse = oldLayer.host.querySelector('.ProseMirror') as HTMLElement | null
    const newProse = newLayer.host.querySelector('.ProseMirror') as HTMLElement | null
    if (!oldProse || !newProse) {
      onFallback?.('渲染容器异常，降级为双栏全文对比')
      return { destroy: cleanup }
    }
    const oldEls = extractBlockEls(oldProse)
    const newEls = extractBlockEls(newProse)
    const oldBlocks = parseBlocks(oldMd)
    const newBlocks = parseBlocks(newMd)
    console.log('[render-diff] newEls tags:', newEls.map((el) => el.tagName + '.' + String(el.className).slice(0, 30)).join(' | '))
    // 块数校验（忽略空行后应一致；不一致 → 降级双栏）
    if (oldEls.length !== oldBlocks.length || newEls.length !== newBlocks.length) {
      onFallback?.(
        `块对齐异常（旧 ${oldEls.length}/${oldBlocks.length}，新 ${newEls.length}/${newBlocks.length}），降级为双栏全文对比`
      )
      return { destroy: cleanup }
    }
    const ops = alignBlocks(oldBlocks, newBlocks)
    const merged = buildMerged(ops, oldEls, newEls)
    const frag = document.createDocumentFragment()
    for (const el of merged) frag.appendChild(el)
    target.textContent = ''
    target.appendChild(frag)
    return { destroy: cleanup }
  } catch (e) {
    console.warn('[render-diff] 渲染异常:', e)
    onFallback?.('渲染异常，降级为双栏全文对比')
    cleanup()
    return null
  }
}

/** 双栏全文对比（降级）：旧 | 新 各自渲染全文 */
export async function renderSplitFallback(
  target: HTMLElement,
  opts: RenderDiffOptions
): Promise<RenderDiffHandle | null> {
  const { oldMd, newMd, refCfg } = opts
  const oldLayer = createRenderLayer()
  const newLayer = createRenderLayer()
  let oldCrepe: Crepe | null = null
  let newCrepe: Crepe | null = null
  let disposed = false
  const cleanup = () => {
    disposed = true
    void oldCrepe?.destroy()
    void newCrepe?.destroy()
    oldLayer.layer.remove()
    newLayer.layer.remove()
  }
  try {
    ;[oldCrepe, newCrepe] = await Promise.all([
      mountRenderCrepe(oldLayer.host, oldMd, refCfg),
      mountRenderCrepe(newLayer.host, newMd, refCfg),
    ])
    if (disposed) {
      cleanup()
      return null
    }
    await Promise.all([
      waitForRender(oldLayer.host, 2000),
      waitForRender(newLayer.host, 2000),
    ])
    const oldProse = oldLayer.host.querySelector('.ProseMirror') as HTMLElement | null
    const newProse = newLayer.host.querySelector('.ProseMirror') as HTMLElement | null
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
