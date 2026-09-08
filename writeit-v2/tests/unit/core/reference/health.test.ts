import { describe, expect, it } from 'vitest'
import {
  ReferenceGraph,
  ReferenceHealthService,
  evaluateReferenceHealth,
  parseReferenceAt,
} from '../../../../src/core/reference'
import { createDocumentId, createRevision } from '../../../../src/core/document'

const sourcePath = 'index.md'

function reference(source: string) {
  const parsed = parseReferenceAt(source, 0)
  if (!parsed) throw new Error(`Could not parse ${source}`)
  return parsed
}

describe('reference health', () => {
  it('distinguishes missing paths, missing fragments, and healthy headings', async () => {
    const files = ['index.md', 'guide.md']
    const readFile = async (path: string): Promise<string> =>
      path === 'guide.md' ? '# Getting Started\n\nContent\n' : ''

    const healthy = await evaluateReferenceHealth(reference('[[guide#Getting Started]]'), {
      sourcePath,
      availablePaths: files,
      contentReader: { readFile },
    })
    const missingFragment = await evaluateReferenceHealth(reference('[[guide#Missing]]'), {
      sourcePath,
      availablePaths: files,
      contentReader: { readFile },
    })
    const missingPath = await evaluateReferenceHealth(reference('[[unknown]]'), {
      sourcePath,
      availablePaths: files,
      contentReader: { readFile },
    })

    expect(healthy).toMatchObject({
      status: 'resolved',
      broken: false,
      targetPath: 'guide.md',
      fragmentStatus: 'resolved',
      fragmentTarget: { kind: 'heading', label: 'Getting Started', line: 1 },
    })
    expect(missingFragment).toMatchObject({
      status: 'missing-fragment',
      broken: true,
      targetPath: 'guide.md',
      fragmentStatus: 'missing',
    })
    expect(missingPath).toMatchObject({
      status: 'missing',
      broken: true,
      pathStatus: 'missing',
    })
  })

  it('uses object fragments before heading fallback and exposes diagnostics', async () => {
    const graph = new ReferenceGraph({
      workspacePaths: ['index.md', 'report.md'],
      documents: [
        { id: 'index', path: 'index.md', markdown: '[[report#rows]]', revision: 3 },
        { id: 'report', path: 'report.md', markdown: '# Report\n' },
      ],
    })
    const service = new ReferenceHealthService({
      graph,
      contentReader: { readFile: async () => '# Report\n' },
      objectResolver: () => [
        { kind: 'object', id: 'rows', label: 'Rows', fragment: 'rows' },
      ],
    })

    const snapshot = await service.refresh()
    expect(snapshot.references[0]).toMatchObject({
      sourcePath: 'index.md',
      sourceRevision: createRevision(3),
      status: 'resolved',
      fragmentTarget: { kind: 'object', label: 'Rows' },
    })
    expect(snapshot.broken).toHaveLength(0)
    expect(snapshot.diagnostics).toHaveLength(0)

    graph.indexDocument({
      id: createDocumentId('index'),
      path: 'index.md',
      markdown: '[[report#missing]]',
      revision: 4,
    })
    const next = await service.refresh()
    expect(next.broken).toHaveLength(1)
    expect(next.diagnostics[0]).toMatchObject({
      kind: 'broken-reference',
      sourcePath: 'index.md',
      status: 'missing-fragment',
    })
  })

  it('allows a static object provider to resolve an object without target bytes', async () => {
    const result = await evaluateReferenceHealth(reference('[[report#rows]]'), {
      sourcePath: 'index.md',
      availablePaths: ['index.md', 'report.md'],
      objectResolver: () => [
        { id: 'rows', label: 'Rows' },
      ],
    })

    expect(result).toMatchObject({
      status: 'resolved',
      broken: false,
      fragmentTarget: { kind: 'object', id: 'rows' },
    })
  })

  it('does not count unknown adapter state as a broken reference', async () => {
    const graph = new ReferenceGraph({
      workspacePaths: ['index.md', 'target.md'],
      documents: [{ path: 'index.md', markdown: '[[target]]' }],
    })
    const service = new ReferenceHealthService(graph)
    const snapshot = await service.refresh()

    expect(snapshot.references[0]).toMatchObject({
      status: 'resolved',
      broken: false,
    })
    expect(snapshot.broken).toHaveLength(0)
  })
})
