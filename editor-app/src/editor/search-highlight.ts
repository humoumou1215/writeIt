// 搜索结果高亮（M15 补全）
//  - 跳转定位后，给命中的关键词加临时高亮（ProseMirror decoration，不改文档）
//  - 普通文本命中 → inline decoration（段落/表格单元格）；代码块/原子卡片内命中 → 块前徽标
//  - 文档编辑（docChanged）后自动清除，避免高亮位置漂移；新跳转覆盖旧高亮
import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'

export const searchHighlightKey = new PluginKey('WRITEIT_SEARCH_HIGHLIGHT')

export function searchHighlightPlugin() {
  return $prose(() =>
    new Plugin<DecorationSet>({
      key: searchHighlightKey,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr: Transaction, old: DecorationSet): DecorationSet => {
          const meta = tr.getMeta(searchHighlightKey) as DecorationSet | undefined
          if (meta !== undefined) return meta
          // 普通编辑导致文档变化 → 自动清除（高亮位置可能已失效）
          if (tr.docChanged) return DecorationSet.empty
          return old
        },
      },
      props: {
        decorations: (state: EditorState) =>
          searchHighlightKey.getState(state) ?? DecorationSet.empty,
      },
    })
  )
}

/**
 * 同文件全部匹配高亮：一次 dispatch 多个 inline decoration。
 * current=true 的那个用「橙红实底 + 白字 + 闪烁」（.search-hit-current），
 * 其余用「淡橙底 + 深橙字」（.search-hit-highlight）。
 */
export function setSearchHighlights(
  editor: Editor,
  items: Array<{ from: number; to: number; current?: boolean }>
): void {
  if (!items.length) return
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const decos: Decoration[] = []
    for (const it of items) {
      if (it.from < 0 || it.from >= it.to || it.to > view.state.doc.content.size) continue
      decos.push(
        Decoration.inline(it.from, it.to, {
          class: it.current ? 'search-hit-highlight search-hit-current' : 'search-hit-highlight',
        })
      )
    }
    if (!decos.length) return
    const set = DecorationSet.create(view.state.doc, decos)
    view.dispatch(view.state.tr.setMeta(searchHighlightKey, set))
  })
}

/** 文本命中：行内高亮（单条，兼容旧调用） */
export function setSearchHighlight(editor: Editor, from: number, to: number): void {
  setSearchHighlights(editor, [{ from, to, current: true }])
}

/** 原子节点（嵌入卡片等）内命中：整节点高亮（备选方案，一般改用块前徽标） */
export function setSearchHighlightNode(editor: Editor, from: number, to: number): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (from < 0 || from >= to || to > view.state.doc.content.size) return
    const deco = DecorationSet.create(view.state.doc, [
      Decoration.node(from, to, { class: 'search-hit-highlight-node' }),
    ])
    view.dispatch(view.state.tr.setMeta(searchHighlightKey, deco))
  })
}

/**
 * 块前徽标提示（原子卡片 / 代码块内命中）：内部文本不可按 pos 寻址或
 * inline decoration 不渲染，退而在块前插一个高亮徽标，滚动到块可见。
 */
export function setSearchHighlightWidget(editor: Editor, pos: number): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (pos < 0 || pos > view.state.doc.content.size) return
    const el = document.createElement('span')
    el.className = 'search-hit-widget'
    el.textContent = '命中'
    el.title = '搜索命中位置'
    const deco = DecorationSet.create(view.state.doc, [
      Decoration.widget(pos, el, { side: -1 }),
    ])
    view.dispatch(view.state.tr.setMeta(searchHighlightKey, deco))
  })
}