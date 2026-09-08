import { describe, expect, it } from 'vitest'
import {
  formatReference,
  parseReferenceAt,
  parseReferences,
  ReferenceSyntaxError,
  stringifyReference,
} from '../../../../src/core/reference'

describe('Markdown reference syntax', () => {
  it('parses links, fragments, editable embeds, and readonly embeds with source offsets', () => {
    const source =
      'See [[A.md]] and [[A.md#Heading with spaces]].\n![[B]]\n![[C.md#Section|ro]]'
    const references = parseReferences(source)

    expect(references).toHaveLength(4)
    expect(references.map((reference) => reference.raw)).toEqual([
      '[[A.md]]',
      '[[A.md#Heading with spaces]]',
      '![[B]]',
      '![[C.md#Section|ro]]',
    ])
    expect(references.map(({ kind, path, fragment, readonly }) => ({
      kind,
      path,
      fragment,
      readonly,
    }))).toEqual([
      { kind: 'link', path: 'A.md', fragment: null, readonly: false },
      {
        kind: 'link',
        path: 'A.md',
        fragment: 'Heading with spaces',
        readonly: false,
      },
      { kind: 'embed', path: 'B', fragment: null, readonly: false },
      {
        kind: 'embed',
        path: 'C.md',
        fragment: 'Section',
        readonly: true,
      },
    ])

    for (const reference of references) {
      expect(source.slice(reference.from, reference.to)).toBe(reference.raw)
      expect(reference.to).toBe(reference.from + reference.raw.length)
    }
  })

  it('does not interpret escaped, code, or unsupported syntax as references', () => {
    const source = [
      '\\[[escaped]]',
      '\\\\[[active-after-even-escapes]]',
      '`[[inline-code]]`',
      '```markdown',
      '[[fenced-code]]',
      '```',
      '[[A|display text]]',
      '![[B|unsupported]]',
      '![[C|ro]]',
    ].join('\n')

    expect(parseReferences(source).map((reference) => reference.raw)).toEqual([
      '[[active-after-even-escapes]]',
      '![[C|ro]]',
    ])
  })

  it('recognises fenced-code boundaries with LF, CRLF, and CR line endings', () => {
    for (const lineEnding of ['\n', '\r\n', '\r']) {
      const source = [
        `~~~markdown${lineEnding}`,
        `[[inside-fence]]${lineEnding}`,
        `~~~${lineEnding}`,
        `[[outside-fence]]`,
      ].join('')
      expect(parseReferences(source).map((reference) => reference.raw)).toEqual([
        '[[outside-fence]]',
      ])
    }
  })

  it('parses a token at an explicit offset and leaves incomplete tokens alone', () => {
    const source = 'prefix ![[target.md]] suffix [[incomplete'
    const start = source.indexOf('!')
    const parsed = parseReferenceAt(source, start)

    expect(parsed).toMatchObject({
      kind: 'embed',
      path: 'target.md',
      fragment: null,
      readonly: false,
      raw: '![[target.md]]',
      from: start,
      to: start + '![[target.md]]'.length,
    })
    expect(parseReferenceAt(source, source.indexOf('[[incomplete'))).toBeUndefined()
    expect(parseReferenceAt(source, source.indexOf('prefix'))).toBeUndefined()
  })

  it('formats supported references without changing their spelling', () => {
    expect(stringifyReference({ kind: 'link', path: 'A.md' })).toBe('[[A.md]]')
    expect(
      formatReference({
        kind: 'link',
        path: 'A.md',
        fragment: 'Heading',
      }),
    ).toBe('[[A.md#Heading]]')
    expect(
      stringifyReference({
        kind: 'embed',
        path: 'A.md',
        fragment: 'Heading',
        readonly: true,
      }),
    ).toBe('![[A.md#Heading|ro]]')

    expect(() =>
      stringifyReference({ kind: 'link', path: 'A.md', readonly: true }),
    ).toThrow(ReferenceSyntaxError)
    expect(() =>
      stringifyReference({ kind: 'embed', path: 'A|display' }),
    ).toThrow(ReferenceSyntaxError)
  })

  it('returns frozen source facts and never mutates the source', () => {
    const source = '[[A.md]]'
    const references = parseReferences(source)

    expect(Object.isFrozen(references)).toBe(true)
    expect(Object.isFrozen(references[0])).toBe(true)
    expect(source).toBe('[[A.md]]')
  })
})
