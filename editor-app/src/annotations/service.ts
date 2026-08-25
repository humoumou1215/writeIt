// AnnotationService：通用批注能力（设计文档 §M6 / v3 抽屉模式 / v8 方案A mark 化）
// v8：批注从 inline 节点改为 mark（见 nodes.ts）：
//   - 任意重叠/嵌套/交叉批注、同一文本多条独立批注、段内软换行跨行（mark 覆盖 hardbreak）
//   - 逻辑批注唯一键 = mark attrs.id（data-a 属性）：卡片 / 激活 / 回复 / 解决 / 删除 / 跨段分段合并
// 两种批注：
//   1. 运行时批注（persist=false，如校验违规）——setRuntimeAnnotations 整体替换，仅抽屉只读展示，不落盘
//   2. 人工批注（persist=true）——<mark data-a data-note> mark 节点，note 属性存「评论线程 JSON」，
//      随保存序列化到 md；评论不可删除、仅创建人可标记已解决
// 抽屉：AnnotationDrawer.vue 订阅本服务；点击正文锚点 → setActiveAnnotation（展开抽屉 + 连线）
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node } from '@milkdown/kit/prose/model'
import { genAnnotationId } from './nodes'

export type AnnotationLevel = 'info' | 'warning' | 'error' | 'comment'

/** 一条评论（线程成员） */
export interface Comment {
  id: string
  /** 用户名（Tauri 下取 git user.name；web/mock 用设置的用户名或「我」） */
  author: string
  /** 纯文本内容（v3 决策：不做 markdown 渲染） */
  content: string
  createdAt: number
  /** 已解决标记（仅创建人可标记） */
  resolved: boolean
  resolvedAt?: number
  resolvedBy?: string
}

export interface Annotation {
  /** 逻辑批注 id（mark attrs.id / data-a 属性；v8 起唯一键，同文多条/跨段分段共用一个 id） */
  id: string
  from: number
  to: number
  /** 锚定文本（卡片头预览；多段用 … 连接） */
  anchorText: string
  level: AnnotationLevel
  /** 评论线程（人工批注 ≥1 条；校验批注 1 条只读） */
  thread: Comment[]
  persist: boolean
  /** M14：来源标记——校验违规 / diff 改动说明（抽屉只读卡按来源区分） */
  source?: 'validation' | 'diff'
}

// ---------- 运行时批注（校验等动态场景）----------

const runtimeAnnotations = new Map<string, Annotation[]>()

// ---------- 激活状态（抽屉 + 连线）----------

let active: { tabId: string; id: string | null } = { tabId: '', id: null }

const listeners = new Set<() => void>()

export function subscribeAnnotations(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify() {
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  })
}

export function getRuntimeAnnotations(tabId: string): Annotation[] {
  return runtimeAnnotations.get(tabId) ?? []
}

export function getActiveAnnotationId(): string | null {
  return active.id
}
export function setActiveAnnotation(tabId: string, id: string | null): void {
  active = { tabId, id }
  notify()
}

/** 校验等动态场景：整体替换运行时批注（persist=false，不落盘） */
export function setRuntimeAnnotations(
  tabId: string,
  list: Annotation[],
  editor?: Editor
): void {
  runtimeAnnotations.set(tabId, list)
  notify()
  if (editor) {
    try {
      void editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const tr = view.state.tr.setMeta('annotationRefresh', true)
        view.dispatch(tr)
      })
    } catch {
      /* 编辑器可能已销毁 */
    }
  }
}

// ---------- 持久化批注（doc 中的 annotation mark）----------

/** 线程 JSON ↔ note 属性（短字段名压缩；兼容旧版纯字符串 note） */
export function serializeThread(thread: Comment[]): string {
  return JSON.stringify(
    thread.map((c) => ({
      a: c.author,
      c: c.content,
      t: c.createdAt,
      r: c.resolved ? 1 : 0,
      rt: c.resolvedAt,
      rb: c.resolvedBy,
    }))
  )
}

