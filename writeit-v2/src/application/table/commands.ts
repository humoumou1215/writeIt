import { CommandRegistry, type Command, type UnregisterCommand } from '../commands'
import {
  TABLE_COMMAND_IDS,
  applyTableCommand,
  canApplyTableCommand,
  type MarkdownTable,
  type TableCommandId,
  type TableCommandTarget,
} from '../../core/table'

export interface TableCommandContext {
  readonly table: MarkdownTable
  readonly target: TableCommandTarget
  readonly apply: (table: MarkdownTable) => void | Promise<void>
}

const metadata: Readonly<Record<TableCommandId, { label: string; keywords: readonly string[] }>> = Object.freeze({
  [TABLE_COMMAND_IDS.addRowBefore]: { label: '在前方添加表格行', keywords: ['表格', '行', '添加', '前方', 'table', 'row', 'insert', 'before'] },
  [TABLE_COMMAND_IDS.addRowAfter]: { label: '在后方添加表格行', keywords: ['表格', '行', '添加', '后方', 'table', 'row', 'insert', 'after'] },
  [TABLE_COMMAND_IDS.deleteRow]: { label: '删除表格行', keywords: ['表格', '行', '删除', 'table', 'row', 'remove'] },
  [TABLE_COMMAND_IDS.moveRowUp]: { label: '上移表格行', keywords: ['表格', '行', '重排', '上移', 'table', 'row', 'reorder', 'up'] },
  [TABLE_COMMAND_IDS.moveRowDown]: { label: '下移表格行', keywords: ['表格', '行', '重排', '下移', 'table', 'row', 'reorder', 'down'] },
  [TABLE_COMMAND_IDS.addColumnBefore]: { label: '在前方添加表格列', keywords: ['表格', '列', '添加', '前方', 'table', 'column', 'insert', 'before'] },
  [TABLE_COMMAND_IDS.addColumnAfter]: { label: '在后方添加表格列', keywords: ['表格', '列', '添加', '后方', 'table', 'column', 'insert', 'after'] },
  [TABLE_COMMAND_IDS.deleteColumn]: { label: '删除表格列', keywords: ['表格', '列', '删除', 'table', 'column', 'remove'] },
  [TABLE_COMMAND_IDS.moveColumnLeft]: { label: '左移表格列', keywords: ['表格', '列', '重排', '左移', 'table', 'column', 'reorder', 'left'] },
  [TABLE_COMMAND_IDS.moveColumnRight]: { label: '右移表格列', keywords: ['表格', '列', '重排', '右移', 'table', 'column', 'reorder', 'right'] },
  [TABLE_COMMAND_IDS.alignLeft]: { label: '表格列左对齐', keywords: ['表格', '列', '对齐', '左', 'table', 'column', 'alignment', 'left'] },
  [TABLE_COMMAND_IDS.alignCenter]: { label: '表格列居中对齐', keywords: ['表格', '列', '对齐', '居中', 'table', 'column', 'alignment', 'center'] },
  [TABLE_COMMAND_IDS.alignRight]: { label: '表格列右对齐', keywords: ['表格', '列', '对齐', '右', 'table', 'column', 'alignment', 'right'] },
})

export function createTableCommands(): readonly Command<TableCommandContext, void>[] {
  return Object.freeze(Object.values(TABLE_COMMAND_IDS).map((id) => Object.freeze({
    id,
    label: metadata[id].label,
    group: '表格',
    keywords: metadata[id].keywords,
    availability: (context: TableCommandContext) => canApplyTableCommand(context.table, id, context.target),
    execute: (context: TableCommandContext) => context.apply(applyTableCommand(context.table, id, context.target)),
  })))
}

export function registerTableCommands(registry: CommandRegistry<TableCommandContext>): readonly UnregisterCommand[] {
  return Object.freeze(createTableCommands().map((command) => registry.register(command)))
}

export function createTableCommandRegistry(): CommandRegistry<TableCommandContext> {
  const registry = new CommandRegistry<TableCommandContext>()
  registerTableCommands(registry)
  return registry
}

