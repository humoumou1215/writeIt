// M2：@ / [[ / ![[ 触发菜单
// 基于 slashFactory + SlashProvider（crepe 斜杠菜单同款范式）：
//   自定义 shouldShow 检测触发词与边界 → 浮出迷你文件树 → 选择后按模式插入节点
// 插入的是节点而非文本（slash 命令同款 transaction 建节点），块嵌入自动劈分段落
import type { Ctx } from '@milkdown/kit/ctx'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node } from '@milkdown/kit/prose/model'
import { SlashProvider, slashFactory } from '@milkdown/kit/plugin/slash'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { TextSelection, type EditorState, type PluginView } from '@milkdown/kit/prose/state'
import { editorCtx } from '@milkdown/kit/core'
import { createApp, reactive, type App } from 'vue'

import { fs } from '../../../fs'
import type { FsEntry } from '../../../fs/types'
import { materializeBlock } from '../resolve'
import { refreshBrokenState } from '../app-plugin'
import { templateService } from '../../../template/service'
import type { SuggestObject } from '../../../template/types'
import RefMenu from './RefMenu.vue'

export const refMenu = slashFactory('REF_MENU')

export type RefMode = 'link' | 'embed' | 'embed-ro'

export interface RefMenuState {
  visible: boolean
  mode: RefMode
  query: string
  tree: FsEntry[]
  /** 触发文本在文档中的范围（删除用） */
  triggerFrom: number
  triggerTo: number
  /** 文件树导航：当前所在目录（'' = 根） */
  currentDir: string
  /** 第二级：选中文件（有 suggest 时进入实体级） */
  selectedPath: string | null
  /** 第二级：模板对象列表（M4 suggest 服务填充） */
  entities: { id: string; label: string }[]
  /** 最近键入的字符（验证触发词是刚输入的，避免段落里旧 [[ 误触发） */
  recentTyped: string
  /** 当前触发词类型（仅触发词变化时重置模式，不覆盖用户手动选择） */
  triggerKind: '@' | '[[' | '![[' | null
  /** 替换模式：非空时 select 替换该位置上的节点（断链重选） */
  replacePos: number | null
  /** 替换模式的输入起点（光标位置，用于计算过滤词与替换范围） */
  replaceStart: number
  /** 被替换的旧引用路径（按路径重查节点，避免位置漂移） */
  replacePath: string | null
}

;(window as unknown as { __refMenuState?: unknown }).__refMenuState = null
export const refMenuState = reactive<RefMenuState>({
  visible: false,
  mode: 'link',
  query: '',
  tree: [],
  triggerFrom: 0,
  triggerTo: 0,
  currentDir: '',
  selectedPath: null,
  entities: [],
  recentTyped: '',
  triggerKind: null,
  replacePos: null,
  replaceStart: 0,
  replacePath: null,
})
;(window as unknown as { __refMenuState?: unknown }).__refMenuState = refMenuState

// ---------- 触发检测 ----------

interface TriggerMatch {
  mode: RefMode
  query: string
  /** 触发词类型（用于验证最近键入） */
  kind: '@' | '[[' | '![[' | null
  /** 触发词在文本中的起始偏移（@ 指向 @ 本身，[[ 指向第一个 [） */
  start: number
}

function matchTrigger(text: string): TriggerMatch | null {
  // 收集全部候选触发词，取「终点离光标最近」者（同终点取更长更具体的触发词）。
  // 这样段落里更早的旧 [[ 不会抢占新输入的 @ / [[（触发词后不能有 ] = 已完成引用）。
  const cands: TriggerMatch[] = []
  const embedIdx = text.lastIndexOf('![[')
  if (embedIdx >= 0 && !text.slice(embedIdx + 3).includes(']')) {
    cands.push({ mode: 'embed', query: text.slice(embedIdx + 3), start: embedIdx, kind: '![[' })
  }
  const linkIdx = text.lastIndexOf('[[')
  if (linkIdx >= 0 && !text.slice(linkIdx + 2).includes(']')) {
    cands.push({ mode: 'link', query: text.slice(linkIdx + 2), start: linkIdx, kind: '[[' })
  }
  // @（边界感知：块首或前一字符为空白）
  const at = /(?:^|\s)@([^\s]*)$/.exec(text)
  if (at) {
    const atStart = text.length - at[1].length - 1
    cands.push({ mode: 'link', query: at[1], start: atStart, kind: '@' })
  }
  if (!cands.length) return null
  const end = (t: TriggerMatch) => t.start + (t.kind?.length ?? 0)
  cands.sort((a, b) => end(b) - end(a) || (b.kind?.length ?? 0) - (a.kind?.length ?? 0))
  return cands[0]
}

