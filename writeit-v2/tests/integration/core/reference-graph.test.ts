import { describe, expect, it } from 'vitest'
import {
  DocumentStore,
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
} from '../../../src/core/document'
import { ReferenceGraph } from '../../../src/core/reference'

const origin = createDocumentOrigin('user', 'reference-graph-test')

describe('DocumentStore + ReferenceGraph', () => {
  it('updates derived backlinks from Store snapshots without making the graph an authority', () => {
    const store = new DocumentStore()
    const sourceId = createDocumentId('source')
    const targetId = createDocumentId('target')
    const source = store.load({
      id: sourceId,
      path: createDocumentPath('source.md'),
      markdown: '[[target.md]]',
    })
    const target = store.load({
      id: targetId,
      path: createDocumentPath('target.md'),
      markdown: '# target\n',
    })
    const graph = new ReferenceGraph({
      workspacePaths: ['source.md', 'target.md'],
    })

    graph.indexDocument(source)
    graph.indexDocument(target)
    const unsubscribe = store.subscribe(
      documentById(sourceId),
      (event) => graph.indexDocument(event.document),
    )

    expect(graph.getBacklinks('target.md')).toHaveLength(1)
    const changed = store.applyChange(documentById(sourceId), {
      markdown: '[[target.md#Heading]]',
      origin,
    })

    expect(store.get(documentById(sourceId))?.markdown).toBe(
      '[[target.md#Heading]]',
    )
    expect(graph.getBacklinks('target.md')[0]).toMatchObject({
      sourceId,
      fragment: 'Heading',
      sourceRevision: changed.revision,
    })
    expect(graph.getIndex().getByPath('source.md')?.revision).toBe(
      changed.revision,
    )

    unsubscribe()
    store.applyChange(documentById(sourceId), {
      markdown: 'no reference',
      origin,
    })
    expect(graph.getBacklinks('target.md')).toHaveLength(1)
    expect(store.get(documentById(targetId))?.markdown).toBe('# target\n')
  })
})
