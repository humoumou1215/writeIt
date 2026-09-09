import { describe, expect, it } from 'vitest'
import { diffMarkdownSource, rawChangesAreFullyRepresented } from '../../../../src/core/diff'

describe('raw Markdown diff guarantee', () => {
  it('represents every added and removed line in hunks', () => {
    const result = diffMarkdownSource('one\ntwo\nthree\nfour', 'one\nTWO\nthree\nfive')
    expect(result.rawChangeCount).toBe(4)
    expect(result.representedChangeCount).toBe(4)
    expect(rawChangesAreFullyRepresented(result)).toBe(true)
    expect(result.hunks[0].lines.filter((line) => line.kind === 'removed').map((line) => line.text)).toContain('two')
    expect(result.hunks[0].lines.filter((line) => line.kind === 'added').map((line) => line.text)).toContain('TWO')
  })

  it('supports multiple separated hunks, empty files, and context control', () => {
    const result = diffMarkdownSource('a\nb\nc\nd\ne\nf', 'a\nB\nc\nd\nE\nf', 0)
    expect(result.hunks).toHaveLength(2)
    expect(diffMarkdownSource('', 'new').rawChangeCount).toBe(1)
    expect(diffMarkdownSource('same', 'same').hunks).toHaveLength(0)
  })
})
