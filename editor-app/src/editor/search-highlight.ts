// 搜索结果高亮（M15 补全）
//  - 跳转定位后，给命中的关键词加临时高亮（ProseMirror decoration，不改文档）
//  - 普通文本命中 → inline decoration（段落/表格单元格）
//  - 嵌入卡片等原子节点内的命中 → node decoration（整卡高亮，内部文本不可按 pos 寻址）
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

/** 文本命中：行内高亮 */
export function setSearchHighlight(editor: Editor, from: number, to: number): void {
  void editor
    .action((ctx) => {
      const view = ctx.get(editorViewCtx)
      if (from < 0 || from >= to || to > view.state.doc.content.size) return
      const deco = DecorationSet.create(view.state.doc, [
        Decoration.inline(from, to, { class: 'search-hit-highlight' }),
      ])
      view.dispatch(view.state.tr.setMeta(searchHighlightKey, deco))
    })
    .then(
      () => undefined,
      (e) => console.error('[hl:inline]', e)
    )
}

/** 原子节点（嵌入卡片等）内命中：整节点高亮 */
export function setSearchHighlightNode(editor: Editor, from: number, to: number): void {
  void editor
    .action((ctx) => {
      const view = ctx.get(editorViewCtx)
      if (from < 0 || from >= to || to > view.state.doc.content.size) return
      const deco = DecorationSet.create(view.state.doc, [
        Decoration.node(from, to, { class: 'search-hit-highlight-node' }),
      ])
      view.dispatch(view.state.tr.setMeta(searchHighlightKey, deco))
    })
    .then(
      () => undefined,
      (e) => console.error('[hl:node]', e)
    )
}

export function clearSearchHighlight(editor: Editor): void {
  void editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (searchHighlightKey.getState(view.state)) {
      view.dispatch(view.state.tr.setMeta(searchHighlightKey, DecorationSet.empty))
    }
  })
}