import { describe, expect, it } from 'vitest'
import {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  matrixFromSelection,
  parseClipboardHtml,
  parseClipboardTsv,
  parseTables,
  pasteMatrix,
  replaceTable,
  roundTripTable,
  serializeSelectionHtml,
  serializeSelectionTsv,
  updateCell,
  type TableSelection,
} from '../../src/table/core'

const source = `| Name | Age | Note |\n| --- | ---: | :---: |\n| Alice | 20 | primary |\n| Bob | 30 | second |\n`

const selection: TableSelection = { anchorRow: 1, anchorColumn: 0, headRow: 2, headColumn: 1 }

describe('table-core', () => {
  it('parses a Markdown table and keeps an untouched source byte-for-byte', () => {
    const table = parseTables(source)[0]
    expect(table.rows.map((row) => row.map((cell) => cell.value))).toEqual([
      ['Name', 'Age', 'Note'],
      ['Alice', '20', 'primary'],
      ['Bob', '30', 'second'],
    ])
    expect(table.alignment).toEqual([null, 'right', 'center'])
    expect(roundTripTable(table)).toBe(source)
  })

  it('round-trips escaped pipes and inline code without shifting columns', () => {
    const input = '| A | B |\n| --- | --- |\n| `x|y` | escaped \\| pipe |\n'
    const table = parseTables(input)[0]
    expect(table.rows[1].map((cell) => cell.value)).toEqual(['`x|y`', 'escaped | pipe'])
    expect(roundTripTable(table)).toBe(input)
  })

  it('supports rectangular selection, TSV/HTML clipboard, and deterministic paste expansion', () => {
    const table = parseTables(source)[0]
    expect(matrixFromSelection(table, selection)).toEqual([
      ['Alice', '20'],
      ['Bob', '30'],
    ])
    expect(serializeSelectionTsv(table, selection)).toBe('Alice\t20\nBob\t30')
    expect(serializeSelectionHtml(table, selection)).toContain('<table>')
    expect(parseClipboardTsv('A\tB\nC\tD\n').rows).toEqual([['A', 'B'], ['C', 'D']])
    expect(parseClipboardHtml('<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>').rows).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ])
    const pasted = pasteMatrix(table, { anchorRow: 1, anchorColumn: 1, headRow: 1, headColumn: 1 }, [['X', 'Y'], ['Z', 'W']])
    expect(pasted.rows.slice(1).map((row) => row.map((cell) => cell.value))).toEqual([
      ['Alice', 'X', 'Y'],
      ['Bob', 'Z', 'W'],
    ])
  })

  it('updates one cell and writes only the table region back to Markdown', () => {
    const table = parseTables(`before\n\n${source}after\n`)[0]
    const next = updateCell(table, 1, 1, '21')
    const output = replaceTable(`before\n\n${source}after\n`, next)
    expect(output).toContain('| Alice | 21 | primary |')
    expect(output.startsWith('before\n\n')).toBe(true)
    expect(output).toContain('| Bob | 30 | second |\nafter\n')
    expect(output.endsWith('after\n')).toBe(true)
  })

  it('adds/deletes rows and columns while preserving alignment metadata', () => {
    const table = parseTables(source)[0]
    expect(addRow(table).rows).toHaveLength(4)
    expect(deleteRow(table).rows).toHaveLength(2)
    expect(addColumn(table).alignment).toEqual([null, 'right', 'center', null])
    expect(deleteColumn(table).alignment).toEqual([null, 'right'])
  })
})
