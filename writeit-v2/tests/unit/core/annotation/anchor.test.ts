import { describe, expect, it } from 'vitest'
import { createRangeAnchor, mapRangeAnchorThroughChange, resolveRangeAnchor } from '../../../../src/core/annotation'

describe('annotation range anchors', () => {
  it('resolves exact anchors and maps non-overlapping source edits', () => {
    const source = 'prefix\nimportant phrase\nsuffix'
    const anchor = createRangeAnchor(source, 'notes.md', 7, 23)
    expect(resolveRangeAnchor(anchor, source)).toMatchObject({ status: 'resolved', from: 7, to: 23 })
    expect(mapRangeAnchorThroughChange(anchor, 'prefix++\nimportant phrase\nsuffix', [
      { from: 6, to: 6, inserted: '++' },
    ])).toMatchObject({ status: 'resolved', from: 9, to: 25 })
  })

  it('reanchors a uniquely moved occurrence but fails closed for deletion/ambiguity', () => {
    const source = 'before target after'
    const anchor = createRangeAnchor(source, 'notes.md', 7, 13)
    expect(resolveRangeAnchor(anchor, 'before moved\n target after')).toMatchObject({ status: 'resolved' })
    expect(resolveRangeAnchor(anchor, 'before after')).toEqual({ status: 'unresolved', reason: 'deleted' })
    const repeated = createRangeAnchor('target one target two', 'notes.md', 0, 6)
    expect(resolveRangeAnchor(repeated, 'target two target one')).toEqual({ status: 'unresolved', reason: 'ambiguous' })
  })

  it('keeps code-block anchors scoped to their original fence identity', () => {
    const source = '```js\nconst target = 1\n```'
    const from = source.indexOf('target')
    const anchor = createRangeAnchor(source, 'code.md', from, from + 6)
    expect(anchor.codeBlockIdentity).toContain('js')
    expect(resolveRangeAnchor(anchor, '```python\nconst target = 1\n```')).toEqual({ status: 'unresolved', reason: 'code-block-changed' })
  })
})
