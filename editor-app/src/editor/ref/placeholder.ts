// M9 模板占位符插件：{{xxx}} 渲染为占位符效果（方案 A：ProseMirror decoration，不改文档内容）
//   - 匹配行内 {{...}}（花括号内允许空格/斜杠等占位符字符，如 {{无要求 / TPS ≤ X}}）
//   - 鼠标点击（handleClick）：落在占位符范围内 → 自动选中整个 {{...}}，输入即整体替换
//   - 键盘移入（appendTransaction）：光标（空 selection）落在占位符内部 → 同样自动选中整个
//   - 注意：code_block 是 ProseMirror code 节点——inline decoration 不渲染其内容、点击 pos 映射到块开头，
//     代码块内 {{}} 保持字面（json 请求/响应示例等），由用户手动替换
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import type { Node as PMNode } from '@milkdown/kit/prose/model'

export const placeholderPluginKey = new PluginKey('TPL_PLACEHOLDER')

const PLACEHOLDER_RE = /{{\s*[^{}\n]*}}/g

function findPlaceholders(state: EditorState): DecorationSet {
  const decos: Decoration[] = []
  const re = PLACEHOLDER_RE
  state.doc.descendants((node, pos) => {
    if (node.isText) {
      const text = node.text ?? ''
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        decos.push(
          Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
            class: 'tpl-placeholder',
          })
        )
      }
    }
    return true
  })
  return DecorationSet.create(state.doc, decos)
}

/** 找 pos 所在的占位符范围（{{...}} 左闭右开） */
function findPlaceholderAt(doc: PMNode, pos: number): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null
  const re = PLACEHOLDER_RE
  doc.descendants((node, p) => {
    if (hit) return false
    if (node.isText) {
      const text = node.text ?? ''
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        const from = p + m.index
        const to = from + m[0].length
        if (pos >= from && pos <= to) {
          hit = { from, to }
          return false
        }
      }
    }
    return true
  })
  return hit
}

export const placeholderDecorationPlugin = new Plugin({
  key: placeholderPluginKey,
  props: {
    decorations(state) {
      return findPlaceholders(state)
    },
    handleClick(view, pos) {
      // 鼠标点击占位符（含边界）→ 选中整个 {{...}}，输入直接整体替换
      const hit = findPlaceholderAt(view.state.doc, pos)
      if (!hit) return false
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, hit.from, hit.to))
      )
      return true
    },
  },
  appendTransaction(_trs: readonly Transaction[], _oldState: EditorState, newState: EditorState): Transaction | null {
    // 键盘方向键把光标移入占位符内部（空 selection）→ 自动选中整个
    const { selection, doc } = newState
    if (!selection.empty) return null
    const pos = selection.$head.pos
    const hit = findPlaceholderAt(doc, pos)
    if (!hit) return null
    // 严格内部：边界不处理（避免困住方向键移出占位符）
    if (pos <= hit.from || pos >= hit.to) return null
    return newState.tr.setSelection(TextSelection.create(doc, hit.from, hit.to))
  },
})
