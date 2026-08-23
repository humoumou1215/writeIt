// ============================================================
// 诊断探针（D2.5 重构：分层采样）—— 针对「渲染/动画/结构」不符合预期的现场取证
// 全部同步采样（秒级），不修改 DOM、不触发副作用。
// 分层：ui（界面几何/面板/动画）· diff（渲染标注节点实测）· editor（文档/引用健康）
//        compat（WebView CSS 兼容性）· render/性能（由 monitor.ts + timeline 提供）
// ============================================================

// -------------------- UI 层：几何 / 面板 / 动画 --------------------

export interface RectInfo {
  x: number
  y: number
  w: number
  h: number
  visible: boolean
}

export interface DomSnapshot {
  editorPane: null | {
    rect: RectInfo
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    /** 是否有内容溢出但无滚动（内容被裁剪的线索） */
    overflowClipped: boolean
  }
  mermaidPreviews: Array<{
    rect: RectInfo
    hasSvg: boolean
    svgWidth: number | null
    dataRefLinks: number
    /** 预览容器内是否有错误占位（渲染失败即注入 ⚠️ div） */
    errorText: boolean
  }>
  panels: {
    sidebarCollapsed: boolean | null
    annotationDrawer: null | { rect: RectInfo } & { collapsed: boolean }
    outlinePanel: null | { rect: RectInfo }
    slashMenuShown: boolean
    floatingMenus: number
    toastCount: number
  }
  animations: Array<{
    name: string | null
    playState: string
    duration: number
    delay: number
    currentTime: number | null
    target: string
  }>
  pref: { prefersReducedMotion: boolean; devicePixelRatio: number; colorScheme: string; forcedColors: boolean }
}

function rectOf(el: Element): RectInfo {
  const r = el.getBoundingClientRect()
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
    visible:
      r.width > 0 &&
      r.height > 0 &&
      getComputedStyle(el).display !== 'none' &&
      getComputedStyle(el).visibility !== 'hidden',
  }
}

function elSummary(el: Element): string {
  if (el instanceof HTMLElement) {
    const cls = el.className && typeof el.className === 'string' ? `.${el.className.split(' ').slice(0, 2).join('.')}` : ''
    return `${el.tagName.toLowerCase()}${cls}`
  }
  return el.tagName.toLowerCase()
}

