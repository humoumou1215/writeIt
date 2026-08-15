// Mermaid 引用能力（复用 ref 菜单共享内核 core.ts，不重复实现）：
//  1. CodeMirror @ / [[ 联想：mermaid 代码块内输入触发词 → RefMenu.vue 三级菜单
//     （数据源/树缓存/实体加载/导航状态机全部来自 core + refConfigCtx）
//  2. 渲染文本链接化：foreignObject 内 [[path#frag]] 文本 → <a class="mmd-text-ref">（去 [[ ]] 显示路径）
//  3. 点击委托：a.mmd-text-ref 与旧内容 a[xlink|href^="[["] → 打开回调（app 装配层注册）
import { ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { createApp, type App } from 'vue'
import RefMenu from './ref/menu/RefMenu.vue'
import {
  createRefMenuState,
  matchTrigger,
  normalizeTriggers,
  loadTree,
  loadEntitiesForPath,
  enterDir,
  goUp,
  openEntities,
  closeEntities,
  type RefMenuState,
  type RefMode,
} from './ref/menu/core'
import type { RefConfig } from './ref/config'
import { closeLightbox } from './mermaid-zoom'

// ---------- 全局桥：数据源与打开回调由 app 装配层（manager）注册 ----------
let refCfg: RefConfig | null = null
let openHandler: ((path: string, fragment: string | null) => void) | null = null

export function registerMermaidRefDeps(
  cfg: RefConfig,
  open: (path: string, fragment: string | null) => void
): void {
  refCfg = cfg
  openHandler = open
}

// ---------- 渲染文本链接化 ----------

const REF_RE = /\[\[([^\]\n]+?)\]\]/g
const PLACEHOLDER_RE = /\bmmdref(\d+)\b/g

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function makeRefAnchor(ref: string): string {
  const display = ref.trim().replace(/＃/g, '#') // 全角 # 还原（sequence 转义产物）
  return `<a class="mmd-text-ref" data-ref="${escapeHtml(display)}" title="打开 ${display}">${escapeHtml(display)}</a>`
}

/** SVG <text> 内链接化：用 <tspan>（SVG 文本容器，DOMPurify 保留 class/data-*）
 *  覆盖 sequenceDiagram 消息等非 foreignObject 文本；占位符（外部 fallback）同还原。 */
function linkifyTextBlock(block: string, refs: string[]): string {
  const repl = (_m: string, ref: string) => {
    const display = ref.trim().replace(/＃/g, '#')
    if (!display) return _m
    const esc = escapeHtml(display)
    return `<tspan class="mmd-text-ref" data-ref="${esc}">${esc}</tspan>`
  }
  if (refs.length) {
    block = block.replace(PLACEHOLDER_RE, (_m, idx: string) => {
      const ref = refs[Number(idx)]
      return ref?.trim() ? repl(_m, ref) : _m
    })
  }
  return block.replace(REF_RE, repl)
}

/**
 * 渲染前预处理：把节点 label 里「未加引号」的内联 [[path#frag]] 换成 mermaid 可解析的
 * 占位符 mmdref<n>。mermaid 语法限制：label 中裸 [[ 会被解析为子程序节点形状 → parse error
 * （实测仅整 label 加引号可行，部分加引号也不行）。
 * 前置字符是 [A-Za-z0-9_] 时视为子程序节点形状（A[[x]]，mermaid 原生支持），不替换。
 * 返回 { src: 替换后源码, refs: 按序收集的原始引用 }，供渲染后 linkify 还原成 <a>。
 */
export function prepareMermaidRefs(src: string): { src: string; refs: string[] } {
  const refs: string[] = []
  const out = src.replace(/\[\[([^\]\n]+?)\]\]/g, (m, ref: string, offset: number) => {
    const prev = offset > 0 ? src[offset - 1] : ''
    if (/[A-Za-z0-9_]/.test(prev)) return m // 子程序节点形状 A[[x]]，跳过
    refs.push(ref.trim())
    return `mmdref${refs.length - 1}`
  })
  return { src: out, refs }
}

/** 把 foreignObject 内 HTML 文本中的 [[path#frag]] 与 mmdref<n> 占位符替换为可点击 <a>（去 [[ ]] 显示路径）。
 *  refs 为 prepareMermaidRefs 收集的引用（未加引号 → 占位符路径）；引号已开的 [[..]] 走 REF_RE。
 *  只处理 foreignObject 块——xlink:href 属性（click 指令）不在此列，不会误替换。
 *  M9：SVG <text>（sequenceDiagram 消息等）同样链接化，用 <tspan>。 */
