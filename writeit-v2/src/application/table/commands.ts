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
  [TABLE_COMMAND_IDS.addRowBefore]: { label: 'Add row before', keywords: ['table', 'row', 'insert', 'before'] },
  [TABLE_COMMAND_IDS.addRowAfter]: { label: 'Add row after', keywords: ['table', 'row', 'insert', 'after'] },
  [TABLE_COMMAND_IDS.deleteRow]: { label: 'Delete row', keywords: ['table', 'row', 'remove'] },
  [TABLE_COMMAND_IDS.moveRowUp]: { label: 'Move row up', keywords: ['table', 'row', 'reorder', 'up'] },
  [TABLE_COMMAND_IDS.moveRowDown]: { label: 'Move row down', keywords: ['table', 'row', 'reorder', 'down'] },
  [TABLE_COMMAND_IDS.addColumnBefore]: { label: 'Add column before', keywords: ['table', 'column', 'insert', 'before'] },
  [TABLE_COMMAND_IDS.addColumnAfter]: { label: 'Add column after', keywords: ['table', 'column', 'insert', 'after'] },
  [TABLE_COMMAND_IDS.deleteColumn]: { label: 'Delete column', keywords: ['table', 'column', 'remove'] },
  [TABLE_COMMAND_IDS.moveColumnLeft]: { label: 'Move column left', keywords: ['table', 'column', 'reorder', 'left'] },
  [TABLE_COMMAND_IDS.moveColumnRight]: { label: 'Move column right', keywords: ['table', 'column', 'reorder', 'right'] },
  [TABLE_COMMAND_IDS.alignLeft]: { label: 'Align column left', keywords: ['table', 'column', 'alignment', 'left'] },
  [TABLE_COMMAND_IDS.alignCenter]: { label: 'Align column center', keywords: ['table', 'column', 'alignment', 'center'] },
  [TABLE_COMMAND_IDS.alignRight]: { label: 'Align column right', keywords: ['table', 'column', 'alignment', 'right'] },
})

export function createTableCommands(): readonly Command<TableCommandContext, void>[] {
  return Object.freeze(Object.values(TABLE_COMMAND_IDS).map((id) => Object.freeze({
    id,
    label: metadata[id].label,
    group: 'Table',
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

