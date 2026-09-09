import { describe, expect, it } from 'vitest'
import {
  addTableColumn,
  addTableRow,
  deleteTableColumn,
  deleteTableRow,
  insertTableCellText,
  moveTableColumn,
  moveTableRow,
  parseMarkdownTables,
  pasteTableMatrix,
  selectTableCell,
  setTableColumnAlignment,
  tableRegionEdit,
  updateTableCell,
} from '../../../../src/core/table'

const source = '| Name | Age | Note |\n| --- | ---: | :---: |\n| Alice | 20 | primary |\n| Bob | 30 | second |\n'

describe('Table Core operations', () => {
  it('edits/replaces a cell and inserts a logical newline', () => {
    const table = parseMarkdownTables(source)[0]
    const changed = insertTableCellText(updateTableCell(table, 1, 1, '21'), 1, 2, 7, '\nnew')
    expect(table.rows[1][1].value).toBe('20')
    expect(tableRegionEdit(table, changed).inserted).toContain('| Alice | 21 | primary<br>new |')
  })

  it('adds and deletes rows and columns without mutating the input', () => {
    const table = parseMarkdownTables(source)[0]
    const added = addTableColumn(addTableRow(table, 1), 1, 'left')
    expect(table.rows).toHaveLength(3)
    expect(added.rows).toHaveLength(4)
    expect(added.rows.every((row) => row.length === 4)).toBe(true)
    expect(added.alignments).toEqual([null, 'left', 'right', 'center'])
    expect(deleteTableColumn(deleteTableRow(added, 2), 1).rows).toEqual(table.rows)
  })

  it('protects the header, only data row, and only column', () => {
    const table = parseMarkdownTables('| A |\n| --- |\n| B |\n')[0]
    expect(() => deleteTableRow(table, 0)).toThrow(/header/u)
    expect(() => deleteTableRow(table, 1)).toThrow(/only data row/u)
    expect(() => deleteTableColumn(table, 0)).toThrow(/only table column/u)
  })

  it('reorders rows and columns while moving alignment metadata', () => {
    const table = parseMarkdownTables(source)[0]
    const rowsMoved = moveTableRow(table, 2, 1)
    expect(rowsMoved.rows.slice(1).map((row) => row[0].value)).toEqual(['Bob', 'Alice'])
    const columnsMoved = moveTableColumn(rowsMoved, 2, 0)
    expect(columnsMoved.rows[0].map((cell) => cell.value)).toEqual(['Note', 'Name', 'Age'])
    expect(columnsMoved.alignments).toEqual(['center', null, 'right'])
    expect(() => moveTableRow(table, 0, 1)).toThrow(/header/u)
  })

  it('updates alignment and expands deterministic matrix paste', () => {
    const table = parseMarkdownTables(source)[0]
    const aligned = setTableColumnAlignment(table, 0, 'center')
    const pasted = pasteTableMatrix(aligned, selectTableCell(2, 2), [['A', 'B'], ['C', 'D']])
    expect(pasted.rows).toHaveLength(4)
    expect(pasted.alignments).toHaveLength(4)
    expect(pasted.rows[2].slice(2).map((cell) => cell.value)).toEqual(['A', 'B'])
    expect(pasted.rows[3].slice(2).map((cell) => cell.value)).toEqual(['C', 'D'])
  })

  it('fills a selected rectangle from a single pasted value', () => {
    const table = parseMarkdownTables(source)[0]
    const pasted = pasteTableMatrix(table, {
      anchorRow: 1,
      anchorColumn: 0,
      headRow: 2,
      headColumn: 1,
    }, [['same']])
    expect(pasted.rows.slice(1).map((row) => row.slice(0, 2).map((cell) => cell.value))).toEqual([
      ['same', 'same'],
      ['same', 'same'],
    ])
  })
})
