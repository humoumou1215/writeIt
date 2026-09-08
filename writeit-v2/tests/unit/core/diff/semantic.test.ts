import { describe, expect, it } from 'vitest'
import { buildDiffRenderModel, diffMarkdownSource, diffMermaidDiagrams } from '../../../../src/core/diff'

describe('semantic diff enhancement', () => {
  it('reports stable Mermaid flowchart node/edge additions and removals', () => {
    const before = 'flowchart LR\nA[Start] --> B[End]'
    const after = 'flowchart LR\nA[Start] --> D[Done]'
    const result = diffMermaidDiagrams(before, after)
    expect(result.removedNodes).toEqual(['B'])
    expect(result.addedNodes).toEqual(['D'])
    expect(result.removedEdges).toEqual(['A->B'])
    expect(result.addedEdges).toEqual(['A->D'])
  })

  it('falls back to raw source when enhancement fails', () => {
    const raw = diffMarkdownSource('before', 'after')
    const model = buildDiffRenderModel(raw, () => { throw new Error('semantic parser failed') })
    expect(model.kind).toBe('raw')
    expect(model.degradedReason).toContain('semantic parser failed')
    expect(model.raw.rawChangeCount).toBe(model.raw.representedChangeCount)
  })
})
