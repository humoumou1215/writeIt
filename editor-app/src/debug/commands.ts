// ============================================================
// debug/commands.ts —— 调试命令实现（薄封装现有探针/钩子）
//   分类：
//     A 侦查（只读、高频）
//     B 操作（action.run，走应用语义层）
//     C 逃生舱（exec：页面上下文任意 JS）
//   只准 import 现成导出；不得在业务模块里反向 import 本模块。
// ============================================================
import { settings } from '../state/settings'
import { state } from '../state/store'
import { editorViewCtx } from '@milkdown/kit/core'
import {
  getActiveTabMarkdown,
  getTabMarkdownByPath,
  saveActiveTab,
  openTab,
  activateTab,
  closeTab,
  toggleSourceMode,
} from '../editor/manager'
import { gitBackendKind } from '../git'
import { registerCommand } from './registry'
import { eventsSince, lastSeq } from './events'
import { consoleTail } from './console-ring'
import { inspectDocStore, registryDiagCompat, docContent } from '../editor/docstore/bridge'
import { getBrokenPaths } from '../editor/ref/app-plugin'
import { collectDomSnapshot } from '../diagnostics/probes'
import { collectEditorProbe } from '../diagnostics/probes'
import { getMonitorSnapshot } from '../diagnostics/monitor'
import { logEntries, bootAt } from '../diagnostics/logger'

// ---------- A. 侦查 ----------

registerCommand('app.info', () => ({
  version: __APP_VERSION__,
  buildTime: __BUILD_TIME__,
  fsBackend: state.fsName,
  rootName: state.rootName,
  liteMode: settings.liteMode,
  uptimeSec: Math.round((Date.now() - bootAt) / 1000),
  tabs: state.tabs.length,
  gitBackend: gitBackendKind(),
}))

registerCommand('tabs.list', () =>
  state.tabs.map((t) => ({
    id: t.id,
    path: t.path,
    name: t.name,
    viewMode: t.viewMode,
    dirty: t.dirty,
    kind: t.kind,
    active: t.id === state.activeTabId,
  }))
)

registerCommand('doc.markdown', async (args) => {
  const path = typeof args.path === 'string' ? args.path : null
  if (!path) return getActiveTabMarkdown()
  return getTabMarkdownByPath(path)
})

registerCommand('doc.selection', () => {
  // 通过 manager 的调试钩子取当前编辑器；source 模式无 PM 选区
  const ed = (window as unknown as { __editorDebug?: () => unknown }).__editorDebug?.()
  if (!ed) return { kind: 'none', reason: 'no-wysiwyg-editor' }
  const out = (ed as { action?: (cb: (ctx: { get: (k: unknown) => unknown }) => unknown) => unknown }).action?.((ctx: { get: (k: unknown) => unknown }) => {
    const view = ctx.get(editorViewCtx) as {
      state: {
        selection: {
          from: number
          to: number
          empty: boolean
          $from: { pos: number }
          $to: { pos: number }
        }
      }
      coordsAtPos: (p: number) => { top: number; left: number }
    }
    const sel = view.state.selection
    return {
      from: sel.from,
      to: sel.to,
      empty: sel.empty,
      startPos: sel.$from.pos,
      endPos: sel.$to.pos,
      rect: { top: view.coordsAtPos(sel.from).top, left: view.coordsAtPos(sel.from).left },
    }
  })
  return out ?? { kind: 'none' }
})

// M4：registry 已下线——refs.registry 保留为兼容输出（deprecated，由 docstore.inspect 接管，spec §6.3）
registerCommand('refs.registry', () => ({
  deprecated: true,
  replacement: 'docstore.inspect',
  ...JSON.parse(JSON.stringify(registryDiagCompat())),
}))

// M1：运行态文档层快照（spec §9.2）——模型/rev/脏态/订阅者基线；影子一致性取证据
registerCommand('docstore.inspect', () => inspectDocStore())

// M4：canonical md 导出（spec §6.3）——未加载文件也可查询，且保证与模型一致（含未保存编辑）
registerCommand('docstore.doc', async (args) => {
  const path = typeof args.path === 'string' ? args.path : null
  if (!path) throw new Error('docstore.doc requires args.path')
  const out = await docContent(path)
  if (!out) return { error: `no model/disk content for ${path}` }
  return out
})

registerCommand('refs.broken', () => getBrokenPaths())

registerCommand('dom.snapshot', () => collectDomSnapshot())

registerCommand('editor.probe', () => collectEditorProbe())

registerCommand('perf.monitor', () => getMonitorSnapshot())

registerCommand('git.status', () => ({
  tab: state.gitPanel.tab,
  repo: state.gitPanel.repo,
  branches: state.gitPanel.branches,
  status: state.gitPanel.status,
  log: state.gitPanel.log,
  selectedCommit: state.gitPanel.selectedCommit,
  range: state.gitPanel.range,
  loading: state.gitPanel.loading,
  error: state.gitPanel.error,
  version: state.gitPanel.version,
  aheadBehind: state.gitPanel.aheadBehind,
  hasRemote: state.gitPanel.hasRemote,
}))