export function linkifyMermaidRefs(svg: string, refs: string[] = []): string {
  return svg
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, (fo) => {
      if (refs.length) {
        fo = fo.replace(PLACEHOLDER_RE, (_m, idx: string) => {
          const ref = refs[Number(idx)]
          return ref?.trim() ? makeRefAnchor(ref) : _m
        })
      }
      return fo.replace(REF_RE, (_m, ref: string) => {
        const display = ref.trim()
        if (!display) return _m
        return makeRefAnchor(display)
      })
    })
    .replace(/<text[^>]*>[\s\S]*?<\/text>/g, (t) => linkifyTextBlock(t, refs))
}

/** 渲染前转义：mermaid sequenceDiagram 消息文本会丢弃 # 及其后内容
 *  （[[path#frag]] 的 # 段丢失）→ 把 [[ ]] 内的半角 # 转全角 ＃（渲染完整保留），
 *  linkify 时还原为半角。对 graph 等无影响（foreignObject 保留 #，转义后同样还原）。 */
export function escapeRefHash(mermaidSource: string): string {
  return mermaidSource.replace(/\[\[([^\]\n]*?)#([^\]\n]*?)\]\]/g, '[[$1＃$2]]')
}

// ---------- 引用解析 ----------

export function parseRefHref(ref: string): { path: string; fragment: string | null } {
  const i = ref.indexOf('#')
  if (i < 0) return { path: ref, fragment: null }
  return { path: ref.slice(0, i), fragment: ref.slice(i + 1) }
}

// ---------- 点击委托（document capture；多标签/多代码块共享一份） ----------

function onDocClick(e: MouseEvent) {
  const t = e.target
  if (!(t instanceof Element)) return
  // 文字级链接（渲染链接化的 <a> / <tspan>）
  const refEl = t.closest('a.mmd-text-ref, tspan.mmd-text-ref')
  if (refEl) {
    const ref = refEl.getAttribute('data-ref')
    if (ref) {
      e.preventDefault()
      e.stopPropagation()
      closeLightbox()
      const { path, fragment } = parseRefHref(ref)
      openHandler?.(path, fragment)
    }
    return
  }
  // 节点级链接（旧内容防御：click A "[[...]]" 生成的 xlink:href，点击默认会导航到相对 URL）
  const a = t.closest('a[xlink\\:href], a[href]')
  if (a) {
    const href = a.getAttribute('xlink:href') ?? a.getAttribute('href') ?? ''
    const m = /^\[\[(.+?)\]\]$/.exec(href.trim())
    if (m) {
      e.preventDefault()
      e.stopPropagation()
      closeLightbox()
      const { path, fragment } = parseRefHref(m[1])
      openHandler?.(path, fragment)
    }
  }
}

document.addEventListener('click', onDocClick, true)

// ---------- CodeMirror 联想扩展 ----------

export const mermaidRefMenuExtension = ViewPlugin.fromClass(
  class MermaidRefMenu {
    readonly dom: HTMLDivElement
    readonly app: App
    readonly state: RefMenuState
    private recentTyped = ''
    private visible = false

    constructor(readonly view: import('@codemirror/view').EditorView) {
      this.state = createRefMenuState()
      this.dom = document.createElement('div')
      // 与正文菜单同款容器：.milkdown-slash-menu（crepe 主题样式：背景/圆角/阴影/li hover）
      // + data-refMenu 同正文；data-mermaid-ref 供测试/调试精确区分（不影响样式）
      this.dom.classList.add('milkdown-slash-menu')
      this.dom.dataset.refMenu = 'true'
      this.dom.dataset.mermaidRef = 'true'
      this.dom.dataset.show = 'false'
      // 挂 body + fixed 定位（正文由 SlashProvider 处理；mermaid 手动 fixed，覆盖主题的 absolute）
      this.dom.style.position = 'fixed'
      this.dom.style.zIndex = '10'
      // 先挂 body；首次 show 时 ensureHost() 移入 .milkdown 容器（block-edit.css 的
      // 菜单样式嵌套在 .milkdown 选择器下；constructor 时 cm DOM 尚未挂载，closest 拿不到）
      document.body.appendChild(this.dom)
      this.app = createApp(RefMenu, {
        menu: this.adapter,
        state: this.state,
        hideModeSelector: true,
      })
      this.app.mount(this.dom)
    }

    destroy() {
      this.hide()
      this.app.unmount()
      this.dom.remove()
    }

    update(update: ViewUpdate) {
      // 语言识别：仅 mermaid 代码块启用（语言按钮文本；无语言显示 Text）
      const lang = this.detectLanguage()
      if (lang !== 'mermaid') {
        if (this.visible) this.hide()
        return
      }
      if (!update.docChanged && !update.selectionSet) return
      this.trackInput(update)
      this.checkTrigger()
    }

    /** 语言按钮：<button class="language-button">mermaid</button> */
    private detectLanguage(): string {
      const block = this.view.dom.closest('.milkdown-code-block')
      const btn = block?.querySelector('.language-button')
      return btn?.textContent?.trim() ?? ''
    }

    /** 跟踪最近键入（复用正文 #trackInput 语义：验证触发词是刚输入的） */
    private trackInput(update: ViewUpdate) {
      if (!update.docChanged) return
      let typed = ''
      update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const ins = inserted.toString()
        if (ins) typed += ins // 含全选替换（deleteRange+insert）——插入内容即最近键入
        else if (toA - fromA > 0) this.recentTyped = this.recentTyped.slice(0, -1)
      })
      if (typed) this.recentTyped = (this.recentTyped + typed).slice(-24)
    }

    /** 光标前文本触发检测（复用 core.matchTrigger；仅 link 模式） */
    private checkTrigger() {
      const view = this.view
      const sel = view.state.selection.main
      if (!sel.empty) {
        if (this.visible) this.hide()
        return
      }
      const before = view.state.doc.sliceString(0, sel.from)
      const lineStart = before.lastIndexOf('\n') + 1
      const lineText = before.slice(lineStart)
      const m = matchTrigger(lineText)
      if (!m || m.mode !== 'link') {
        if (this.visible) this.hide()
        return
      }
      // 触发词必须是刚输入的（同正文 shouldShow 校验）
      const recentNorm = normalizeTriggers(this.recentTyped)
      if (m.query) {
        if (!recentNorm.includes(m.query)) return
      } else if (m.kind === '[[') {
        if (!recentNorm.includes('[[')) return
      }
      this.state.triggerKind = m.kind
      this.state.query = m.query
      this.state.triggerFrom = lineStart + m.start
      this.state.triggerTo = sel.from
      this.show()
    }

    private show() {
      this.visible = true
      this.state.visible = true
      this.ensureHost() // 移入 .milkdown 容器（主题样式作用域）
      this.dom.dataset.show = 'true' // 主题 CSS：display:block
      if (refCfg) {
        void loadTree(refCfg, this.state).then(() => this.reposition())
      } else {
        this.reposition()
      }
    }

    /** 确保浮层挂在 .milkdown 内（constructor 时 cm 未挂载；显示时已就位） */
    private ensureHost() {
      if (this.dom.parentElement?.classList.contains('milkdown')) return
      const host = this.view.dom.closest('.milkdown') ?? document.body
      if (this.dom.parentElement !== host) host.appendChild(this.dom)
    }

    private hide() {
      if (!this.visible) return
      this.visible = false
      this.state.visible = false
      closeEntities(this.state)
      this.state.query = ''
      this.state.currentDir = ''
      this.state.triggerKind = null
      this.state.selectedPath = null
      this.state.entities = []
      this.dom.dataset.show = 'false' // 主题 CSS：display:none
    }

    private reposition() {
      const view = this.view
      const from = view.state.selection.main.from
      const coords = view.coordsAtPos(from)
      if (!coords) return
      const anchor = {
        getBoundingClientRect: () => ({
          x: coords.left,
          y: coords.bottom,
          top: coords.bottom,
          bottom: coords.bottom,
          left: coords.left,
          right: coords.left + 1,
          width: 1,
          height: 1,
        }),
      }
      computePosition(anchor, this.dom, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [flip({ padding: 8 }), shift({ padding: 8 }), offset(8)],
      })
        .then(({ x, y }) => {
          this.dom.style.left = `${x}px`
          this.dom.style.top = `${y}px`
        })
        .catch(() => undefined)
    }

    /** 插入引用文本（删除触发词 → 插入 [[path#frag]]；节点文本自动补引号保证 mermaid 可解析） */
    private insertText(text: string) {
      const view = this.view
      const { triggerFrom, triggerTo } = this.state
      const changes: Array<{ from: number; to: number; insert: string }> = []
      let quoteShift = 0
      // 节点文本未引号包裹 → 补一对引号（mermaid 节点文本含 [[ 必须引号包裹）
      const range = this.nodeQuoteRange()
      if (range && range.needQuote) {
        changes.push({ from: range.l + 1, to: range.l + 1, insert: '"' })
        changes.push({ from: range.r, to: range.r, insert: '"' })
        quoteShift = 1 // 左引号位于触发词之前 → 插入点后移 1
      }
      changes.push({ from: triggerFrom, to: triggerTo, insert: text })
      view.dispatch({
        changes,
        selection: EditorSelection.cursor(triggerFrom + text.length + quoteShift),
        scrollIntoView: true,
      })
    }

    /** 光标所在 mermaid 节点/边标签边界：优先节点左括号 [ / {（排除 [[ 的第二位），
     *  其次边标签 |...|。节点文本未以引号开头 → needQuote（插入 [[ 前自动补引号包裹）。 */
    private nodeQuoteRange(): { l: number; r: number; needQuote: boolean } | null {
      const view = this.view
      const line = view.state.doc.lineAt(this.state.triggerTo)
      const text = view.state.doc.sliceString(line.from, line.to)
      const cursor = this.state.triggerTo - line.from
      // 1) 节点 [ / {（排除 [[ 的第二个 [——联想触发词自身）
      let L = -1
      for (let i = cursor - 1; i >= 0; i--) {
        const ch = text[i]
        if (ch === '[' || ch === '{') {
          if (ch === '[' && i > 0 && text[i - 1] === '[') continue
          L = i
          break
        }
      }
      if (L >= 0) {
        const closeCh = text[L] === '{' ? '}' : ']'
        const R = text.indexOf(closeCh, L + 1)
        if (R >= 0) {
          const alreadyQuoted = text[L + 1] === '"'
          return { l: line.from + L, r: line.from + R, needQuote: !alreadyQuoted }
        }
      }
      // 2) 边标签 |...|（光标前最近未闭合 |，配对其后的 |）
      let P = -1
      for (let i = cursor - 1; i >= 0; i--) {
        if (text[i] === '|') {
          P = i
          break
        }
      }
      if (P >= 0) {
        const R2 = text.indexOf('|', P + 1)
        if (R2 >= 0) {
          const alreadyQuoted = text[P + 1] === '"'
          return { l: line.from + P, r: line.from + R2, needQuote: !alreadyQuoted }
        }
      }
      return null
    }

    /** 删除文档中的过滤词（保留触发词）——导航（进目录/实体级）后文档干净，
     *  避免 checkTrigger 从残留文本重新提取 query 跳回过滤态（回不到第一级目录）。 */
    private deleteQueryText() {
      const kindLen = this.state.triggerKind?.length ?? 0
      if (this.state.query && this.state.triggerTo > this.state.triggerFrom + kindLen) {
        this.view.dispatch({
          changes: [{ from: this.state.triggerFrom + kindLen, to: this.state.triggerTo, insert: '' }],
          scrollIntoView: true,
        })
        this.state.triggerTo = this.state.triggerFrom + kindLen
      }
    }

    // ---------- RefMenu.vue 回调适配（与正文 RefMenuView 同接口） ----------
    private adapter = {
      select: (path: string, _mode?: RefMode) => {
        this.insertText(`[[${path}]]`)
        this.hide()
      },
      selectFile: async (path: string, mode: RefMode) => {
        // mermaid 文本里无 embed 语义：非 link 模式直接按链接插入
        if (mode !== 'link') {
          this.deleteQueryText()
          this.insertText(`[[${path}]]`)
          this.hide()
          return
        }
        try {
          // 无 parser：仅静态 suggest 对象（mermaid 无 markdown 解析上下文）
          const res = refCfg ? await loadEntitiesForPath(refCfg, path) : null
          if (res) {
            this.deleteQueryText() // 进入实体级前清文档过滤词
            openEntities(this.state, path, res.entities)
            return
          }
        } catch {
          /* 回落 */
        }
        this.deleteQueryText()
        this.insertText(`[[${path}]]`)
        this.hide()
      },
      selectEntity: (entityId: string, kind: 'file' | 'object' | 'heading') => {
        const path = this.state.selectedPath
        if (!path) return
        if (kind === 'file') {
          this.insertText(`[[${path}]]`)
        } else {
          const ent = this.state.entities.find((e) => e.id === entityId)
          const frag = ent?.fragment ?? entityId
          this.insertText(frag ? `[[${path}#${frag}]]` : `[[${path}]]`)
        }
        this.hide()
      },
      setMode: (mode: RefMode) => {
        this.state.mode = mode
      },
      hide: () => this.hide(),
      enterDir: (dir: string) => {
        // 进入目录前删文档过滤词（保留触发词）——否则后续输入/光标移动会
        // 从残留文本重新提取 query 跳回过滤态（回不到第一级目录）
        this.deleteQueryText()
        enterDir(this.state, dir)
      },
      goUp: () => goUp(this.state),
      /** ← / Backspace 返回：树模式返回上级目录；过滤模式删除过滤词回树——正文 #back 同语义，适配 CodeMirror doc */
      back: () => {
        const q = this.state.query
        const kindLen = this.state.triggerKind?.length ?? 0
        if (q && this.state.triggerTo > this.state.triggerFrom + kindLen) {
          this.view.dispatch({
            changes: [
              { from: this.state.triggerFrom + kindLen, to: this.state.triggerTo, insert: '' },
            ],
            scrollIntoView: true,
          })
          return
        }
        goUp(this.state)
      },
      closeEntities: () => closeEntities(this.state),
      hasFocus: () => this.view.hasFocus,
    }
  }
)