/** remark 路径的 note 值含 HTML 实体（&quot; 等）→ 先解码 */
function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function parseThread(note: string): Comment[] {
  try {
    const raw = JSON.parse(unescapeHtml(note))
    if (Array.isArray(raw)) {
      return raw
        .filter((c) => c && typeof c.c === 'string')
        .map((c, i) => ({
          id: `c${i}-${c.t ?? 0}`,
          author: String(c.a ?? ''),
          content: String(c.c),
          createdAt: Number(c.t ?? 0) || 0,
          resolved: Boolean(c.r),
          resolvedAt: c.rt ? Number(c.rt) : undefined,
          resolvedBy: c.rb ? String(c.rb) : undefined,
        }))
    }
  } catch {
    /* 旧格式或非 JSON */
  }
  // 旧版：note 是纯文本内容
  return note
    ? [{ id: 'c0', author: '', content: note, createdAt: 0, resolved: false }]
    : []
}

/** 从 doc 收集持久化批注（annotation mark，按 id 分组；同一逻辑批注 = 同 id 的所有分段） */
export function getPersistedAnnotations(doc: Node): Annotation[] {
  const byId = new Map<
    string,
    { note: string; segs: Array<{ pos: number; end: number; text: string }> }
  >()
  doc.descendants((n, pos) => {
    for (const m of n.marks) {
      if (m.type.name === 'annotation') {
        const id = String(m.attrs.id ?? '')
        if (!id) continue
        let rec = byId.get(id)
        if (!rec) {
          rec = { note: String(m.attrs.note ?? ''), segs: [] }
          byId.set(id, rec)
        }
        rec.segs.push({ pos, end: pos + n.nodeSize, text: n.textContent })
      }
    }
    return true
  })
  const out: Annotation[] = []
  for (const [id, rec] of byId) {
    const first = rec.segs[0]
    const last = rec.segs[rec.segs.length - 1]
    const thread = parseThread(rec.note)
    // 锚文本：连续分段（同段内 text/hardbreak 相邻）直接拼接，跨段落用 … 分隔
    let anchorText = ''
    for (let i = 0; i < rec.segs.length; i++) {
      const s = rec.segs[i]
      const prev = rec.segs[i - 1]
      anchorText += prev && s.pos === prev.end ? s.text : (anchorText ? `…${s.text}` : s.text)
    }
    anchorText = anchorText.slice(0, 80)
    out.push({
      id,
      from: first.pos,
      to: last.end,
      anchorText:
        anchorText || (thread[0]?.content || '').slice(0, 40) || '（无锚定文本）',
      level: 'comment',
      thread: thread.length
        ? thread
        : [{ id: 'c0', author: '', content: rec.note, createdAt: 0, resolved: false }],
      persist: true,
    })
  }
  return out
}

/** 全部批注（运行时 + 持久化，供抽屉展示） */
export function getAllAnnotations(doc: Node, tabId: string): Annotation[] {
  return [...getRuntimeAnnotations(tabId), ...getPersistedAnnotations(doc)]
}

// ---------- 人工批注操作（全部按 mark attrs.id）----------

/** doc 中携带指定批注 id 的所有分段（text/inline 节点位置；同一逻辑批注可能跨段/跨块） */
function collectMarkSegments(
  doc: Node,
  id: string
): Array<{ pos: number; end: number; node: Node }> {
  const segs: Array<{ pos: number; end: number; node: Node }> = []
  doc.descendants((n, pos) => {
    for (const m of n.marks) {
      if (m.type.name === 'annotation' && m.attrs.id === id) {
        segs.push({ pos, end: pos + n.nodeSize, node: n })
        break
      }
    }
    return true
  })
  return segs
}

/**
 * 线程变更（回复/解决）：找到该批注的所有分段，
 * 第一段执行变更并序列化新 note，其余分段同步同一 note（保持分段线程一致）。
 * 注意：分段的锚定内容不变 → 每个替换 size 不变 → 坐标不漂移。
 */
function updateThread(
  editor: Editor,
  id: string,
  fn: (thread: Comment[]) => boolean
): boolean {
  let ok = false
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { schema } = view.state
    const type = schema.marks.annotation
    if (!type) return
    let newNote = ''
    const tr = view.state.tr
    // 从后往前替换（size 不变，正序/逆序坐标均有效；逆序更安全）
    const ops: Array<{ pos: number; end: number; node: Node }> = []
    view.state.doc.descendants((n, pos) => {
      const mk = n.marks.find((x) => x.type.name === 'annotation' && x.attrs.id === id)
      if (!mk) return true
      if (!newNote) {
        const thread = parseThread(String(mk.attrs.note ?? ''))
        // 变更被拒绝（无此评论/非创建人）→ 不生成新 note，则不会 dispatch 任何变更
        if (fn(thread)) newNote = serializeThread(thread)
      }
      if (newNote) ops.push({ pos, end: pos + n.nodeSize, node: n })
      return true
    })
    for (const op of ops.reverse()) {
      const marks = op.node.marks.map((x) =>
        x.type.name === 'annotation' && x.attrs.id === id
          ? type.create({ id, note: newNote })
          : x
      )
      if (op.node.isText) {
        tr.replaceWith(op.pos, op.end, schema.text(op.node.text ?? '', marks))
      } else {
        // inline 非文本（hardbreak 等）：重建同类型节点换 marks
        tr.replaceWith(op.pos, op.end, op.node.type.create(op.node.attrs, op.node.content, marks))
      }
    }
    if (ops.length) {
      view.dispatch(tr)
      ok = true
    }
  })
  if (ok) notify()
  return ok
}

