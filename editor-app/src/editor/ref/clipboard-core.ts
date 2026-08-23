// 剪贴板·文件引用粘贴 + 编辑器右键菜单（共享内核）
// 复制来源两种（行为一致）：
//   ① 应用内文件树「复制」→ 写内部剪贴板 + 系统剪贴板自定义 MIME application/x-writeit-node
//   ② 系统文件管理器复制 → 粘贴时读 text/uri-list（file:// URL）
// 粘贴行为：
//   Ctrl+V 默认粘贴为链接引用 [[path]]；右键菜单可选 块嵌入 ![[path]] / 只读嵌入 ![[path|ro]]
//   目录 → 粘贴路径纯文本（不作为引用）；多文件 → 分段插入，每段一个引用
// 右键菜单：替代编辑器默认 contextmenu —— 剪贴板粘贴组 + 常规编辑 + 引用操作/类型切换
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import { Fragment, type Node } from '@milkdown/kit/prose/model'
import { shallowReactive } from 'vue'
import { baseName } from '../../fs/types'
import type { RefMode } from './menu/core'
import { resolveRefs } from './resolve'
import { refreshBrokenState } from './app-plugin'
import { diagEvent } from '../../diagnostics/logger'

/** 应用内复制使用的自定义剪贴板 MIME（内容 = CopiedNode[] 的 JSON） */
export const WRITEIT_NODE_MIME = 'application/x-writeit-node'

export interface CopiedNode {
  kind: 'file' | 'dir'
  path: string
}

// ---------- 内部剪贴板（应用内复制的兜底通道：navigator.clipboard.write 失败/受限时仍可粘贴） ----------

let internalClip: CopiedNode[] | null = null

export function setInternalClip(items: CopiedNode[] | null): void {
  internalClip = items
}

export function getInternalClip(): CopiedNode[] | null {
  return internalClip
}

/**
 * 全局 copy/cut 失效监听：用户复制了别的内容（剪贴板不再是我们写入的自定义 MIME）→
 * 内部剪贴板失效，避免陈旧文件引用误粘贴。document 捕获阶段，一次注册全局生效。
 */
let watchInstalled = false
export function installClipboardWatch(): void {
  if (watchInstalled || typeof document === 'undefined') return
  watchInstalled = true
  const invalidate = (e: ClipboardEvent) => {
    const types = e.clipboardData?.types
    if (!types || !Array.from(types).includes(WRITEIT_NODE_MIME)) {
      internalClip = null
    }
  }
  document.addEventListener('copy', invalidate, true)
  document.addEventListener('cut', invalidate, true)
}

// ---------- 系统剪贴板 file:// URL → 引用路径 ----------

/** file:// URL 或本地路径 → 文件系统绝对路径（Windows /C:/ 前缀归一） */
export function fileUriToAbsolute(uri: string): string | null {
  let abs: string
  try {
    const url = new URL(uri)
    if (url.protocol !== 'file:') return null
    abs = decodeURIComponent(url.pathname)
  } catch {
    // 非 URL（mock 调试可直接塞本地路径）：仅接受看上去像绝对路径的
    if (!uri.includes('://')) {
      abs = uri
    } else {
      return null
    }
  }
  // Windows: /C:/Users/... → C:/Users/...
  if (/^\/[A-Za-z]:\//.test(abs)) abs = abs.slice(1)
  return abs || null
}

/** text/uri-list > 文件路径列表（拒绝非 file: 协议项；空返回 null） */
export function parseFileUriList(raw: string): string[] {
  const out: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const abs = fileUriToAbsolute(t)
    if (abs) out.push(abs)
  }
  return out.length ? out : []
}

// ---------- 插入引用（核心：Ctrl+V / 右键菜单共用） ----------

export interface InsertItems {
  /** 粘贴为链接 `[[path]]` 的文件（已解析为工作区相对路径）；目录不会出现在这里 */
  files: string[]
  /** 剪贴板中的目录路径（粘贴为纯文本，不作为引用） */
  dirs: string[]
}

/**
 * 在光标处插入引用。
 *  - 单文件 + link：inline 插入当前光标（与 / 菜单选择行为一致）
 *  - 多文件 / 块模式：分段插入（每段一个引用）；目录路径以纯文本段落插入
 *  - 块模式插入后触发物化 resolveRefs；链接模式刷新断链状态
 */
