import { describe, expect, it } from 'vitest'
import { composedContentStats, parseOutline } from '../../../src/core'
import { validateMarkdown } from '../../../src/core/validation'

describe('derived services', () => {
  it('builds nested outline with source offsets', () => {
    const outline = parseOutline('# A\n## B\n### C')
    expect(outline[0].text).toBe('A'); expect(outline[0].children[0].children[0].from).toBe(9)
  })
  it('counts repeated embeds and stops cycles', () => {
    const files: Record<string, string> = { 'a.md': 'A ![[b.md]] ![[b.md]]', 'b.md': '# B ![[a.md]]' }
    const stats = composedContentStats('a.md', files['a.md'], { read: (path) => files[path] })
    expect(stats.embedCount).toBe(4); expect(stats.circularEmbeds).toHaveLength(2)
  })
  it('isolates rule failures', () => {
    const result = validateMarkdown('x  \n', [{ id: 'broken', validate: () => { throw new Error('boom') } }])
    expect(result.failedRuleIds).toEqual(['broken']); expect(result.issues[0].message).toContain('rule failed')
  })
})
