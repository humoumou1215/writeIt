import { describe, expect, it } from 'vitest'
import { searchSource, searchSources } from '../../../../src/core/search'

describe('search core', () => {
  it('returns source-backed line and column matches', () => {
    const result = searchSource('a.md', 'Alpha\nbeta Alpha', { text: 'alpha' })
    expect(result.matches.map((m) => [m.from, m.to, m.line, m.column])).toEqual([[0, 5, 1, 1], [11, 16, 2, 6]])
  })
  it('supports case sensitivity and regular expressions', () => {
    expect(searchSource('a.md', 'A a AA', { text: 'a', caseSensitive: true }).matches).toHaveLength(1)
    expect(searchSource('a.md', 'a1 a2', { text: 'a\\d', useRegex: true }).matches).toHaveLength(2)
  })
  it('groups only files with hits and rejects invalid patterns', () => {
    expect(searchSources([{ path: 'a.md', markdown: 'x' }, { path: 'b.md', markdown: 'needle' }], { text: 'needle' }).map((r) => r.path)).toEqual(['b.md'])
    expect(() => searchSource('a.md', 'x', { text: '[' , useRegex: true })).toThrow(/Invalid search pattern/)
  })
})
