import { describe, expect, it } from 'vitest'
import {
  parseMarkdownTableAt,
  parseMarkdownTables,
  replaceMarkdownTable,
  scanMarkdownTables,
  serializeMarkdownTable,
  untouchedTableSource,
  type MarkdownTable,
} from '../../../../src/core/table'

function withCell(table: MarkdownTable, row: number, column: number, value: string): MarkdownTable {
  return {
    ...table,
    rows: table.rows.map((cells, rowIndex) =>
      cells.map((cell, columnIndex) =>
        rowIndex === row && columnIndex === column ? { value } : cell,
      ),
    ),
  }
}

describe('Markdown Table Core parser and serializer', () => {
  it('parses alignment, empty cells, escaped pipes, code pipes, Chinese, emoji, and logical breaks', () => {
    const source = [
      '| 名称 | 值 | 备注 |',
      '| :--- | ---: | :---: |',
      '| 甲 |  | escaped \\| pipe |',
      '| 😀 | `x|y` | 第一行<br />第二行 |',
      '',
    ].join('\n')
    const table = parseMarkdownTables(source)[0]
    expect(table.alignments).toEqual(['left', 'right', 'center'])
    expect(table.rows.map((row) => row.map((cell) => cell.value))).toEqual([
      ['名称', '值', '备注'],
      ['甲', '', 'escaped | pipe'],
      ['😀', '`x|y`', '第一行\n第二行'],
    ])
    expect(untouchedTableSource(table)).toBe(source)
    expect(serializeMarkdownTable(table)).toContain('第一行<br>第二行')
  })

  it('keeps untouched LF and CRLF sources byte-for-byte', () => {
    for (const source of [
      'before\n| A | B |\n| --- | --- |\n| 1 | 2 |\nafter\n',
      'before\r\n| A | B |\r\n| --- | --- |\r\n| 1 | 2 |\r\nafter\r\n',
    ]) {
      const table = parseMarkdownTables(source)[0]
      expect(source.slice(table.range.from, table.range.to)).toBe(table.source)
      expect(untouchedTableSource(table)).toBe(table.source)
    }
  })

  it('canonicalizes only an intentionally edited table region', () => {
    const source = '前文  \r\n\r\n| A|B |\r\n| --- | ---: |\r\n| one | two |\r\n\r\n后文 😀\r\n'
    const table = parseMarkdownTables(source)[0]
    const output = replaceMarkdownTable(source, withCell(table, 1, 1, 'line 1\nline | 2'))
    expect(output).toBe('前文  \r\n\r\n| A | B |\r\n| --- | ---: |\r\n| one | line 1<br>line \\| 2 |\r\n\r\n后文 😀\r\n')
  })

  it('finds a table only at offsets inside its exact source range', () => {
    const source = 'before\n\n| A |\n| --- |\n| B |\n\nafter'
    const table = parseMarkdownTables(source)[0]
    expect(parseMarkdownTableAt(source, table.range.from)).toEqual(table)
    expect(parseMarkdownTableAt(source, table.range.to - 1)).toEqual(table)
    expect(parseMarkdownTableAt(source, 0)).toBeNull()
  })

  it.each([
    {
      name: 'invalid separator',
      source: '| A | B |\n| -- | --- |\n| 1 | 2 |\n',
      rejectedSource: '| A | B |\n| -- | --- |\n',
      reason: 'invalid-separator',
    },
    {
      name: 'inconsistent data row width',
      source: '| A | B |\n| --- | --- |\n| 1 |\n',
      rejectedSource: '| A | B |\n| --- | --- |\n| 1 |\n',
      reason: 'column-count-mismatch',
    },
    {
      name: 'unterminated code span',
      source: '| A | B |\n| --- | --- |\n| `broken | value |\n',
      rejectedSource: '| A | B |\n| --- | --- |\n| `broken | value |\n',
      reason: 'unterminated-code-span',
    },
  ])('rejects $name without repairing its source', ({ source, rejectedSource, reason }) => {
    const result = scanMarkdownTables(source)
    expect(result.tables).toHaveLength(0)
    expect(result.rejected[0]).toMatchObject({ reason, source: rejectedSource })
  })

  it('does not mistake ordinary pipe prose for a table candidate', () => {
    const source = 'alpha | beta\nplain prose\n'
    expect(scanMarkdownTables(source)).toEqual({ tables: [], rejected: [] })
  })

  it('refuses stale range replacement rather than touching unrelated source', () => {
    const source = '| A |\n| --- |\n| B |\n'
    const table = parseMarkdownTables(source)[0]
    expect(() => replaceMarkdownTable(`prefix\n${source}`, table)).toThrow(/no longer matches/u)
  })
})
