// AnnotationService：通用批注能力（设计文档 §M6）
// 两种批注：
//   1. 运行时批注（persist=false，如校验违规）——setAnnotations 整体替换，仅 decorations 渲染，不落盘
//   2. 人工批注（persist=true）——addAnnotation 把 <mark data-note> 节点插入 doc，随保存序列化到 md
// 批注卡：点击锚点展开（默认展开，点击收起）；@floating-ui 定位（靠右 + flip）。
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node } from '@milkdown/kit/prose/model'

export type AnnotationLevel = 'info' | 'warning' | 'error' | 'comment'

export interface Annotation {
  id: string
  from: number
  to: number
  content: string
  level: AnnotationLevel
  persist: boolean
  author?: string
  createdAt?: number
}

/** 校验等动态场景的批注（persist=false） */
const runtimeAnnotations = new Map<string, Annotation[]>()
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

/** 从 doc 收集持久化批注（annotation 节点） */
export function getPersistedAnnotations(doc: Node): Annotation[] {
  const out: Annotation[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'annotation') {
      out.push({
        id: `p-${pos}-${node.attrs.note}`,
        from: pos,
        to: pos + node.nodeSize,
        content: String(node.attrs.note ?? ''),
        level: 'comment',
        persist: true,
      })
    }
    return true
  })
  return out
}

/** 校验等动态场景：整体替换运行时批注（persist=false，不落盘） */
export function setRuntimeAnnotations(tabId: string, list: Annotation[], editor?: Editor): void {
  runtimeAnnotations.set(tabId, list)
  notify()
  // 触发 decorations 重算（空事务）
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

/** 人工批注：在选区插入 <mark data-note> 节点（persist=true，随保存写回 md） */
export function addAnnotation(editor: Editor, from: number, to: number, content: string): boolean {
  let ok = false
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { schema } = view.state
    const type = schema.nodes.annotation
    if (!type) return
    if (to <= from) return
    // 包裹选区文本为 annotation 节点（截取选区内容作为锚定文本）
    const text = view.state.doc.textBetween(from, to, '')
    if (!text.trim()) return
    const node = type.create({ note: content }, schema.text(text))
    const tr = view.state.tr.replaceWith(from, to, node)
    view.dispatch(tr)
    ok = true
  })
  return ok
}

/** 删除人工批注节点（pos 处的 annotation 节点） */
export function removeAnnotationNode(editor: Editor, pos: number): boolean {
  let ok = false
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'annotation') return
    // 删除包裹标签，保留锚定文本
    const inner = node.textContent
    const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, view.state.schema.text(inner))
    view.dispatch(tr)
    ok = true
  })
  return ok
}

/** 更新批注内容（persist 节点 attrs.note） */
export function updateAnnotationNode(editor: Editor, pos: number, content: string): boolean {
  let ok = false
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'annotation') return
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { note: content })
    view.dispatch(tr)
    ok = true
  })
  return ok
}

export function clearAnnotations(tabId: string): void {
  runtimeAnnotations.delete(tabId)
  notify()
}
