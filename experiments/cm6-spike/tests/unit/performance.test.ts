import { ChangeSet } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { DocumentStore } from '../../src/core/document-store'
import { parseTables, serializeTable } from '../../src/table/core'

describe('Spike pressure scenarios', () => {
  it('propagates one edit from a 10,000-line Markdown document to 10 projections', () => {
    const markdown = Array.from({ length: 10_000 }, (_, index) => `line ${index}`).join('\n')
    const store = new DocumentStore({ 'large.md': markdown })
    let updates = 0
    for (let index = 0; index < 10; index++) store.subscribe('large.md', `projection-${index}`, () => updates++)
    const start = performance.now()
    store.applyChanges(
      'large.md',
      { fromRevision: 1, changes: ChangeSet.of({ from: markdown.length, insert: '\nlast edit' }, markdown.length) },
      'projection-0',
    )
    const elapsed = performance.now() - start
    expect(updates).toBe(10)
    expect(store.get('large.md').markdown.endsWith('last edit')).toBe(true)
    expect(elapsed).toBeLessThan(500)
  })

  it('parses and serializes a 100 by 20 Markdown table as a derived model', () => {
    const header = `| ${Array.from({ length: 20 }, (_, index) => `H${index}`).join(' | ')} |`
    const divider = `| ${Array.from({ length: 20 }, () => '---').join(' | ')} |`
    const rows = Array.from({ length: 100 }, (_, row) => `| ${Array.from({ length: 20 }, (_, column) => `${row}-${column}`).join(' | ')} |`)
    const source = [header, divider, ...rows].join('\n') + '\n'
    const start = performance.now()
    const model = parseTables(source)[0]
    const serialized = serializeTable(model)
    const elapsed = performance.now() - start
    expect(model.rows).toHaveLength(101)
    expect(model.alignment).toHaveLength(20)
    expect(serialized).toContain('| 99-19 |')
    expect(elapsed).toBeLessThan(500)
  })
})