export function insertRefs(
  view: EditorView,
  editor: Editor,
  items: InsertItems,
  mode: RefMode
): void {
  const { files, dirs } = items
  const dirTexts = dirs

  // D2.5b：引用插入埋点（粘贴/右键菜单来源；哪个文件、什么模式、几个）
  diagEvent('editor:ref-insert', {
    target: files[0] ?? dirs[0],
    data: { mode, files: files.length, dirs: dirs.length },
  })

  if (!files.length) {
    // 只有目录：粘贴路径文本（纯文本，不进文档结构）
    const text = dirTexts.join('\n')
    if (text) view.dispatch(view.state.tr.insertText(text).scrollIntoView())
    return
  }

  // 单文件 + 链接模式 + 无目录 → inline 插入（保持原「菜单选择」行为）
  if (files.length === 1 && dirTexts.length === 0 && mode === 'link') {
    insertFileRefInline(view, files[0])
  } else {
    insertRefsSegmented(view, editor, files, dirTexts, mode)
  }
  // 断链状态统一刷新（新插入的引用路径存在性检查；segmented 内已刷，重复无害）
  void refreshBrokenState(editor)
}

/** inline 插入一个 file_ref（替换当前选区） */
function insertFileRefInline(view: EditorView, path: string): void {
  const schema = view.state.schema
  const { from, to } = view.state.selection
  const tr = view.state.tr
  tr.replaceWith(from, to, schema.nodes.file_ref.create({ path, fragment: null }))
  const node = schema.nodes.file_ref.create({ path, fragment: null })
  const pos = tr.doc.resolve(from + node.nodeSize)
  tr.setSelection(TextSelection.near(pos))
  view.dispatch(tr)
}

/** 多文件 / 块模式：分段插入（每段一个引用），当前段落自动劈分；光标落到最后一个引用之后 */
function insertRefsSegmented(
  view: EditorView,
  editor: Editor,
  files: string[],
  dirs: string[],
  mode: RefMode
): void {
  const schema = view.state.schema
  const nodes: Node[] = []
  for (const p of files) {
    if (mode === 'link') {
      nodes.push(
        schema.nodes.paragraph.create(null, schema.nodes.file_ref.create({ path: p, fragment: null }))
      )
    } else {
      nodes.push(
        // 创建即带默认段落：file_block content:'block+' 不允空块（空块被事务触碰抛 RangeError）
        schema.nodes.file_block.create({ path: p, readonly: mode === 'embed-ro' }, schema.nodes.paragraph.create())
      )
    }
  }
  // 目录 → 纯文本段落（不影响引用结构）
  for (const d of dirs) {
    nodes.push(schema.nodes.paragraph.create(null, schema.text(d)))
  }

  const from = view.state.selection.from
  const $from = view.state.doc.resolve(from)
  const parent = $from.parent
  const tr = view.state.tr
  const fragment = Fragment.from(nodes)

  if (parent.isTextblock && parent.content.size > 0) {
    // 段落非空 → 劈分，引用段落插入两段之间
    tr.split(from)
    tr.insert(from, fragment)
  } else if (parent.isTextblock) {
    // 空段落 → 整段替换
    tr.replaceWith($from.before(), $from.after(), fragment)
  } else {
    tr.insert(from, fragment)
  }
  // 光标放到最后一个节点之后（回退到最近可编辑位置）
  const after = tr.doc.resolve(Math.min(tr.doc.content.size, from + fragment.size + 1))
  const endPos = Math.max(0, after.pos - 1)
  try {
    tr.setSelection(TextSelection.near(tr.doc.resolve(endPos)))
  } catch {
    /* 极端情况忽略 */
  }
  view.dispatch(tr)

  void resolveRefs(editor)
  void refreshBrokenState(editor)
}

// ---------- 引用类型切换（右键菜单） ----------

export type RefTargetType = 'file_ref' | 'file_block' | 'object_ref'

/**
 * 把光标附近的引用节点切换为目标类型（path 不变）。
 *  - file_ref   → file_block（可编辑/只读）：替换节点，物化内容
 *  - file_block → file_ref：替换节点（丢弃物化内容）
 *  - file_block 可编辑 ⇄ 只读：setNodeMarkup 保留内容
 *  - object_ref 不参与切换（保留模板对象引用语义）
 */