/** UI 层采样（兼容旧 08-dom-snapshot.json 语义） */
export function collectDomSnapshot(): DomSnapshot {
  const snap: DomSnapshot = {
    editorPane: null,
    mermaidPreviews: [],
    panels: { sidebarCollapsed: null, annotationDrawer: null, outlinePanel: null, slashMenuShown: false, floatingMenus: 0, toastCount: 0 },
    animations: [],
    pref: { prefersReducedMotion: false, devicePixelRatio: window.devicePixelRatio || 1, colorScheme: '', forcedColors: false },
  }

  const pane = document.querySelector<HTMLElement>('.editor-pane')
  if (pane) {
    snap.editorPane = {
      rect: rectOf(pane),
      scrollTop: pane.scrollTop,
      scrollHeight: pane.scrollHeight,
      clientHeight: pane.clientHeight,
      overflowClipped: pane.scrollHeight > pane.clientHeight + 4 && pane.scrollTop === 0,
    }
  }

  // mermaid 预览：仅采真正的图表产物（mmd-zoomable / data-processed / mermaid-svg；.preview 内 <40px 视为图标）
  const mmdEls = [
    ...document.querySelectorAll('.mmd-zoomable svg, svg[data-processed], svg.mermaid-svg'),
    ...[...document.querySelectorAll('.preview svg')].filter((s) => s.getBoundingClientRect().width >= 40),
  ]
    .filter((el, i, arr) => arr.indexOf(el) === i)
    .slice(0, 12)
  for (const svg of mmdEls) {
    const el = svg.closest?.('.mmd-zoomable') ?? (svg.parentElement ?? svg)
    snap.mermaidPreviews.push({
      rect: rectOf(el),
      hasSvg: true,
      svgWidth: svg.getBoundingClientRect().width || null,
      dataRefLinks: el.querySelectorAll('a.mmd-text-ref, tspan.mmd-text-ref').length,
      errorText: /渲染失败|⚠️/.test(el.textContent ?? ''),
    })
  }

  const sidebar = document.querySelector('.sidebar')
  snap.panels.sidebarCollapsed = sidebar?.classList.contains('collapsed') ?? null
  const drawer = document.querySelector<HTMLElement>('.annotation-drawer')
  if (drawer) snap.panels.annotationDrawer = { ...rectOf(drawer), collapsed: drawer.classList.contains('collapsed') }
  const outline = document.querySelector<HTMLElement>('.outline-panel')
  if (outline) snap.panels.outlinePanel = rectOf(outline)
  snap.panels.slashMenuShown = [...document.querySelectorAll('.milkdown-slash-menu, [data-ref-menu]')].some((el) => {
    const shown = el.getAttribute('data-show')
    return shown !== 'false' && el.getClientRects().length > 0
  })
  snap.panels.floatingMenus = document.querySelectorAll('[data-floating], .floating, .milkdown-tooltip, .annotation-connector').length
  snap.panels.toastCount = document.querySelectorAll('.toast').length

  try {
    const anims = (document.getAnimations?.() ?? []) as Animation[]
    snap.animations = anims.slice(0, 30).map((a) => {
      const eff = a.effect as (KeyframeEffect & { getTiming?: () => EffectTiming }) | null
      const timing = eff?.getTiming ? eff.getTiming() : null
      let target = ''
      try {
        const tgt = (eff?.target as Element | null) ?? null
        if (tgt) target = elSummary(tgt)
      } catch {
        /* ignore */
      }
      return {
        name: (a as { animationName?: string }).animationName ?? null,
        playState: a.playState,
        duration: timing?.duration ?? 0,
        delay: timing?.delay ?? 0,
        currentTime: typeof a.currentTime === 'number' ? a.currentTime : null,
        target,
      }
    })
  } catch {
    /* getAnimations 不可用 */
  }

  const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  snap.pref.prefersReducedMotion = mq?.matches ?? false
  snap.pref.colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
  snap.pref.forcedColors = window.matchMedia?.('(forced-colors: active)')?.matches ?? false
  return snap
}

// -------------------- 兼容性层：WebView CSS 能力探测 --------------------

export interface CompatProbe {
  colorMix: 'yes' | 'no' | 'unknown'
  /** computedStyle 支持（= getComputedStyle 现代化） */
  ok: boolean
  /** 受害面：应用样式里 color-mix 的大致用例数（精确到规则位置） */
  colorMixUsages: number
}

