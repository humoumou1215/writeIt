import { describe, expect, it } from 'vitest'
import {
  applySourceChangeSequence,
  applySourceChangeSet,
  appendSourceChangeSequence,
  createSourceChangeSequence,
  createSourceChangeSet,
  createSourceChangeSetFromChanges,
  invertSourceChangeSequence,
  invertSourceChangeSet,
  sourceChangeSequenceByteSize,
  sourceChangeSetByteSize,
  utf8ByteLength,
} from '../../../../src/core/document'

describe('CM6-independent source changes', () => {
  it('creates and inverts a minimal UTF-16-offset targeted change', () => {
    const source = '😀 before\nleft\nright'
    const target = '😀 before\nleft edited\nright'
    const change = createSourceChangeSet(source, target)

    expect(change.changes).toEqual([
      {
        from: '😀 before\nleft'.length,
        to: '😀 before\nleft'.length,
        deleted: '',
        inserted: ' edited',
      },
    ])
    expect(applySourceChangeSet(source, change)).toBe(target)
    expect(
      applySourceChangeSet(target, invertSourceChangeSet(change)),
    ).toBe(source)
  })

  it('applies disjoint source ranges without touching the gaps', () => {
    const source = '0123456789'
    const change = createSourceChangeSetFromChanges(source, [
      { from: 1, to: 2, insert: 'A' },
      { from: 7, to: 8, insert: 'B' },
    ])

    expect(applySourceChangeSet(source, change)).toBe('0A23456B89')
    expect(
      applySourceChangeSet('0A23456B89', invertSourceChangeSet(change)),
    ).toBe(source)
  })

  it('groups connected source changes and inverts the complete sequence', () => {
    const first = createSourceChangeSetFromChanges('abc', [
      { from: 3, to: 3, insert: 'd' },
    ])
    const second = createSourceChangeSetFromChanges('abcd', [
      { from: 4, to: 4, insert: 'e' },
    ])
    const sequence = appendSourceChangeSequence(
      createSourceChangeSequence(first),
      second,
    )

    expect(applySourceChangeSequence('abc', sequence)).toBe('abcde')
    expect(
      applySourceChangeSequence(
        'abcde',
        invertSourceChangeSequence(sequence),
      ),
    ).toBe('abc')
    expect(sourceChangeSequenceByteSize(sequence)).toBe(2)
  })

  it('counts UTF-8 payload bytes and rejects inconsistent ranges', () => {
    expect(utf8ByteLength('a你好😀')).toBe(11)
    const change = createSourceChangeSet('base', 'base你好')
    expect(sourceChangeSetByteSize(change)).toBe(6)

    expect(() =>
      applySourceChangeSet(
        'base',
        {
          sourceLength: 4,
          targetLength: 4,
          changes: [
            { from: 0, to: 1, deleted: 'x', inserted: 'b' },
          ],
        },
      ),
    ).toThrow(/deleted segment/)
    expect(() =>
      createSourceChangeSetFromChanges('0123', [
        { from: 0, to: 2, insert: 'a' },
        { from: 1, to: 3, insert: 'b' },
      ]),
    ).toThrow(/ordered and non-overlapping/)
  })
})
