import { serializeMarkdownTable } from './serializer'
import type {
  MarkdownTable,
  TableAlignment,
  TableCell,
  TableRegionEdit,
  TableSelection,
  TableSelectionBounds,
} from './types'

function requireIndex(index: number, length: number, name: string): number {
  if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
    throw new RangeError(`${name} must be between 0 and ${length - 1}`)
  }
  return index
}

function requireInsertIndex(index: number, length: number, name: string): number {
  if (!Number.isSafeInteger(index) || index < 0 || index > length) {
    throw new RangeError(`${name} must be between 0 and ${length}`)
  }
  return index
}

function cloneRows(table: MarkdownTable): TableCell[][] {
  return table.rows.map((row) => row.map((cell) => ({ value: cell.value })))
}

function updatedTable(
  table: MarkdownTable,
  rows: readonly (readonly TableCell[])[],
  alignments: readonly TableAlignment[] = table.alignments,
): MarkdownTable {
  return Object.freeze({
    ...table,
    rows: Object.freeze(rows.map((row) => Object.freeze(row.map((cell) => Object.freeze({ value: cell.value }))))),
    alignments: Object.freeze([...alignments]),
  })
}

export function normalizeTableSelection(selection: TableSelection): TableSelectionBounds {
  return Object.freeze({
    top: Math.min(selection.anchorRow, selection.headRow),
    left: Math.min(selection.anchorColumn, selection.headColumn),
    bottom: Math.max(selection.anchorRow, selection.headRow),
    right: Math.max(selection.anchorColumn, selection.headColumn),
  })
}

export function selectTableCell(row: number, column: number): TableSelection {
  if (!Number.isSafeInteger(row) || row < 0 || !Number.isSafeInteger(column) || column < 0) {
    throw new RangeError('Table selection coordinates must be non-negative integers')
  }
  return Object.freeze({ anchorRow: row, anchorColumn: column, headRow: row, headColumn: column })
}

export function updateTableCell(table: MarkdownTable, row: number, column: number, value: string): MarkdownTable {
  requireIndex(row, table.rows.length, 'Row index')
  requireIndex(column, table.alignments.length, 'Column index')
  if (typeof value !== 'string') throw new TypeError('Cell value must be a string')
  const rows = cloneRows(table)
  rows[row][column] = { value }
  return updatedTable(table, rows)
}

export function insertTableCellText(
  table: MarkdownTable,
  row: number,
  column: number,
  offset: number,
  text: string,
): MarkdownTable {
  const value = table.rows[requireIndex(row, table.rows.length, 'Row index')][
    requireIndex(column, table.alignments.length, 'Column index')
  ].value
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > value.length) {
    throw new RangeError(`Cell text offset must be between 0 and ${value.length}`)
  }
  if (typeof text !== 'string') throw new TypeError('Inserted cell text must be a string')
  return updateTableCell(table, row, column, `${value.slice(0, offset)}${text}${value.slice(offset)}`)
}

export function addTableRow(table: MarkdownTable, at: number): MarkdownTable {
  const dataIndex = requireInsertIndex(at, table.rows.length - 1, 'Data row insertion index')
  const rows = cloneRows(table)
  rows.splice(dataIndex + 1, 0, table.alignments.map(() => ({ value: '' })))
  return updatedTable(table, rows)
}

export function deleteTableRow(table: MarkdownTable, row: number): MarkdownTable {
  requireIndex(row, table.rows.length, 'Row index')
  if (row === 0) throw new RangeError('The table header row cannot be deleted')
  if (table.rows.length <= 2) throw new RangeError('The only data row cannot be deleted')
  const rows = cloneRows(table)
  rows.splice(row, 1)
  return updatedTable(table, rows)
}

export function addTableColumn(table: MarkdownTable, at: number, alignment: TableAlignment = null): MarkdownTable {
  const index = requireInsertIndex(at, table.alignments.length, 'Column insertion index')
  const rows = cloneRows(table)
  rows.forEach((row) => row.splice(index, 0, { value: '' }))
  const alignments = [...table.alignments]
  alignments.splice(index, 0, alignment)
  return updatedTable(table, rows, alignments)
}

export function deleteTableColumn(table: MarkdownTable, column: number): MarkdownTable {
  requireIndex(column, table.alignments.length, 'Column index')
  if (table.alignments.length <= 1) throw new RangeError('The only table column cannot be deleted')
  const rows = cloneRows(table)
  rows.forEach((row) => row.splice(column, 1))
  const alignments = [...table.alignments]
  alignments.splice(column, 1)
  return updatedTable(table, rows, alignments)
}

