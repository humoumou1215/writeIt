import { describe, expect, it } from 'vitest'
import {
  createReferenceOpenRequest,
  createReferenceReselectRequest,
  decideReferenceNavigation,
  findReferenceAtOffset,
  type ReferenceHealthFact,
  parseReferenceAt,
  evaluateReferenceHealth,
} from '../../../../src/core/reference'

function fact(
  source: string,
  availablePaths: readonly string[] = ['host.md', 'target.md'],
): Promise<ReferenceHealthFact> {
  const parsed = parseReferenceAt(source, 0)
  if (!parsed) throw new Error('reference did not parse')
  return evaluateReferenceHealth(parsed, {
    sourcePath: 'host.md',
    availablePaths,
    contentReader: { readFile: async () => '# Heading\n' },
  })
}

describe('reference navigation decisions', () => {
  it('opens a verified target and keeps fragment metadata', async () => {
    const value = await fact('[[target#Heading]]')
    const request = createReferenceOpenRequest(value)

    expect(request).toMatchObject({
      action: 'open',
      path: 'target.md',
      fragment: 'Heading',
      fragmentTarget: { kind: 'heading' },
    })
    expect(decideReferenceNavigation(value).action).toBe('open')
  })

  it('routes broken references to source-preserving re-selection', async () => {
    const value = await fact('[[missing]]')
    const request = createReferenceReselectRequest(value)

    expect(request).toMatchObject({
      action: 'reselect',
      raw: '[[missing]]',
      path: 'missing',
    })
    expect(decideReferenceNavigation(value)).toMatchObject({
      action: 'reselect',
      reason: 'missing',
    })
  })

  it('hit-tests the exact source token range', async () => {
    const value = await fact('[[target]]')
    expect(findReferenceAtOffset([value], value.from)).toBe(value)
    expect(findReferenceAtOffset([value], value.to - 1)).toBe(value)
    expect(findReferenceAtOffset([value], value.to)).toBeUndefined()
  })
})
