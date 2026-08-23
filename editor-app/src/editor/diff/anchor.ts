// M18 §4.3 AnchorResolver ——「找屏幕上的锚点」收敛为一处
// 现状 4 份各自为政的实现（prose coordsAtPos / textarea 手工度量 / mermaid getCTM / 字符串匹配）
// 统一为两个接口：连线需要「屏幕 rect」，滚动/点击定位需要「文档位置」。
//
// resolveRect 策略：
//   · prose：coordsAtPos(pos) 为主（行内 Decoration.inline 会被 PM 按 mark 边界拆成多个 span，
//     querySelector 只取第一个片段会得到不完整 rect——data-dnote DOM 只作校验与兜底）
//   · diagram：按 data-fence-id 定位到具体 NodeView DOM 子树，再在其内部按节点 id 找 SVG 元素
//     （主路径 classDef/class 下图中节点已带自有 class，本策略仅在 class 注入失效时作 fallback 定位）
//   · source：源码 textarea 的 <mark data-note> DOM 定位（保留现行为，接口并入）
export interface AnchorRef {
  noteId: string
  kind?: 'word' | 'block' | 'mermaid' | 'table' | 'embed' | 'ref'
  /** diagram 节点定位：NodeView 的 data-fence-id + 节点 id（仅 diagram record 提供） */
  fenceId?: string
  nodeId?: string
}

export interface RectLike {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

/** prose 定位提供者（调用方给 Crepe 的 editorViewCtx/DecorationSet「反查」能力） */
export interface ProseAnchorSource {
  coordsAtPos(pos: number): { left: number; top: number; right: number; bottom: number } | null
  docSize(): number
  /** data-dnote → pos 反查（DecorationSet.find 统一入口；write-once 下 from/to 稳定） */
  posOf(noteId: string): number | null
  domAt(noteId: string): HTMLElement | null
}

export interface AnchorResolver {
  /** id → 文档 pos（滚动/点击定位用） */
  resolvePos(ref: AnchorRef): number | null
  /** id → 屏幕 rect（连线用）；找不到返回 null（连线隐藏） */
  resolveRect(host: HTMLElement, ref: AnchorRef): RectLike | null
}

// ---------- 纯逻辑（可单测） ----------

/** prose rect 主策略：coordsAtPos(pos) → RectLike；data-dnote DOM 校验/兜底 */
export function proseRect(src: ProseAnchorSource, noteId: string, posCand: number | null): RectLike | null {
  const domEl = src.domAt(noteId)
  // 兜底：DOM 命中且宽度非零 → 直接用 DOM rect（覆盖 coordsAtPos 返回 0 宽/浮动定位的少数情况）
  if (domEl) {
    const r = domEl.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      return toRectLike(r)
    }
  }
  const pos = posCand ?? src.posOf(noteId)
  if (pos == null) return null
  const p = Math.min(Math.max(pos, 0), src.docSize())
  const c = src.coordsAtPos(p)
  if (!c) return null
  if (c.right - c.left <= 0 && domEl) return null // coords 退化（隐藏/未渲染）
  return { left: c.left, right: c.right, top: c.top, bottom: c.bottom, width: c.right - c.left, height: c.bottom - c.top }
}

/** diagram rect：data-fence-id scoped 到 NodeView 子树再按节点 id 找 SVG 元素（fallback 定位） */
export function diagramRect(host: HTMLElement, fenceId: string, nodeId: string): RectLike | null {
  const view = host.querySelector(`[data-fence-id="${cssEscape(fenceId)}"]`) as HTMLElement | null
  if (!view) return null
  // 该 NodeView 自己的 SVG 子树内按节点 id 匹配（结构防线：永不会命中同文档其它图）
  const svg = view.querySelector('svg') as SVGSVGElement | null
  if (!svg) return null
  const els = [...svg.querySelectorAll('g.node, g.state, g[class*="node"]')] as HTMLElement[]
  const el = els.find((g) => {
    const gid = g.id || g.getAttribute('data-id') || ''
    return gid === nodeId || gid.endsWith(`-${nodeId}`) || gid.includes(`${nodeId}-`)
  })
  if (el) return toRectLike(el.getBoundingClientRect())
  // 节点没找到（class 注入失效/无节点 DOM）→ 退化到整图 rect（保证连线不悬空）
  const sr = svg.getBoundingClientRect()
  if (sr.width > 0) return toRectLike(sr)
  return null
}

/** source 模式：textarea 内 <mark data-note> DOM 定位（源码 textarea 直接可见时用） */
export function sourceMarkRect(ta: HTMLTextAreaElement, noteId: string): RectLike | null {
  const mark = ta.querySelector(`mark[data-note="${cssEscape(noteId)}"]`) as HTMLElement | null
  if (!mark) return null
  return toRectLike(mark.getBoundingClientRect())
}

function toRectLike(r: { left: number; right: number; top: number; bottom: number; width?: number; height?: number }): RectLike {
  const width = r.width ?? r.right - r.left
  const height = r.height ?? r.bottom - r.top
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width, height }
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s)
  return s.replace(/["\\\]]/g, '\\$&')
}

/** 组装 Resolver（prose 策略为主；diagram 需要 host 内 data-fence-id） */
export function createAnchorResolver(src: ProseAnchorSource): AnchorResolver {
  const cachePos = new Map<string, number | null>()
  return {
    resolvePos(ref) {
      const hit = cachePos.get(ref.noteId)
      if (hit !== undefined) return hit
      const pos = src.posOf(ref.noteId)
      cachePos.set(ref.noteId, pos)
      return pos
    },
    resolveRect(host, ref) {
      if (ref.fenceId && ref.nodeId) return diagramRect(host, ref.fenceId, ref.nodeId)
      return proseRect(src, ref.noteId, src.posOf(ref.noteId))
    },
  }
}