export function convertRefMode(
  view: EditorView,
  editor: Editor,
  pos: number,
  mode: RefMode
): boolean {
  const doc = view.state.doc
  const node = doc.nodeAt(pos)
  if (!node) return false
  const schema = view.state.schema
  const tr = view.state.tr

  if (node.type.name === 'file_ref') {
    if (mode === 'link') return false
    tr.replaceWith(
      pos,
      pos + node.nodeSize,
      schema.nodes.file_block.create({ path: node.attrs.path, readonly: mode === 'embed-ro' }, schema.nodes.paragraph.create())
    )
  } else if (node.type.name === 'file_block') {
    const attrs = node.attrs as { path: string; readonly: boolean }
    if (mode === 'embed') {
      if (!attrs.readonly) return false
      tr.setNodeMarkup(pos, undefined, { ...attrs, readonly: false })
    } else if (mode === 'embed-ro') {
      if (attrs.readonly) return false
      tr.setNodeMarkup(pos, undefined, { ...attrs, readonly: true })
    } else {
      tr.replaceWith(
        pos,
        pos + node.nodeSize,
        schema.nodes.file_ref.create({ path: attrs.path, fragment: null })
      )
    }
  } else {
    return false
  }

  view.dispatch(tr)
  if (mode !== 'link') void resolveRefs(editor)
  void refreshBrokenState(editor)
  return true
}

/** 在文档中找到包含 pos 的引用节点（右键定位用） */
export function findRefAtPos(
  view: EditorView,
  pos: number
): { type: RefTargetType; path: string; readonly: boolean; from: number; node: Node } | null {
  let hit: { type: RefTargetType; path: string; readonly: boolean; from: number; node: Node } | null = null
  view.state.doc.descendants((node, from) => {
    const name = node.type.name
    if (name === 'file_ref' || name === 'object_ref' || name === 'file_block') {
      const to = from + node.nodeSize
      if (pos >= from && pos <= to) {
        hit = {
          type: name,
          path: String(node.attrs.path ?? ''),
          readonly: Boolean(node.attrs.readonly),
          from,
          node,
        }
        return false
      }
    }
    return true
  })
  return hit
}

// ---------- 编辑器右键菜单状态（替代默认 contextmenu） ----------

export interface EditorMenuTarget {
  type: RefTargetType
  path: string
  readonly: boolean
  pos: number
}

export interface EditorMenuState {
  visible: boolean
  x: number
  y: number
  /** 右键所在的编辑器实例（动作执行目标；菜单打开时快照） */
  editor: Editor | null
  view: EditorView | null
  cfg: import('./config').RefConfig | null
  /** 右键命中的引用节点（普通位置为 null） */
  target: EditorMenuTarget | null
  /** 打开菜单时剪贴板里的文件引用快照 */
  clip: InsertItems | null
  /** 剪贴板是否有纯文本内容（「粘贴」是否可用） */
  hasText: boolean
  hasSelection: boolean
}

export const editorMenuState = shallowReactive<EditorMenuState>({
  visible: false,
  x: 0,
  y: 0,
  editor: null,
  view: null,
  cfg: null,
  target: null,
  clip: null,
  hasText: false,
  hasSelection: false,
})

/** 关闭菜单（点击外部 / 执行动作后） */
export function closeEditorMenu(): void {
  editorMenuState.visible = false
  editorMenuState.target = null
}

// ---------- 右键菜单动作（组件点击后执行） ----------

/** 粘贴为引用（三种模式共用；items 取菜单打开时的剪贴板快照） */
export function menuPasteRef(mode: RefMode): void {
  const { view, editor, clip } = editorMenuState
  if (!view || !editor || !clip) return
  insertRefs(view, editor, clip, mode)
  closeEditorMenu()
  view.focus()
}

/** 普通粘贴（剪贴板文本 → 走 ProseMirror 原生粘贴逻辑） */
export function menuPasteText(): void {
  const { view } = editorMenuState
  if (!view) return
  closeEditorMenu()
  view.focus()
  // 用户手势内调 execCommand('paste')：Chromium/WebView2 允许，触发编辑器自身 paste 管线。
  // 剪贴板若为文件引用 → 流转到我们的 paste 钩子，仍以引用粘贴（与 Ctrl+V 一致）。
  try {
    document.execCommand('paste')
  } catch {
    /* 个别环境拒绝，用户仍可用 Ctrl+V */
  }
}

/** 复制选中内容（PM serializeForClipboard → 系统剪贴板 HTML + 文本） */
export async function menuCopySelection(): Promise<void> {
  const { view } = editorMenuState
  if (!view) return
  try {
    const slice = view.state.selection.content()
    const { dom, text } = view.serializeForClipboard(slice)
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([dom.innerHTML], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ])
  } catch {
    /* copy 尽力而为 */
  }
  closeEditorMenu()
}

