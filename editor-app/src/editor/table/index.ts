// 表格增强插件——独立打包模块（仿 milkdown preset-gfm node/table 的"单独打包"组织方式）
// 需求：
//   1. 单元格内支持换行展示；Enter → 在光标处插入换行（<br>，round-trip 稳定）
//   3. Shift+Enter → 在下方新增一行（快捷键可在「设置 → 快捷键」配置）
//   2. 多选单元格复制/粘贴（规范 HTML + TSV，格式不乱）
//   4. 按内容动态分配列宽（字多列更宽、减少折行；结构变化时重算，手动拖拽保留）
// 嵌入：mountEditor 里 crepe.editor.use(...tableEnhancePlugin)，
//       并在 crepe.editor.config((ctx) => ctx.set(tableConfigCtx.key, cfg)) 注入可配置快捷键。
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { tableConfigCtx, DEFAULT_TABLE_CONFIG, toMilkdownCombo } from './config'
import { tableEnhanceKeymap } from './keymap'
import { tableClipboardPlugin } from './clipboard'
import { tableColumnWidthPlugin } from './column-width'
import { insertBreakInCellCommand, addRowBelowCommand } from './command'
import { tableHardbreakSchema, htmlBreakToHardbreakPlugin } from './schema'
import './table.css'

export { tableConfigCtx, DEFAULT_TABLE_CONFIG, toMilkdownCombo } from './config'
export { insertBreakInCellCommand, addRowBelowCommand } from './command'
export { tableEnhanceKeymap } from './keymap'
export { cellSelectionToHtml, cellSelectionToTsv } from './clipboard'
export type { TableConfig } from './config'

/** 装配层生成表格配置（读 app「设置 → 快捷键」里的 tableAddRowBelow） */
export function buildTableConfig(addRowBelowCombo: string | undefined) {
  return {
    addRowBelowShortcut: toMilkdownCombo(addRowBelowCombo || DEFAULT_TABLE_CONFIG.addRowBelowShortcut),
    dynamicColumnWidth: true,
  }
}

/** 组合插件：$ctx(config) + schema(hardbreak→<nbr> round-trip) + commands + keymap + clipboard + columnWidth */
export const tableEnhancePlugin: MilkdownPlugin[] = [
  tableConfigCtx,
  ...tableHardbreakSchema,
  htmlBreakToHardbreakPlugin,
  insertBreakInCellCommand,
  addRowBelowCommand,
  tableEnhanceKeymap,
  tableClipboardPlugin,
  tableColumnWidthPlugin,
]

/** 默认「新增下方行」快捷键（展示在设置里的默认值） */
export const TABLE_ADD_ROW_DEFAULT = 'Shift+Enter'