function getTextBeforeCursor(view: EditorView): string | null {
  const { selection } = view.state
  if (!(selection instanceof TextSelection) || !selection.empty) return null
  const $from = selection.$from
  const node = $from.parent
  if (!node.isTextblock) return null
  return node.textBetween(0, $from.parentOffset, '\n', '\ufffc')
}

// ---------- 插入 ----------

function insertFileRef(view: EditorView, path: string, triggerFrom: number, triggerTo: number) {
  const schema = view.state.schema
  const tr = view.state.tr
  tr.delete(triggerFrom, triggerTo)
  const node = schema.nodes.file_ref.create({ path })
  tr.insert(triggerFrom, node)
  // 光标放到节点之后
  const pos = tr.doc.resolve(triggerFrom + node.nodeSize)
  tr.setSelection(TextSelection.near(pos))
  view.dispatch(tr)
}

function insertFileBlock(
  view: EditorView,
  editor: import('@milkdown/kit/core').Editor,
  path: string,
  readonly: boolean,
  triggerFrom: number,
  triggerTo: number
) {
  const schema = view.state.schema
  const tr = view.state.tr
  tr.delete(triggerFrom, triggerTo)
  const pos = triggerFrom
  const block: Node = schema.nodes.file_block.create({ path, readonly })
  const $pos = tr.doc.resolve(pos)
  const parent = $pos.parent

  if (parent.isTextblock && parent.content.size > 0) {
    // 段落非空 → 劈分，块插入两段之间
    tr.split(pos)
    tr.insert(pos, block)
  } else if (parent.isTextblock) {
    // 空段落 → 整段替换为块
    tr.replaceWith($pos.before(), $pos.after(), block)
  } else {
    tr.insert(pos, block)
  }
  view.dispatch(tr)

  // 新插入的块立即物化（异步，容错）
  void materializeBlock(editor, pos, path, readonly)
}

/** 插入 object_ref（[[path#object]]，resolvedText 待 resolve 阶段填充） */
function insertObjectRef(
  view: EditorView,
  path: string,
  object: string,
  triggerFrom: number,
  triggerTo: number
) {
  const schema = view.state.schema
  const tr = view.state.tr
  tr.delete(triggerFrom, triggerTo)
  const node = schema.nodes.object_ref.create({ path, object, resolvedText: null })
  tr.insert(triggerFrom, node)
  const pos = tr.doc.resolve(triggerFrom + node.nodeSize)
  tr.setSelection(TextSelection.near(pos))
  view.dispatch(tr)
}

// ---------- 菜单视图 ----------

export function configureRefMenu(ctx: Ctx) {
  const editor = ctx.get(editorCtx)
  ctx.set(refMenu.key, {
    props: {
      // 吞掉导航键交给菜单组件；字符输入放行（进入文档 → shouldShow 更新过滤词）
      handleKeyDown: (_view, event) => {
        if (!refMenuState.visible) return false
        // 替换模式：吞掉全部按键，只走树导航（避免输入污染文档与位置漂移）
        if (refMenuState.replacePos != null) return true
        if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Tab'].includes(event.key)) {
          return true
        }
        // 树模式（无过滤词）下 Backspace 用于返回上级目录
        if (event.key === 'Backspace' && !refMenuState.query) return true
        return false
      },
    },
    view: (view: EditorView) => new RefMenuView(ctx, view, editor),
  })
}

/** 断链重选：找到指定路径的引用节点 → 选中它并打开替换菜单 */
export async function openReplaceMenu(
  editor: import('@milkdown/kit/core').Editor,
  path: string
): Promise<void> {
  const { editorViewCtx } = await import('@milkdown/kit/core')
  const { TextSelection } = await import('@milkdown/kit/prose/state')
  const pos = editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let found = -1
    view.state.doc.descendants((n, p) => {
      if (
        (n.type.name === 'file_ref' || n.type.name === 'file_block') &&
        n.attrs.path === path
      ) {
        found = p
        return false
      }
      return true
    })
    return found
  })
  if (pos < 0) return
  // 设置替换状态，再派发选区事务 → 触发该编辑器的 provider 自行显示
  refMenuState.replacePos = pos
  refMenuState.replaceStart = pos
  refMenuState.replacePath = path
  refMenuState.query = ''
  refMenuState.currentDir = ''
  refMenuState.visible = false
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos)))
    )
  })
}

