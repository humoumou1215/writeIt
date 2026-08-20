// 表格增强插件——配置切片（可配置快捷键）
// 设计：仿 refConfigCtx / validateConfigCtx —— 装配层（manager.ts）通过
// `crepe.editor.config((ctx) => ctx.set(tableConfigCtx.key, cfg))` 注入配置，
// 插件包内部 ctx.get(tableConfigCtx.key) 读取；未注入时使用内置默认。
import { $ctx } from '@milkdown/kit/utils'
import type { Ctx } from '@milkdown/kit/ctx'

export interface TableConfig {
  /** 单元格内「在下方新增一行」的 milkdown 键位串（ProseMirror 格式，如 "Shift-Enter"）。
   *  由 app「设置 → 快捷键」的可配置项（tableAddRowBelow）转换而来。 */
  addRowBelowShortcut: string
  /** 是否启用按内容动态分配列宽（默认 true）；false 则回退为 milkdown 等宽 */
  dynamicColumnWidth?: boolean
}

export const DEFAULT_TABLE_CONFIG: TableConfig = {
  addRowBelowShortcut: 'Shift-Enter',
  dynamicColumnWidth: true,
}

/** 表格增强插件配置切片（$ctx 插件：默认 null；装配层 config 回调 set 覆盖） */
export const tableConfigCtx = $ctx<TableConfig | null, 'writeitTable'>(
  null,
  'writeitTable'
)

/** 从 ctx 读取表格配置（未注入 → 默认） */
export function getTableConfig(ctx: Ctx): TableConfig {
  const cfg = ctx.get(tableConfigCtx.key) as TableConfig | null
  return cfg ? { ...DEFAULT_TABLE_CONFIG, ...cfg } : { ...DEFAULT_TABLE_CONFIG }
}

/**
 * 把 app「设置 → 快捷键」的 "Shift+Enter" / "Ctrl+Shift+X" 组合串，
 * 转换为 milkdown / ProseMirror 键位串 "Shift-Enter" / "Ctrl-Shift-x"。
 * （app 内部快捷键用 '+' 分隔，ProseMirror keymap 用 '-' 分隔）
 */
export function toMilkdownCombo(combo: string): string {
  if (!combo) return DEFAULT_TABLE_CONFIG.addRowBelowShortcut
  return combo.replace(/\+/g, '-')
}
