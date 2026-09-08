import { describe, expect, it } from 'vitest'
import {
  createReferenceContextEdit,
  createReferenceContextOpenRequest,
  parseReferenceAt,
  referenceContextModeFor,
  referenceContextSyntax,
} from '../../../../src/core/reference'

function reference(source: string) {
  const parsed = parseReferenceAt(source, 0)
  if (!parsed) throw new Error('reference did not parse')
  return parsed
}

describe('reference context actions', () => {
  it('copies the exact token and builds an open request with a resolved path', () => {
    const parsed = reference('![[notes/target.md#Heading|ro]]')

    expect(referenceContextSyntax(parsed)).toBe('![[notes/target.md#Heading|ro]]')
    expect(createReferenceContextOpenRequest(parsed, 'notes/target.md')).toMatchObject({
      action: 'open',
      path: 'notes/target.md',
      fragment: 'Heading',
      kind: 'embed',
      readonly: true,
    })
  })

  it('changes only the reference token while retaining fragment and path', () => {
    const source = 'Before [[target.md#Heading]] after'
    const parsed = reference('[[target.md#Heading]]')
    const from = source.indexOf(parsed.raw)
    const edit = createReferenceContextEdit({
      source,
      reference: { ...parsed, from, to: from + parsed.raw.length },
      mode: 'embed-readonly',
    })

    expect(referenceContextModeFor(parsed)).toBe('link')
    expect(edit).toMatchObject({
      from,
      to: from + parsed.raw.length,
      insert: '![[target.md#Heading|ro]]',
      mode: 'embed-readonly',
    })
    expect(
      source.slice(0, edit!.from) + edit!.insert + source.slice(edit!.to),
    ).toBe('Before ![[target.md#Heading|ro]] after')
  })

  it('does not create a revision for an already-selected mode', () => {
    const parsed = reference('![[target.md]]')
    expect(referenceContextModeFor(parsed)).toBe('embed')
    expect(
      createReferenceContextEdit({
        source: parsed.raw,
        reference: parsed,
        mode: 'embed',
      }),
    ).toBeUndefined()
  })
})