/** color-mix() 支持探测：应用 diff.css/图标色大量依赖，旧 WebView 不支持会静默丢失填充色 */
export function detectCompat(): CompatProbe {
  let colorMix: CompatProbe['colorMix'] = 'unknown'
  try {
    const el = document.createElement('div')
    el.style.setProperty('background', 'color-mix(in srgb, red, blue)')
    document.body.appendChild(el)
    const c = getComputedStyle(el).backgroundColor
    el.remove()
    // 支持的引擎会解析为 rgb(r,g,b)；不支持则声明被丢弃 → transparent / rgba(0,0,0,0)
    colorMix = c && c !== 'transparent' && !c.startsWith('rgba(0, 0, 0, 0)') ? 'yes' : 'no'
  } catch {
    colorMix = 'unknown'
  }
  let colorMixUsages = 0
  for (const el of [...document.querySelectorAll('style')]) {
    const matches = (el.textContent ?? '').match(/color-mix\(/g)
    colorMixUsages += matches?.length ?? 0
  }
  return { colorMix, ok: typeof getComputedStyle === 'function', colorMixUsages }
}

// -------------------- Diff 渲染标注层：实测节点颜色/删除线 --------------------

export interface DiffMarkNode {
  kind: 'add' | 'del' | 'mod'
  /** 节点 id（如 xxx-flowchart-C-7） */
  id: string
  label: string
  /** 计算后样式（AI 依据这些判断「真的红了没」） */
  fill: string | null
  stroke: string | null
  color: string | null
  lineThrough: boolean
  /** rect 是否存在（结构完整） */
  hasRect: boolean
}

export interface DiffProbe {
  /** mermaid 节点级标注分布 */
  mermaid: { add: DiffMarkNode[]; del: DiffMarkNode[]; mod: DiffMarkNode[] }
  /** 文本级渲染标注（render-host 的 .diff-ins/.diff-del/.diff-mod 元素数） */
  text: { ins: number; del: number; mod: number }
  /** 判定：del 标注节点中「计算样式确实红(`rgb` 与 #c62828 相近)」的数量 */
  trulyRedDels: number
  trulyGreenAdds: number
  /** 标注节点但颜色未生效（样式层失效 → 少红/少绿） */
  styleFailed: number
}

function sampleNodeColors(g: Element): Pick<DiffMarkNode, 'fill' | 'stroke' | 'color' | 'lineThrough' | 'hasRect'> {
  const rect = g.querySelector('rect, circle, .node-bkg')
  const csR = rect ? getComputedStyle(rect) : null
  const labelEl = g.querySelector('.nodeLabel, .state-label')
  const csL = labelEl ? getComputedStyle(labelEl) : null
  return {
    fill: csR ? csR.fill || null : null,
    stroke: csR ? csR.stroke || null : null,
    color: csL ? csL.color || null : null,
    lineThrough: csL ? csL.textDecorationLine.includes('line-through') : false,
    hasRect: !!rect,
  }
}

/** 判定 computed 色值是否接近某目标色（#c62828 红 / #2e7d32 绿） */
function isNear(color: string | null, target: [number, number, number], tol = 60): boolean {
  if (!color) return false
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  if (!m) return false
  const d = Math.abs(+m[1] - target[0]) + Math.abs(+m[2] - target[1]) + Math.abs(+m[3] - target[2])
  return d <= tol * 3
}

/** Diff 标注层采样：扫描所有渲染上下文中的 diff 标注节点（mermaid 图 + text 标注） */
export function collectDiffProbe(): DiffProbe {
  const add: DiffMarkNode[] = []
  const del: DiffMarkNode[] = []
  const mod: DiffMarkNode[] = []
  const seen = new Set<string>()
  const MAX = 10 // token 控制：每种标注最多采样 10 个

  for (const g of [...document.querySelectorAll('g.diff-node-add, g.diff-node-del, g.diff-node-mod, [class*="diff-node-add"], [class*="diff-node-del"], [class*="diff-node-mod"]')]) {
    const cls = g.getAttribute('class') ?? ''
    const kind = cls.includes('del') ? 'del' : cls.includes('mod') ? 'mod' : 'add'
    const id = g.id || cls
    if (seen.has(id)) continue
    const key = g.id || `${kind}:${(g.textContent ?? '').slice(0, 12)}`
    if (seen.has(`k:${key}`)) continue
    seen.add(`k:${key}`)
    const box = kind === 'del' ? del : kind === 'mod' ? mod : add
    if (box.length >= MAX) continue
    const n: DiffMarkNode = {
      kind,
      id: id.slice(-40),
      label: (g.textContent ?? '').trim().slice(0, 32),
      ...sampleNodeColors(g),
    }
    box.push(n)
  }

  // 文本级 diff 标注（render-host 内）
  const text = {
    ins: document.querySelectorAll('.render-host .diff-ins, .render-host .diff-add, .diff-ins, .diff-add').length,
    del: document.querySelectorAll('.render-host .diff-del, .diff-del').length,
    mod: document.querySelectorAll('.render-host .diff-mod, .diff-mod').length,
  }

  const trulyRedDels = del.filter((d) => isNear(d.stroke, [198, 40, 40])).length
  const trulyGreenAdds = add.filter((d) => isNear(d.stroke, [46, 125, 50])).length
  const styleFailed = [...del, ...add].filter((d) => (d.kind === 'del' ? !isNear(d.stroke, [198, 40, 40]) : !isNear(d.stroke, [46, 125, 50]))).length

  return { mermaid: { add, del, mod }, text, trulyRedDels, trulyGreenAdds, styleFailed }
}

// -------------------- 编辑器/文档健康层 --------------------

export interface EditorProbe {
  /** 活动编辑器文档引用统计（同步扫描 doc） */
  activeDoc: null | {
    nodeSize: number
    childNodes: number
    fileRefs: number
    objectRefs: number
    fileBlocks: number
    annotations: number
    tables: number
  }
  /** 引用健康：断链路径数 */
  brokenRefs: number
  brokenPaths: string[]
  /** 多标签健康：实例数 / 视图分布 / 脏标签 */
  tabs: { count: number; instances: number; byView: Record<string, number>; dirty: number }
}

import { editorViewCtx } from '@milkdown/kit/core'

/** 编辑器/文档健康采样（同步） */
export function collectEditorProbe(): EditorProbe {
  let activeDoc: EditorProbe['activeDoc'] = null
  try {
    const dbg = (window as unknown as { __editorDebug?: unknown }).__editorDebug
    if (typeof dbg === 'function') {
      const editor = dbg() as { action?: (fn: (ctx: { get: (k: unknown) => unknown }) => unknown) => unknown } | null
      if (editor && typeof editor.action === 'function') {
        const res = editor.action((ctx) => {
          const view = ctx.get(editorViewCtx) as { state?: { doc?: { nodeSize: number; childCount: number; descendants(fn: (n: { type: { name: string } }) => void | boolean): void } } } | null
          const doc = view?.state?.doc
          if (!doc) return null
          const counts = { fileRefs: 0, objectRefs: 0, fileBlocks: 0, annotations: 0, tables: 0 }
          doc.descendants((n: { type: { name: string } }) => {
            const t = n.type.name
            if (t === 'file_ref') counts.fileRefs++
            else if (t === 'object_ref') counts.objectRefs++
            else if (t === 'file_block') counts.fileBlocks++
            else if (t === 'annotation') counts.annotations++
            else if (t === 'table') counts.tables++
          })
          return { nodeSize: doc.nodeSize, childNodes: doc.childCount, ...counts }
        })
        if (res) activeDoc = res as EditorProbe['activeDoc']
      }
    } else {
      // 无 editor 钩子（早期启动）——忽略
    }
  } catch {
    /* ignore */
  }

  // 断链：由 index.ts 注入桥（避免 probes→editor 循环依赖）
  const brokenBridge = (window as unknown as { __diagGetBroken?: () => string[] }).__diagGetBroken
  let broken: string[] = []
  if (typeof brokenBridge === 'function') {
    try {
      broken = brokenBridge()
    } catch {
      /* ignore */
    }
  }

  // 多标签健康
  const tabBridge = (window as unknown as { __diagGetTabs?: () => Array<{ viewMode: string; dirty: boolean }> }).__diagGetTabs
  let tabs = { count: 0, instances: 0, byView: {} as Record<string, number>, dirty: 0 }
  if (typeof tabBridge === 'function') {
    try {
      const list = tabBridge()
      tabs.count = list.length
      for (const t of list) {
        tabs.byView[t.viewMode] = (tabs.byView[t.viewMode] ?? 0) + 1
        if (t.dirty) tabs.dirty++
      }
    } catch {
      /* ignore */
    }
  }
  const instBridge = (window as unknown as { __diagGetInstanceCount?: () => number }).__diagGetInstanceCount
  if (typeof instBridge === 'function') {
    try {
      tabs.instances = instBridge()
    } catch {
      /* ignore */
    }
  }

  return { activeDoc, brokenRefs: broken.length, brokenPaths: broken.slice(0, 20), tabs }
}