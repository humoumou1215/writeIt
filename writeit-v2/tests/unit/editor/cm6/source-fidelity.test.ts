import { ChangeSet } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  applyProjectedChangesToSource,
  applyProjectedMarkdownToSource,
  projectMarkdownSource,
  sourceOffsetForProjectedPosition,
} from '../../../../src/editor/cm6/projection/source-fidelity'

describe('CM6 Markdown source-fidelity mapping', () => {
  it.each([
    ['LF', 'one\ntwo\nthree'],
    ['CRLF', 'one\r\ntwo\r\nthree'],
    ['CR', 'one\rtwo\rthree'],
    ['mixed', 'one\r\ntwo\nthree\rfour'],
  ])('projects %s endings without losing source boundaries', (_name, source) => {
    const projection = projectMarkdownSource(source)

    expect(projection.projected).toBe('one\ntwo\nthree' + (source.includes('four') ? '\nfour' : ''))
    expect(projection.source).toBe(source)
    expect(
      sourceOffsetForProjectedPosition(
        projection,
        projection.projected.length,
      ),
    ).toBe(source.length)
  })

  it('maps a targeted ChangeSet back to source without normalizing untouched separators', () => {
    const source = 'one\r\ntwo\rthree\nfour\r\n'
    const projection = projectMarkdownSource(source)
    const from = projection.projected.indexOf('two')
    const changes = ChangeSet.of(
      [{ from, to: from + 'two'.length, insert: 'edited' }],
      projection.projected.length,
    )

    expect(applyProjectedChangesToSource(projection, changes)).toBe(
      'one\r\nedited\rthree\nfour\r\n',
    )
  })

  it('maps inserted and deleted line boundaries as one authoritative separator', () => {
    const source = 'one\r\ntwo\rthree\nfour'
    const projection = projectMarkdownSource(source)
    const newline = projection.projected.indexOf('\n')
    const deleteChange = ChangeSet.of(
      [{ from: newline, to: newline + 1, insert: '' }],
      projection.projected.length,
    )

    expect(applyProjectedChangesToSource(projection, deleteChange)).toBe(
      'onetwo\rthree\nfour',
    )
  })

  it('preserves source separators when a popup submits a full projected replacement', () => {
    const source = 'one\r\ntwo\rthree\nfour\n'
    const projection = projectMarkdownSource(source)
    const projected = projection.projected.replace('two', 'edited')

    expect(applyProjectedMarkdownToSource(projection, projected)).toBe(
      'one\r\nedited\rthree\nfour\n',
    )
    expect(applyProjectedMarkdownToSource(projection, projection.projected)).toBe(
      source,
    )
  })
})
