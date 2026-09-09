import { describe, expect, it } from 'vitest'
import {
  parseTableClipboard,
  parseTableHtml,
  parseTableTsv,
  serializeTableHtml,
  serializeTableTsv,
} from '../../../../src/core/table'

describe('Table Core clipboard codec', () => {
  it('round-trips quoted TSV tabs, quotes, CRLF, multiline cells, leading zeros, and emoji', () => {
    const matrix = [['multi\nline', '00123', 'a\tb'], ['"quoted"', '中文 😀', 'plain']]
    const tsv = serializeTableTsv(matrix)
    expect(tsv).toContain('"multi\nline"')
    expect(tsv).toContain('"a\tb"')
    expect(parseTableTsv(tsv).rows).toEqual(matrix)
    expect(parseTableTsv('"multi\r\nline"\t00123\r\nA\tB\r\n').rows).toEqual([
      ['multi\nline', '00123'], ['A', 'B'],
    ])
  })

  it('round-trips safe HTML tables and logical breaks', () => {
    const matrix = [['A < B', 'first\nsecond'], ['中文', '😀']]
    const html = serializeTableHtml(matrix)
    expect(html).toContain('A &lt; B')
    expect(html).toContain('first<br>second')
    expect(parseTableHtml(html)?.rows).toEqual(matrix)
  })

  it('sanitizes office-style HTML down to cell text and prefers HTML over TSV', () => {
    const html = '<meta><table class="MsoTableGrid"><tr><td style="x">A<br>B<script>bad()</script></td><td><b>002</b></td></tr></table>'
    expect(parseTableClipboard({ html, text: 'wrong\tdata' })).toEqual({
      source: 'html', rows: [['A\nB', '002']],
    })
  })

  it('rejects malformed quoted TSV instead of guessing', () => {
    expect(() => parseTableTsv('"unfinished')).toThrow(/unterminated/u)
  })
})