export function moveTableRow(table: MarkdownTable, row: number, targetRow: number): MarkdownTable {
  requireIndex(row, table.rows.length, 'Row index')
  requireIndex(targetRow, table.rows.length, 'Target row index')
  if (row === 0 || targetRow === 0) throw new RangeError('The table header row cannot be reordered')
  if (row === targetRow) return table
  const rows = cloneRows(table)
  const [moved] = rows.splice(row, 1)
  rows.splice(targetRow, 0, moved)
  return updatedTable(table, rows)
}

export function moveTableColumn(table: MarkdownTable, column: number, targetColumn: number): MarkdownTable {
  requireIndex(column, table.alignments.length, 'Column index')
  requireIndex(targetColumn, table.alignments.length, 'Target column index')
  if (column === targetColumn) return table
  const rows = cloneRows(table)
  rows.forEach((row) => {
    const [moved] = row.splice(column, 1)
    row.splice(targetColumn, 0, moved)
  })
  const alignments = [...table.alignments]
  const [movedAlignment] = alignments.splice(column, 1)
  alignments.splice(targetColumn, 0, movedAlignment)
  return updatedTable(table, rows, alignments)
}

export function setTableColumnAlignment(table: MarkdownTable, column: number, alignment: TableAlignment): MarkdownTable {
  requireIndex(column, table.alignments.length, 'Column index')
  if (!['left', 'center', 'right', null].includes(alignment)) throw new TypeError('Unsupported table alignment')
  const alignments = [...table.alignments]
  alignments[column] = alignment
  return updatedTable(table, table.rows, alignments)
}

export function pasteTableMatrix(
  table: MarkdownTable,
  selection: TableSelection,
  matrix: readonly (readonly string[])[],
): MarkdownTable {
  if (matrix.length === 0 || matrix.some((row) => row.length === 0)) return table
  const bounds = normalizeTableSelection(selection)
  requireIndex(bounds.top, table.rows.length, 'Selection row')
  requireIndex(bounds.left, table.alignments.length, 'Selection column')
  const values = matrix.length === 1 && matrix[0].length === 1
    ? Array.from({ length: bounds.bottom - bounds.top + 1 }, () =>
        Array.from({ length: bounds.right - bounds.left + 1 }, () => matrix[0][0]),
      )
    : matrix.map((row) => [...row])
  let next = table
  const requiredRows = bounds.top + values.length
  while (next.rows.length < requiredRows) next = addTableRow(next, next.rows.length - 1)
  const requiredColumns = bounds.left + Math.max(...values.map((row) => row.length))
  while (next.alignments.length < requiredColumns) next = addTableColumn(next, next.alignments.length)
  const rows = cloneRows(next)
  values.forEach((row, rowOffset) => row.forEach((value, columnOffset) => {
    if (typeof value !== 'string') throw new TypeError('Pasted table cells must be strings')
    rows[bounds.top + rowOffset][bounds.left + columnOffset] = { value }
  }))
  return updatedTable(next, rows)
}

export function tableSelectionMatrix(
  table: MarkdownTable,
  selection: TableSelection,
): readonly (readonly string[])[] {
  const bounds = normalizeTableSelection(selection)
  requireIndex(bounds.top, table.rows.length, 'Selection row')
  requireIndex(bounds.bottom, table.rows.length, 'Selection row')
  requireIndex(bounds.left, table.alignments.length, 'Selection column')
  requireIndex(bounds.right, table.alignments.length, 'Selection column')
  return Object.freeze(
    table.rows.slice(bounds.top, bounds.bottom + 1).map((row) =>
      Object.freeze(row.slice(bounds.left, bounds.right + 1).map((cell) => cell.value)),
    ),
  )
}

export function clearTableSelection(table: MarkdownTable, selection: TableSelection): MarkdownTable {
  const bounds = normalizeTableSelection(selection)
  const rows = cloneRows(table)
  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    requireIndex(row, rows.length, 'Selection row')
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      requireIndex(column, table.alignments.length, 'Selection column')
      rows[row][column] = { value: '' }
    }
  }
  return updatedTable(table, rows)
}

export function tableRegionEdit(original: MarkdownTable, edited: MarkdownTable): TableRegionEdit {
  if (
    edited.range.from !== original.range.from ||
    edited.range.to !== original.range.to ||
    edited.source !== original.source
  ) {
    throw new Error('Edited table must retain the original source identity')
  }
  return Object.freeze({
    from: original.range.from,
    to: original.range.to,
    deleted: original.source,
    inserted: serializeMarkdownTable(edited),
  })
}
