// AnnotationService：通用批注能力（设计文档 §M6 / v3 抽屉模式）
// 两种批注：
//   1. 运行时批注（persist=false，如校验违规）——setRuntimeAnnotations 整体替换，仅抽屉只读展示，不落盘
//   2. 人工批注（persist=true）——<mark data-note> 节点，note 属性存「评论线程 JSON」，
//      随保存序列化到 md；评论不可删除、仅创建人可标记已解决
// 抽屉：AnnotationDrawer.vue 订阅本服务；点击正文锚点 → setActiveAnnotation（展开抽屉 + 连线）
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node } from '@milkdown/kit/prose/model'

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
  id: string
  from: number
  to: number
  /** 锚定文本（卡片头预览） */
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

// ---------- 持久化批注（doc 中的 annotation 节点）----------

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

/** 从 doc 收集持久化批注（annotation 节点） */
export function getPersistedAnnotations(doc: Node): Annotation[] {
  const out: Annotation[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'annotation') {
      const note = String(node.attrs.note ?? '')
      const thread = parseThread(note)
      out.push({
        id: `p-${pos}`,
        from: pos,
        to: pos + node.nodeSize,
        anchorText: node.textContent.slice(0, 80),
        level: 'comment',
        thread: thread.length ? thread : [{ id: 'c0', author: '', content: note, createdAt: 0, resolved: false }],
        persist: true,
      })
    }
    return true
  })
  return out
}

/** 全部批注（运行时 + 持久化，供抽屉展示） */
export function getAllAnnotations(doc: Node, tabId: string): Annotation[] {
  return [...getRuntimeAnnotations(tabId), ...getPersistedAnnotations(doc)]
}

// ---------- 人工批注操作 ----------

/** 在选区插入 <mark data-note> 节点（persist=true；创建首条评论） */
export function addAnnotation(
  editor: Editor,
  from: number,
  to: number,
  content: string,
  author: string
): boolean {
  let ok = false
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { schema } = view.state
    const type = schema.nodes.annotation
    if (!type) return
    if (to <= from) return
    const text = view.state.doc.textBetween(from, to, '')
    if (!text.trim()) return
    const thread: Comment[] = [
      { id: `c-${Date.now()}`, author, content, createdAt: Date.now(), resolved: false },
    ]
    const node = type.create({ note: serializeThread(thread) }, schema.text(text))
    const tr = view.state.tr.replaceWith(from, to, node)
    view.dispatch(tr)
    ok = true
  })
  return ok
}

// ---------- 代码块整块批注（v7 变体 D：代码块内选中文本 → 自动升级为整块批注） ----------
// code_block 的 schema content 是 'text*'（只允许纯文本），annotation 直接插入会破坏
// 序列化（代码块提前闭合、内容散落成普通段落，mermaid 预览解析失败）。
// 因此批注锚定「整个代码块」：锚点文本 = 代码块摘要（语言 + 首行），
// 批注节点插入代码块上方的新段落，随保存正常 round-trip。

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

/** 代码块摘要锚点文本：`代码块 (语言)：首行`（首行截断 24 字符） */
export function makeCodeBlockAnchorText(node: Node): string {
  const language = String(node.attrs.language ?? '').trim()
  const firstLine = (node.textContent.split('\n')[0] ?? '').trim().slice(0, 24)
  const label = language ? `代码块 (${language})` : '代码块'
  return firstLine ? `${label}：${firstLine}` : label
}

/**
 * 整块批注：在 code_block 前插入 `paragraph[annotation[摘要]]`，返回新批注节点信息。
 * shift = 插入段落的 nodeSize（供提交后把光标恢复到代码块内原位）。
 */
export function addBlockAnnotation(
  editor: Editor,
  codeBlockPos: number,
  content: string,
  author: string
): { pos: number; nodeSize: number; shift: number } | null {
  let info: { pos: number; nodeSize: number; shift: number } | null = null
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { schema } = view.state
    const type = schema.nodes.annotation
    const block = view.state.doc.nodeAt(codeBlockPos)
    if (!type || !block || block.type.name !== 'code_block') return
    const thread: Comment[] = [
      { id: `c-${Date.now()}`, author, content, createdAt: Date.now(), resolved: false },
    ]
    const anchorText = makeCodeBlockAnchorText(block)
    const annNode = type.create({ note: serializeThread(thread) }, schema.text(anchorText))
    const para = schema.nodes.paragraph.create(null, annNode)
    const tr = view.state.tr.insert(codeBlockPos, para)
    view.dispatch(tr)
    // 插入后位置漂移：用节点对象引用在 dispatch 后的 doc 中重定位（引用持久化不变）
    tr.doc.descendants((n, pos) => {
      if (n === annNode) {
        info = { pos, nodeSize: n.nodeSize, shift: para.nodeSize }
        return false
      }
      return true
    })
  })
  return info
}

/** 追加评论（回复） */
export function addComment(editor: Editor, pos: number, content: string, author: string): boolean {
  let ok = false
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'annotation') return
    const thread = parseThread(String(node.attrs.note ?? ''))
    thread.push({ id: `c-${Date.now()}-${thread.length}`, author, content, createdAt: Date.now(), resolved: false })
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { note: serializeThread(thread) })
    view.dispatch(tr)
    ok = true
  })
  if (ok) notify()
  return ok
}

/** 标记评论已解决/重新打开（仅创建人） */
export function setCommentResolved(
  editor: Editor,
  pos: number,
  commentId: string,
  resolved: boolean,
  by: string
): boolean {
  let ok = false
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'annotation') return
    const thread = parseThread(String(node.attrs.note ?? ''))
    const c = thread.find((x) => x.id === commentId)
    if (!c) return
    if (c.author !== by) return // 仅创建人
    c.resolved = resolved
    c.resolvedAt = resolved ? Date.now() : undefined
    c.resolvedBy = resolved ? by : undefined
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { note: serializeThread(thread) })
    view.dispatch(tr)
    ok = true
  })
  if (ok) notify()
  return ok
}

/**
 * 删除整个批注：普通批注保留锚定文本；
 * 块级批注（段落只含该 mark，即代码块摘要段落）→ 段落一并删除，避免残留孤儿摘要。
 */
export function removeAnnotationNode(editor: Editor, pos: number): boolean {
  let ok = false
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    const node = doc.nodeAt(pos)
    if (!node || node.type.name !== 'annotation') return
    const $p = doc.resolve(pos)
    const parent = $p.parent
    const tr = view.state.tr
    if (
      parent.type.name === 'paragraph' &&
      parent.childCount === 1 &&
      parent.child(0) === node
    ) {
      // 块级批注段落（只有摘要 mark）→ 删除整个段落
      tr.delete($p.before($p.depth), $p.after($p.depth))
    } else {
      // 普通批注：删除 mark，保留锚定文本
      tr.replaceWith(pos, pos + node.nodeSize, view.state.schema.text(node.textContent))
    }
    view.dispatch(tr)
    ok = true
  })
  if (ok) notify()
  return ok
}

export function clearAnnotations(tabId: string): void {
  runtimeAnnotations.delete(tabId)
  if (active.tabId === tabId) active = { tabId: '', id: null }
  notify()
}