class RefMenuView implements PluginView {
  readonly #content: HTMLElement
  readonly #app: App
  readonly #slashProvider: SlashProvider
  readonly #editor: import('@milkdown/kit/core').Editor
  #view: EditorView

  constructor(ctx: Ctx, view: EditorView, editor: import('@milkdown/kit/core').Editor) {
    this.#view = view
    this.#editor = editor
    const content = document.createElement('div')
    content.classList.add('milkdown-slash-menu')
    content.dataset.refMenu = 'true'
    // SlashProvider 用 floating-ui 设置 left/top，元素必须是绝对定位（否则落在文档流底部）
    content.style.position = 'absolute'
    content.style.zIndex = '10'

    // 跟踪实际插入的文本（IME 组合 / 粘贴均覆盖），用于验证触发词是刚输入的
    view.dom.addEventListener('beforeinput', this.#trackInput)

    const app = createApp(RefMenu, { ctx, state: refMenuState, menu: this })
    this.#app = app
    app.mount(content)
    this.#content = content

    this.#slashProvider = new SlashProvider({
      content: this.#content,
      debounce: 20,
      // fixed 定位：滚动容器（.editor-pane）与 offsetParent（.milkdown）不一致时
      // absolute 坐标会错乱（菜单不跟随光标）；fixed 直接视口定位。
      // flip/shift：内容常驻渲染后尺寸真实，溢出时翻转到上方/避让边缘。
      floatingUIOptions: {
        strategy: 'fixed',
        middleware: [flip({ padding: 8 }), shift({ padding: 8 }), offset(8)],
      },
      shouldShow(this: SlashProvider, v: EditorView) {
        // 替换模式（断链重选）：query 取 replaceStart 到光标的文档文本（兼容 IME 组合输入）
        if (refMenuState.replacePos != null) {
          const sel = v.state.selection
          if (sel instanceof TextSelection && sel.from >= refMenuState.replaceStart) {
            refMenuState.query = v.state.doc.textBetween(refMenuState.replaceStart, sel.from)
          }
          return true
        }
        const text = getTextBeforeCursor(v)
        if (text == null) return false
        // 光标必须在块文本末尾（触发词为最后输入）
        const sel = v.state.selection
        if (
          sel instanceof TextSelection &&
          sel.$from.parentOffset !== sel.$from.parent.content.size
        ) {
          return false
        }
        const m = matchTrigger(text)
        if (!m) return false
        // 触发词必须是刚输入的（query 在最近键入窗口内；空 query 要求触发字符也在窗口内）
        if (m.query) {
          if (!refMenuState.recentTyped.includes(m.query)) return false
        } else if (m.kind === '![[') {
          if (!refMenuState.recentTyped.includes('![')) return false
        } else if (m.kind === '[[') {
          if (!refMenuState.recentTyped.includes('[[')) return false
        }
        // 触发词变化（如 [[ → ![[ 或新开菜单）才重置模式；用户手动切换后保持
        if (refMenuState.triggerKind !== m.kind) {
          refMenuState.mode = m.mode
          refMenuState.triggerKind = m.kind
        }
        refMenuState.query = m.query
        refMenuState.triggerFrom = sel.from - (text.length - m.start)
        refMenuState.triggerTo = sel.from
        perfMark('trigger')
        return true
      },
      offset: 8,
    })

