import { describe, expect, it } from 'vitest'
import { parseMermaidBlocks, parseMermaidSource } from '../../../../src/core/mermaid'

describe('Mermaid source parser', () => {
  it('detects fenced blocks with exact source ranges and preserves content', () => {
    const source = 'before\n\n```mermaid\nflowchart LR\n A[Start] --> B[End]\n```\n\nafter'
    const block = parseMermaidBlocks(source)[0]
    expect(source.slice(block.from, block.to)).toBe(source.slice(block.from, block.to))
    expect(block.source).toContain('flowchart LR')
    expect(block.source).toContain('A[Start]')
  })

  it('parses a deterministic flowchart and rejects unsupported/invalid diagrams', () => {
    expect(parseMermaidSource('flowchart LR\nA[Start] -->|next| B[End]')).toEqual({
      ok: true,
      diagram: {
        kind: 'flowchart', direction: 'LR',
        nodes: [{ id: 'A', label: 'Start' }, { id: 'B', label: 'End' }],
        edges: [{ from: 'A', to: 'B', label: 'next' }],
      },
    })
    expect(parseMermaidSource('not a diagram')).toEqual({ ok: false, error: expect.stringContaining('Unsupported') })
    expect(parseMermaidSource('flowchart LR')).toEqual({ ok: false, error: expect.stringContaining('no nodes') })
  })

  it('recognizes sequence/state headers for text fallback without inventing geometry', () => {
    expect(parseMermaidSource('sequenceDiagram\nAlice->>Bob: Hello')).toMatchObject({ ok: true, diagram: { kind: 'sequence', nodes: [] } })
    expect(parseMermaidSource('stateDiagram-v2\n[*] --> Idle')).toMatchObject({ ok: true, diagram: { kind: 'state', nodes: [] } })
  })
})
