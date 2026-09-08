import {
  addTableColumn,
  addTableRow,
  deleteTableColumn,
  deleteTableRow,
  moveTableColumn,
  moveTableRow,
  setTableColumnAlignment,
} from './operations'
import type { MarkdownTable } from './types'

export const TABLE_COMMAND_IDS = Object.freeze({
  addRowBefore: 'editor.table.add-row-before',
  addRowAfter: 'editor.table.add-row-after',
  deleteRow: 'editor.table.delete-row',
  moveRowUp: 'editor.table.move-row-up',
  moveRowDown: 'editor.table.move-row-down',
  addColumnBefore: 'editor.table.add-column-before',
  addColumnAfter: 'editor.table.add-column-after',
  deleteColumn: 'editor.table.delete-column',
  moveColumnLeft: 'editor.table.move-column-left',
  moveColumnRight: 'editor.table.move-column-right',
  alignLeft: 'editor.table.align-left',
  alignCenter: 'editor.table.align-center',
  alignRight: 'editor.table.align-right',
} as const)

export type TableCommandId = typeof TABLE_COMMAND_IDS[keyof typeof TABLE_COMMAND_IDS]

export interface TableCommandTarget {
  readonly row: number
  readonly column: number
}

export function canApplyTableCommand(table: MarkdownTable, commandId: TableCommandId, target: TableCommandTarget): boolean {
  if (target.row < 0 || target.row >= table.rows.length || target.column < 0 || target.column >= table.alignments.length) return false
  if (commandId === TABLE_COMMAND_IDS.deleteRow) return target.row > 0 && table.rows.length > 2
  if (commandId === TABLE_COMMAND_IDS.moveRowUp) return target.row > 1
  if (commandId === TABLE_COMMAND_IDS.moveRowDown) return target.row > 0 && target.row < table.rows.length - 1
  if (commandId === TABLE_COMMAND_IDS.deleteColumn) return table.alignments.length > 1
  if (commandId === TABLE_COMMAND_IDS.moveColumnLeft) return target.column > 0
  if (commandId === TABLE_COMMAND_IDS.moveColumnRight) return target.column < table.alignments.length - 1
  return true
}

export function applyTableCommand(table: MarkdownTable, commandId: TableCommandId, target: TableCommandTarget): MarkdownTable {
  if (!canApplyTableCommand(table, commandId, target)) return table
  switch (commandId) {
    case TABLE_COMMAND_IDS.addRowBefore: return addTableRow(table, Math.max(0, target.row - 1))
    case TABLE_COMMAND_IDS.addRowAfter: return addTableRow(table, target.row)
    case TABLE_COMMAND_IDS.deleteRow: return deleteTableRow(table, target.row)
    case TABLE_COMMAND_IDS.moveRowUp: return moveTableRow(table, target.row, target.row - 1)
    case TABLE_COMMAND_IDS.moveRowDown: return moveTableRow(table, target.row, target.row + 1)
    case TABLE_COMMAND_IDS.addColumnBefore: return addTableColumn(table, target.column)
    case TABLE_COMMAND_IDS.addColumnAfter: return addTableColumn(table, target.column + 1)
    case TABLE_COMMAND_IDS.deleteColumn: return deleteTableColumn(table, target.column)
    case TABLE_COMMAND_IDS.moveColumnLeft: return moveTableColumn(table, target.column, target.column - 1)
    case TABLE_COMMAND_IDS.moveColumnRight: return moveTableColumn(table, target.column, target.column + 1)
    case TABLE_COMMAND_IDS.alignLeft: return setTableColumnAlignment(table, target.column, 'left')
    case TABLE_COMMAND_IDS.alignCenter: return setTableColumnAlignment(table, target.column, 'center')
    case TABLE_COMMAND_IDS.alignRight: return setTableColumnAlignment(table, target.column, 'right')
  }
}