registerCommand('logs.tail', (args) => {
  const n = Math.min(Math.max(1, Math.floor((args.n as number) ?? 50) || 50), 2000)
  return logEntries.slice(-n)
})

registerCommand('console.tail', (args) => {
  const n = typeof args.n === 'number' ? args.n : 50
  return consoleTail(n)
})

registerCommand('events.since', (args) => {
  const n = typeof args.seq === 'number' ? args.seq : 0
  return { last: lastSeq(), events: eventsSince(n) }
})

registerCommand('screenshot', async () => {
  // html2canvas 依赖已有（导出功能用）。返回 PNG dataURL（CLI 落盘，Pi 走 read 读图）
  const html2canvas = (await import('html2canvas')).default
  // 现代 CSS color() 函数 html2canvas 解析不了（如 crepe 标题色 color(srgb…))——
  // 先把含 color( 的计算色改写为浏览器已解析的 rgb() 内联值，拍完还原
  const restoreColor = sanitizeColorFunctions(document.body)
  try {
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      backgroundColor: getComputedStyle(document.documentElement).backgroundColor || '#fff',
      scale: Math.min(window.devicePixelRatio || 1, 2),
      logging: false,
    })
    return canvas.toDataURL('image/png')
  } finally {
    restoreColor()
  }
})

/** 伪元素防御时检查的着色属性（html2canvas 会把伪元素内容克隆成普通元素再解析） */
const PSEUDO_COLOR_PROPS = [
  'color',
  'backgroundColor',
  'backgroundImage',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'textDecorationColor',
  '-webkit-text-stroke-color',
  'boxShadow',
  'textShadow',
] as const

/** 现代 CSS 色函数：浏览器把 oklch()/color-mix() 等计算为 color(srgb…)，html2canvas 的 tokenizer 不认 */
const MODERN_COLOR_FN_RE = /(?:color|oklch|oklab|lab|lch|color-mix|light-dark|device-cmyk)\(/i
/** 匹配一整段现代色函数（容忍一层嵌套括号） */
const MODERN_COLOR_FN_MATCH_RE = /(?:color|oklch|oklab|lab|lch|color-mix|light-dark|device-cmyk)\((?:[^()]|\([^()]*\))*\)/gi

/** 把元素计算样式里含现代色函数的色值改写为 rgb() 内联（html2canvas 兼容）；返回还原函数 */
// ---------------- 现代色函数 → rgb() 解析 ----------------
// 背景：Chrome 把 oklch()/color-mix() 等计算值序列化为 color(srgb …)，html2canvas 1.4.1
// 的 tokenizer 不认。且 getComputedStyle(probe).color 会**原样返回** color()（不转 rgb()），
// 所以不能靠探针换：用 canvas 2D 直接渲染色（浏览器原生支持 color()/oklch()/lab() 等，Chrome 111+）。

/** 1×1 离屏 canvas（惰性创建；同源空白画布 getImageData 无污染问题） */
let colorCtx: CanvasRenderingContext2D | null = null

/** 解析单个现代色函数 → 'rgb(r,g,b)' / 'rgba(r,g,b,a)'；失败返回原串。 */
function resolveModernColorFn(fn: string): string {
  if (!colorCtx) {
    try {
      const c = document.createElement('canvas')
      c.width = 1
      c.height = 1
      colorCtx = c.getContext('2d', { willReadFrequently: true })
    } catch {
      colorCtx = null
    }
  }
  const ctx = colorCtx
  if (!ctx) return fn
  let trial = fn
  for (let i = 0; i < 2; i++) {
    try {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = trial
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      const a = d[3]
      if (a === 255) return `rgb(${d[0]}, ${d[1]}, ${d[2]})`
      const af = (a / 255).toFixed(4).replace(/\.?0+$/, '')
      return `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${af || '0'})`
    } catch {
      // 计算值里可能残留 none 关键字，canvas 不认 → 归零重试
      trial = trial.replace(/\bnone\b/g, '0')
    }
  }
  return fn
}

function sanitizeColorFunctions(root: HTMLElement): () => void {
  /** 还原动作：移除内联样式 / 移除临时属性 / 移除注入的 <style> */
  const restores: Array<() => void> = []
  const rewriteOne = (el: HTMLElement, prop: string, v: string): void => {
    const resolved = v.replace(MODERN_COLOR_FN_MATCH_RE, resolveModernColorFn)
    if (resolved === v) return
    try {
      el.style.setProperty(prop, resolved, 'important')
      restores.push(() => el.style.removeProperty(prop))
    } catch {
      /* 个别属性不可内联设置则跳过 */
    }
  }
  const pseudoRules: string[] = []
  let pseudoSeq = 0
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    const cs = getComputedStyle(el)
    // ① 全量计算属性重写：不只名单里的直接色/阴影/渐变，还包括逻辑边框颜色、
    //    CSS 变量（如 crepe diff 的 --crepe-color-diff-*）与简写——html2canvas 的
    //    DocumentCloner 会把 element 的计算样式整份拷成克隆内联再解析，任何含
    //    color() 的属性都可能触发 unsupported color function。
    for (const prop of cs) {
      const v = cs.getPropertyValue(prop)
      if (!v || !MODERN_COLOR_FN_RE.test(v)) continue
      rewriteOne(el, prop, v)
    }
    // ② 伪元素防御：html2canvas 会把有 content 的 ::before/::after 克隆成真实元素解析，
    //    它的内联样式由伪元素计算值拷贝而来——用唯一属性选择器 + !important 覆盖。
    for (const pseudo of ['::before', '::after', '::marker'] as const) {
      const ps = getComputedStyle(el, pseudo)
      let patched = false
      for (const prop of PSEUDO_COLOR_PROPS) {
        const v = ps.getPropertyValue(prop)
        if (!v || !MODERN_COLOR_FN_RE.test(v)) continue
        const resolved = v.replace(MODERN_COLOR_FN_MATCH_RE, resolveModernColorFn)
        if (resolved === v) continue
        if (!patched) {
          patched = true
          pseudoSeq += 1
          const attr = `data-h2c-p${pseudoSeq}`
          el.setAttribute(attr, '')
          restores.push(() => el.removeAttribute(attr))
        }
        pseudoRules.push(`[data-h2c-p${pseudoSeq}]${pseudo}{${prop}:${resolved}!important}`)
      }
    }
  }
  if (pseudoRules.length) {
    const styleEl = document.createElement('style')
    styleEl.textContent = pseudoRules.join('\n')
    root.appendChild(styleEl)
    restores.push(() => styleEl.remove())
  }
  return () => {
    for (const r of restores) r()
  }
}

