// 表格增强插件——键位
//   Enter      → 单元格内换行（insertBreakInCellCommand，优先级高于 milkdown exitTable / splitBlock）
//   可配置键  → 在下方新增一行（默认 Shift+Enter，可配置）
// 关键：两键都只在「光标位于表格单元格内」时接管；否则返回 false，放行给 milkdown 原有键位
// （正文 Enter=新段落、Shift+Enter=hardbreak 等），对本项目存量编辑逻辑零影响。
import { $shortcut } from '@milkdown/kit/utils'
import type { Keymap } from '@milkdown/kit/core'
import { commandsCtx } from '@milkdown/kit/core'
import { isInTable } from '@milkdown/kit/prose/tables'
import { addRowBelowCommand, insertBreakInCellCommand } from './command'
import { tableConfigCtx } from './config'

export const tableEnhanceKeymap = $shortcut((ctx) => {
  const cfg = ctx.get(tableConfigCtx.key)
  const combo = cfg?.addRowBelowShortcut || 'Shift-Enter'
  const commands = ctx.get(commandsCtx)
  const keymap: Keymap = {
    // 需1：Enter → 单元格内换行（仅表格内）；表格外返回 false → 走原 Enter
    Enter: {
      key: 'Enter',
      onRun: () => (state) =>
        isInTable(state) ? commands.call(insertBreakInCellCommand.key) : false,
      priority: 300,
    },
    // 需3：配置键（默认 Shift+Enter）→ 在下方新增一行（仅表格内）
    [combo]: {
      key: combo,
      onRun: () => (state) =>
        isInTable(state) ? commands.call(addRowBelowCommand.key) : false,
      priority: 200,
    },
  }
  return keymap
})