/** 在选区上叠加 annotation mark（persist=true；创建首条评论），返回新批注 id */
export function addAnnotation(
  editor: Editor,
  from: number,
  to: number,
  content: string,
  author: string
): string | null {
  let id: string | null = null
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { schema } = view.state
    const type = schema.marks.annotation
    if (!type) return
    if (to <= from) return
    const text = view.state.doc.textBetween(from, to, '')
    if (!text.trim()) return
    const thread: Comment[] = [
      { id: `c-${Date.now()}`, author, content, createdAt: Date.now(), resolved: false },
    ]
    id = genAnnotationId()
    const mark = type.create({ id, note: serializeThread(thread) })
    // v8：addMark 直接叠加——不改变文档结构，选区可覆盖已有批注/富文本/软换行，天然支持重叠
    view.dispatch(view.state.tr.addMark(from, to, mark))
  })
  if (id) notify()
  return id
}

// ---------- 代码块整块批注（v7 变体 D：代码块内选中文本 → 自动升级为整块批注） ----------
// code_block 的 schema content 是 'text*'（只允许纯文本），annotation mark 无法进入代码块，
// 因此批注锚定「整个代码块」：锚点文本 = 代码块摘要（语言 + 首行），
// 摘要文本 + annotation mark 放代码块上方的新段落，随保存正常 round-trip。

/** 选区是否涉及 code_block（部分或整体覆盖）→ 返回第一个 code_block 的起始 pos 与节点 */
export function findCodeBlockInSelection(
  doc: Node,
  from: number,
  to: number
): { pos: number; node: Node } | null {
  let found: { pos: number; node: Node } | null = null
  doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name === 'code_block') {
      found = { pos, node: n }
      return false
    }
    return true
  })
  return found
}

/**
 * 选区是否「跨越」嵌入块（file_block）→ 返回第一个被跨越的 file_block。
 * 「跨越」= 选区部分重叠或整块包含 file_block（from < end && to > start 且非完全在块内）；
 * 完全在嵌入块内部选中（m6d：块内正文批注写回源文件）不拦截。
 */
export function findCrossFileBlockInSelection(
  doc: Node,
  from: number,
  to: number
): { pos: number; node: Node } | null {
  let found: { pos: number; node: Node } | null = null
  doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name !== 'file_block') return true
    const end = pos + n.nodeSize
    if (from >= pos && to <= end) return true // 完全在嵌入块内 → 允许
    found = { pos, node: n } // 跨入/跨出/整块包含 → 拦截
    return false
  })
  return found
}

/** 代码块摘要锚点文本：`代码块 (语言)：首行`（首行截断 24 字符） */
export function makeCodeBlockAnchorText(node: Node): string {
  const language = String(node.attrs.language ?? '').trim()
  const firstLine = (node.textContent.split('\n')[0] ?? '').trim().slice(0, 24)
  const label = language ? `代码块 (${language})` : '代码块'
  return firstLine ? `${label}：${firstLine}` : label
}

/**
 * 整块批注：在 code_block 前插入 `paragraph[摘要文本 + annotation mark]`，
 * 返回新批注 id 与节点信息。shift = 插入段落的 nodeSize（供提交后把光标恢复到代码块内原位）。
 */