/** 剪切 = 复制 + 删除选区（PM copySelection 语义精简版） */
export async function menuCutSelection(): Promise<void> {
  const { view } = editorMenuState
  if (!view) return
  try {
    const slice = view.state.selection.content()
    const { dom, text } = view.serializeForClipboard(slice)
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([dom.innerHTML], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ])
  } catch {
    /* ignore */
  }
  const tr = view.state.tr.deleteSelection()
  tr.scrollIntoView()
  view.dispatch(tr)
  closeEditorMenu()
  view.focus()
}

/** 打开引用目标文件 */
export function menuOpenRef(): void {
  const { cfg, target } = editorMenuState
  if (!cfg || !target) return
  cfg.openFile(target.path, null)
  closeEditorMenu()
}

/** 复制引用文本（[[path]] 整段，便于直接粘贴为引用） */
export async function menuCopyRefSyntax(): Promise<void> {
  const { target } = editorMenuState
  if (!target) return
  try {
    await navigator.clipboard.writeText(`[[${target.path}]]`)
  } catch {
    /* ignore */
  }
  closeEditorMenu()
}

/** 切换引用类型（右键在引用节点上；失败/无变化 → 保持菜单打开） */
export function menuSetRefMode(mode: RefMode): void {
  const { view, editor, target } = editorMenuState
  if (!view || !editor || !target) return
  if (convertRefMode(view, editor, target.pos, mode)) {
    closeEditorMenu()
    view.focus()
  }
}

// ---------- 内部剪贴板 helpers ----------

/** 文件树「复制」：写入内部剪贴板 + 系统剪贴板（自定义 MIME 优先，text/plain 兜底） */
export async function copyNodesToClipboard(items: CopiedNode[]): Promise<void> {
  const paths = items.map((i) => i.path)
  setInternalClip(items)
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        [WRITEIT_NODE_MIME]: new Blob([JSON.stringify(items)], { type: WRITEIT_NODE_MIME }),
        'text/plain': new Blob([paths.join('\n')], { type: 'text/plain' }),
      }),
    ])
  } catch {
    // 写系统剪贴板失败 → 内部剪贴板兜底（同一应用内粘贴仍可用）
  }
}

/** 从剪贴板事件提取「文件引用」（优先级：自定义 MIME → 内部剪贴板 → text/uri-list） */
export function extractClipItems(
  e: ClipboardEvent,
  resolveExternal: (absPath: string) => string
): InsertItems | null {
  const dt = e.clipboardData
  const types = dt ? Array.from(dt.types) : []

  // ① 应用内自定义 MIME（文件树复制；跨标签共享系统剪贴板）
  if (dt && types.includes(WRITEIT_NODE_MIME)) {
    try {
      const raw = dt.getData(WRITEIT_NODE_MIME)
      const parsed = JSON.parse(raw) as CopiedNode[]
      if (Array.isArray(parsed) && parsed.length) {
        setInternalClip(parsed)
        return splitCopied(parsed)
      }
    } catch {
      /* 解析失败 → 落内部剪贴板 */
    }
  }

  // ② 系统文件管理器复制（text/uri-list / 文件 URL）——系统剪贴板是权威来源，
  //    命中时覆盖内部剪贴板（用户重新复制的文件才是当前意图）
  if (dt) {
    const uriList = dt.getData('text/uri-list')
    const abs = parseFileUriList(uriList)
    if (abs.length) {
      const items = abs.map((p) => ({ kind: 'file' as const, path: resolveExternal(p) }))
      setInternalClip(items)
      return splitCopied(items)
    }
    // 单条 file://（部分平台只有 text/plain 放 URL）
    const plain = dt.getData('text/plain')
    if (plain && plain.trim().startsWith('file://')) {
      const abs2 = fileUriToAbsolute(plain.trim())
      if (abs2) return splitCopied([{ kind: 'file', path: resolveExternal(abs2) }])
    }
  }

  // ③ 内部剪贴板（navigator.clipboard.write 受限平台的兜底）
  const internal = getInternalClip()
  if (internal && internal.length) return splitCopied(internal)
  return null
}

/** CopiedNode[] → 文件引用 + 目录文本 */
function splitCopied(items: CopiedNode[]): InsertItems {
  return {
    files: items.filter((i) => i.kind === 'file').map((i) => i.path),
    dirs: items.filter((i) => i.kind === 'dir').map((i) => i.path),
  }
}

/** 兜底 resolveExternal：基于 basename（无根路径/工作区外时装配层可复用） */
export function fallbackResolveExternal(absPath: string): string {
  return baseName(absPath)
}

/** 编辑器 action 快捷方式（供菜单动作在任意时刻取 view） */
export function getEditorView(editor: Editor): EditorView | null {
  return editor.action((ctx) => ctx.get(editorViewCtx))
}