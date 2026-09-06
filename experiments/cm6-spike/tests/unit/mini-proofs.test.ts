import { ChangeSet } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { mapAnnotationRange } from '../../src/core/annotation'
import { markdownDiff } from '../../src/core/diff'

describe('Spike mini-proofs', () => {
  it('maps an annotation with the text when text is inserted before it', () => {
    const changes = ChangeSet.of({ from: 0, insert: 'Wonderful ' }, 11)
    expect(mapAnnotationRange({ from: 6, to: 11 }, changes)).toEqual({ from: 16, to: 21 })
  })

  it('diffs Markdown source directly', () => {
    const diff = markdownDiff('# A\nold\n', '# A\nnew\n')
    expect(diff.some((chunk) => chunk.removed && chunk.value.includes('old'))).toBe(true)
    expect(diff.some((chunk) => chunk.added && chunk.value.includes('new'))).toBe(true)
  })
})