export function addBlockAnnotation(
  editor: Editor,
  codeBlockPos: number,
  content: string,
  author: string
): { id: string; pos: number; nodeSize: number; shift: number } | null {
  let info: { id: string; pos: number; nodeSize: number; shift: number } | null = null
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { schema } = view.state
    const type = schema.marks.annotation
    const block = view.state.doc.nodeAt(codeBlockPos)
    if (!type || !block || block.type.name !== 'code_block') return
    const thread: Comment[] = [
      { id: `c-${Date.now()}`, author, content, createdAt: Date.now(), resolved: false },
    ]
    const id = genAnnotationId()
    const anchorText = makeCodeBlockAnchorText(block)
    const annMark = type.create({ id, note: serializeThread(thread) })
    const textNode = schema.text(anchorText, [annMark])
    const para = schema.nodes.paragraph.create(null, textNode)
    const tr = view.state.tr.insert(codeBlockPos, para)
    view.dispatch(tr)
    // 插入后位置漂移：用节点对象引用在 dispatch 后的 doc 中重定位（引用持久化不变）
    tr.doc.descendants((n, pos) => {
      if (n === textNode) {
        info = { id, pos, nodeSize: n.nodeSize, shift: para.nodeSize }
        return false
      }
      return true
    })
  })
  return info
}

/** 追加评论（回复）——按 id 找到批注所有分段同步 */
export function addComment(editor: Editor, id: string, content: string, author: string): boolean {
  return updateThread(editor, id, (thread) => {
    thread.push({
      id: `c-${Date.now()}-${thread.length}`,
      author,
      content,
      createdAt: Date.now(),
      resolved: false,
    })
    return true
  })
}

/** 标记评论已解决/重新打开（仅创建人） */
export function setCommentResolved(
  editor: Editor,
  id: string,
  commentId: string,
  resolved: boolean,
  by: string
): boolean {
  return updateThread(editor, id, (thread) => {
    const c = thread.find((x) => x.id === commentId)
    if (!c) return false
    if (c.author !== by) return false // 仅创建人
    c.resolved = resolved
    c.resolvedAt = resolved ? Date.now() : undefined
    c.resolvedBy = resolved ? by : undefined
    return true
  })
}

/**
 * 删除整个批注（按 id）：普通批注移除 mark 保留锚定文本（其他重叠批注的 mark 不受影响）；
 * 块级批注（段落只含该 mark 的摘要文本，即代码块摘要段落）→ 段落一并删除，避免残留孤儿摘要。
 * 段落删除变长 → 所有操作收集后从后往前执行（后续坐标不受前面变长操作影响）。
 */
export function removeAnnotation(editor: Editor, id: string): boolean {
  let ok = false
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { schema } = view.state
    const type = schema.marks.annotation
    if (!type) return
    const segs = collectMarkSegments(view.state.doc, id)
    if (!segs.length) return
    type ReplaceOp =
      | { kind: 'replace'; pos: number; end: number; node: Node; marks: import('@milkdown/kit/prose/model').Mark[] }
      | { kind: 'delete'; from: number; to: number }
    const ops: ReplaceOp[] = []
    for (const s of segs) {
      const $p = view.state.doc.resolve(s.pos)
      const parent = $p.parent
      if (parent.type.name === 'paragraph' && parent.childCount === 1 && parent.child(0) === s.node) {
        // 变体D 摘要段落：段落唯一文本节点只带该批注 mark（无其他批注叠加）→ 删整个段落
        const annMarks = s.node.marks.filter((x) => x.type.name === 'annotation')
        if (annMarks.length === 1 && annMarks[0].attrs.id === id) {
          ops.push({ kind: 'delete', from: $p.before($p.depth), to: $p.after($p.depth) })
          ok = true
          continue
        }
      }
      // 普通批注：从该分段移除指定的 mark（保留文本与其他批注 mark）
      const marks = s.node.marks.filter(
        (x) => !(x.type.name === 'annotation' && x.attrs.id === id)
      )
      ops.push({ kind: 'replace', pos: s.pos, end: s.end, node: s.node, marks })
      ok = true
    }
    if (!ok) return
    const tr = view.state.tr
    for (const op of ops.reverse()) {
      if (op.kind === 'delete') {
        tr.delete(op.from, op.to)
      } else if (op.node.isText) {
        tr.replaceWith(op.pos, op.end, schema.text(op.node.text ?? '', op.marks))
      } else {
        tr.replaceWith(op.pos, op.end, op.node.type.create(op.node.attrs, op.node.content, op.marks))
      }
    }
    view.dispatch(tr)
  })
  if (ok) notify()
  return ok
}

export function clearAnnotations(tabId: string): void {
  runtimeAnnotations.delete(tabId)
  if (active.tabId === tabId) active = { tabId: '', id: null }
  notify()
}
