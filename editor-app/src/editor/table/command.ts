// 表格增强插件——命令
//   insertBreakInCellCommand：单元格内 Enter → 在当前光标处插入换行（hardbreak）
//   addRowBelowCommand：单元格内（配置键，默认 Shift+Enter）→ 在下方新增一行，光标移到新行当前列首格
// 仅在「光标落在表格单元格内」时生效；否则返回 false（放行给 milkdown 原有 Enter / Shift+Enter 处理，零干扰）。
import { $command } from '@milkdown/kit/utils'
import { isInTable, selectedRect, addRow, TableMap } from '@milkdown/kit/prose/tables'
import { TextSelection, Selection } from '@milkdown/kit/prose/state'
import { hardbreakSchema } from '@milkdown/kit/preset/commonmark'

/// 需1：Enter → 单元格内换行（hardbreak `<br>`）
/// 用 tr.insert + 显式 setSelection：
///  - 光标精确落在插入的换行之后（不跳格、不吞字符）
///  - 非表格内直接 false，绝不干扰正文换行
export const insertBreakInCellCommand = $command(
  'InsertBreakInCell',
  (ctx) => () => (state, dispatch) => {
    if (!isInTable(state)) return false
    const { selection } = state
    if (!(selection instanceof TextSelection)) return false
    const hb = hardbreakSchema.type(ctx).create()
    const tr = state.tr
    tr.insert(selection.from, hb)
    tr.setSelection(TextSelection.create(tr.doc, selection.from + hb.nodeSize))
    dispatch?.(tr.scrollIntoView())
    return true
  }
)

/// 需3：(默认 Shift+Enter) → 在下方新增一行，光标移到新行当前列首格
export const addRowBelowCommand = $command(
  'AddRowBelow',
  () => () => (state, dispatch) => {
    if (!isInTable(state)) return false
    if (dispatch) {
      const rect = selectedRect(state)
      const tr = state.tr
      addRow(tr, rect, rect.bottom) // prosemirror-tables：在第 bottom 行处插入新行
      // 定位到新行的当前列首格
      const tableStart = rect.tableStart
      const table = tr.doc.nodeAt(tableStart - 1)
      if (table) {
        const map = TableMap.get(table)
        const row = Math.min(rect.bottom, map.height - 1)
        const col = Math.min(rect.left, map.width - 1)
        const cellStart = map.map[row * map.width + col]
        const cellPos = tableStart + cellStart
        const sel = Selection.near(tr.doc.resolve(cellPos + 1))
        tr.setSelection(sel)
      }
      dispatch(tr.scrollIntoView())
    }
    return true
  }
)