registerCommand('mockfs.state', () => {
  const f = (window as unknown as { __mockFsDebug?: () => unknown }).__mockFsDebug
  if (typeof f !== 'function') return { error: 'mock fs not active' }
  return f()
})

// ---------- B. 操作（应用语义层） ----------

registerCommand('action.run', async (args) => {
  const action = args.action as string
  switch (action) {
    case 'save':
      return { ok: await saveActiveTab() }
    case 'open': {
      const path = typeof args.path === 'string' ? args.path : null
      if (!path) throw new Error('action.open requires args.path')
      await openTab(path)
      return { ok: true }
    }
    case 'activate': {
      const tabId = args.tabId as string
      if (!tabId) throw new Error('action.activate requires args.tabId')
      activateTab(tabId)
      return { ok: true }
    }
    case 'viewMode': {
      const mode = args.mode as string
      if (!['wysiwyg', 'source', 'diff'].includes(mode)) throw new Error(`bad viewMode: ${mode}`)
      const tabId = (args.tabId as string) ?? state.activeTabId
      if (!tabId) throw new Error('no active tab')
      await toggleSourceMode(tabId)
      return { ok: true, mode }
    }
    case 'closeTab': {
      const tabId = (args.tabId as string) ?? state.activeTabId
      if (!tabId) throw new Error('no active tab')
      await closeTab(tabId)
      return { ok: true }
    }
    default:
      throw new Error(`unknown action: ${action}`)
  }
})

// ---------- C. 逃生舱 ----------

registerCommand('exec', (args) => {
  // lan 模式且设置禁用 → 拒绝（防内网任意 JS 执行）
  if (settings.debugServer === 'lan' && settings.debugLanExecDisabled) {
    throw new Error('exec 已禁用：lan 模式强制关闭任意 JS 逃生舱（可在设置中关闭该限制）')
  }
  const js = typeof args.js === 'string' ? args.js : ''
  if (!js.trim()) throw new Error('exec requires args.js')
  // eslint-disable-next-line no-new-func
  let v: unknown
  try {
    // 表达式语义（eval）：exec "1+1" → 2
    v = new Function(`"use strict"; return (${js})`)()
  } catch {
    // 语句块语义：exec "const a=1; console.log(a)"
    v = new Function(`"use strict"; ${js}`)()
  }
  // 尽力 JSON 化；失败转 String
  try {
    return JSON.parse(JSON.stringify(v, (_k, val) => {
      if (typeof val === 'function') return `[Function ${val.name}]`
      if (val instanceof HTMLElement) return `[Element ${val.tagName.toLowerCase()}#${val.id}]`
      if (typeof val === 'bigint') return val.toString()
      return val
    }))
  } catch {
    return String(v)
  }
})