    this.#slashProvider.onShow = () => {
      perfMark('show')
      refMenuState.visible = true
      // 树加载后手动重新定位（flip 用真实高度测量溢出）。
      // 不走 provider.update() —— 那会再次触发 show → onShow 形成递归循环
      void loadTree().then(() => {
        perfMark('treeDone')
        this.#reposition()
      })
    }
    this.#slashProvider.onHide = () => {
      refMenuState.visible = false
      refMenuState.query = ''
      refMenuState.currentDir = ''
      refMenuState.selectedPath = null
      refMenuState.entities = []
      refMenuState.recentTyped = ''
      refMenuState.triggerKind = null
      refMenuState.replacePos = null
      refMenuState.replaceStart = 0
      refMenuState.replacePath = null
    }
    this.update(view)
  }

  /** 手动重定位：与 SlashProvider 相同的 fixed+flip 策略，基于光标坐标 */
  #reposition = () => {
    const view = this.#view
    const sel = view.state.selection
    const from = Math.min(sel.from, sel.to)
    const to = Math.max(sel.from, sel.to)
    const start = view.coordsAtPos(from)
    const end = view.coordsAtPos(to, -1)
    const rect = {
      x: start.left,
      y: start.top,
      top: start.top,
      bottom: end.bottom,
      left: start.left,
      right: end.right,
      width: end.right - start.left,
      height: end.bottom - start.top,
    }
    computePosition(
      { getBoundingClientRect: () => rect },
      this.#content,
      {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [flip({ padding: 8 }), shift({ padding: 8 }), offset(8)],
      }
    )
      .then(({ x, y }) => {
        Object.assign(this.#content.style, { left: `${x}px`, top: `${y}px` })
        perfMark('reposDone')
        perfFlush('menu-open')
      })
      .catch(() => undefined)
  }

  #trackInput = (e: Event) => {
    const ie = e as InputEvent
    const t = ie.inputType
    if (t === 'insertText' || t === 'insertCompositionText' || t === 'insertFromPaste') {
      refMenuState.recentTyped = (refMenuState.recentTyped + (ie.data ?? '')).slice(-24)
    } else if (t === 'deleteContentBackward' || t === 'deleteContentBackwardLine') {
      refMenuState.recentTyped = refMenuState.recentTyped.slice(0, -1)
    } else if (
      t === 'insertLineBreak' ||
      t === 'insertParagraph' ||
      t === 'deleteWordBackward' ||
      t === 'deleteContentForward'
    ) {
      refMenuState.recentTyped = ''
    }
  }

  update = (view: EditorView, prevState?: EditorState) => {
    this.#view = view
    this.#slashProvider.update(view, prevState)
  }

  hide = () => {
    this.#slashProvider.hide()
  }

  destroy = () => {
    this.#view.dom.removeEventListener('beforeinput', this.#trackInput)
    this.#slashProvider.destroy()
    this.#app.unmount()
    this.#content.remove()
  }

  // 菜单选择回调（由 Vue 组件触发；mode 来自模式选择器）
  select = (path: string, mode?: RefMode) => {
    const { triggerFrom, triggerTo, replacePos } = refMenuState
    const m = mode ?? refMenuState.mode
    if (replacePos != null) {
      // 替换模式：删除 [输入起点, 节点末尾)，插入新节点
      this.replaceNode(path, m)
      this.hide()
      return
    }
    if (m === 'link') {
      insertFileRef(this.#view, path, triggerFrom, triggerTo)
    } else {
      insertFileBlock(this.#view, this.#editor, path, m === 'embed-ro', triggerFrom, triggerTo)
    }
    this.hide()
    void refreshBrokenState(this.#editor)
  }

  /**
   * M4：选中文件 → 检查目标 doctype + suggest；命中则进入实体级，否则按普通文件插入
   * （异步检查，容错：失败回落为普通插入）
   */
  selectFile = async (path: string, mode: RefMode) => {
    try {
      const objs = await templateService.loadSuggestForFile(path)
      if (objs && objs.length) {
        this.openEntities(path, objs)
        return
      }
    } catch {
      /* 回落为普通插入 */
    }
    this.select(path, mode)
  }

  /** 选择实体（第二级）：插入 [[path#object]] 并触发 resolve 定型 */
  selectEntity = (objectId: string) => {
    const path = refMenuState.selectedPath
    if (!path) return
    const { triggerFrom, triggerTo, replacePos } = refMenuState
    if (replacePos != null) {
      // 替换模式：按 replacePath 重查节点替换（v1 实体替换按链接模式处理）
      this.replaceNode(path, 'link')
      this.hide()
      return
    }
    insertObjectRef(this.#view, path, objectId, triggerFrom, triggerTo)
    this.hide()
    // 触发 resolve 阶段填充 resolvedText
    void import('../resolve').then((m) => m.resolveRefs(this.#editor))
  }

  /** 替换模式：按 replacePath 重查节点并替换（避免位置漂移） */
  replaceNode = (path: string, mode: RefMode) => {
    const schema = this.#view.state.schema
    const oldPath = refMenuState.replacePath
    let from = -1
    let to = -1
    this.#view.state.doc.descendants((node, pos) => {
      if (
        (node.type.name === 'file_ref' || node.type.name === 'file_block') &&
        node.attrs.path === oldPath
      ) {
        from = pos
        to = pos + node.nodeSize
        return false
      }
      return true
    })
    if (from < 0) return
    const tr = this.#view.state.tr
    if (mode === 'link') {
      tr.replaceWith(from, to, schema.nodes.file_ref.create({ path }))
    } else {
      tr.replaceWith(
        from,
        to,
        schema.nodes.file_block.create({ path, readonly: mode === 'embed-ro' })
      )
    }
    this.#view.dispatch(tr)
    if (mode !== 'link') {
      void materializeBlock(this.#editor, from, path, mode === 'embed-ro')
    }
  }

  /** 替换模式：显示菜单（由 manager 的断链重选调用） */
  showReplace = () => {
    this.#slashProvider.show()
    void loadTree()
  }

  /** 本菜单所属编辑器是否持有焦点（多标签时只有活动编辑器处理键盘） */
  hasFocus = () => this.#view.hasFocus()

  setMode = (mode: RefMode) => {
    refMenuState.mode = mode
  }

  /** 目录导航：进入目录 */
  enterDir = (dir: string) => {
    refMenuState.currentDir = dir
    refMenuState.query = ''
  }

  /** 返回上级目录 */
  goUp = () => {
    refMenuState.currentDir = refMenuState.currentDir.includes('/')
      ? refMenuState.currentDir.slice(0, refMenuState.currentDir.lastIndexOf('/'))
      : ''
  }

  /** 进入实体级（M4 suggest 服务填充） */
  openEntities = (path: string, objects: SuggestObject[]) => {
    refMenuState.selectedPath = path
    refMenuState.entities = objects.map((o) => ({ id: o.id, label: o.label }))
  }

  /** 返回文件级 */
  closeEntities = () => {
    refMenuState.selectedPath = null
    refMenuState.entities = []
  }
}

// ---------- 性能锚点（issue 4）----------
// window.__refMenuPerf 收集每次菜单打开的耗时分布；debug 模式下输出到 console
let perfMarks: Array<[string, number]> = []
function perfMark(name: string, ms?: number) {
  perfMarks.push([name, ms ?? performance.now()])
}
const PERF_DEBUG = true
function perfFlush(label: string) {
  if (!PERF_DEBUG && !(window as unknown as { __refMenuPerf?: unknown }).__refMenuPerf) return
  const t0 = perfMarks[0]?.[1] ?? 0
  const parts = perfMarks.map(([n, t]) => `${n}:${t - t0 >= 0 ? Math.round(t - t0) : Math.round(t)}ms`).join(' ')
  const total = perfMarks.length ? Math.round((perfMarks[perfMarks.length - 1][1] as number) - t0) : 0
  const record = { label, parts, totalMs: total }
  ;(window as unknown as { __refMenuPerf?: unknown[] }).__refMenuPerf = [
    ...(((window as unknown as { __refMenuPerf?: unknown[] }).__refMenuPerf ?? []) as unknown[]),
    record,
  ]
  if (PERF_DEBUG) console.log(`[menu-perf] ${label} → ${parts} | 共 ${total}ms`)
  perfMarks = []
}

// 树缓存：菜单打开不再每次都 readTree（按 app 的 treeVersion 失效）
let menuTreeCache: { version: number; tree: FsEntry[] } | null = null

async function loadTree() {
  try {
    const v = (await import('../../../state/store')).state.treeVersion
    if (menuTreeCache && menuTreeCache.version === v) {
      refMenuState.tree = menuTreeCache.tree
      return
    }
    const t0 = performance.now()
    const tree = await fs.readTree(true)
    perfMark('readTree', performance.now() - t0)
    menuTreeCache = { version: v, tree }
    refMenuState.tree = tree
  } catch {
    refMenuState.tree = []
  }
}
