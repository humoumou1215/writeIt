import { describe, expect, it } from 'vitest'
import {
  ReferenceGraph,
  ReferenceIndex,
  ReferenceIndexConsistencyError,
  ReferenceIndexValidationError,
  buildReferenceGraph,
  referenceById,
  referenceByPath,
} from '../../../../src/core/reference'
import {
  createDocumentId,
  createRevision,
} from '../../../../src/core/document'

const notesId = createDocumentId('notes-doc')
const homeId = createDocumentId('home-doc')

function document(
  path: string,
  markdown: string,
  id?: string,
  revision?: number,
) {
  return {
    path,
    markdown,
    ...(id === undefined ? {} : { id }),
    ...(revision === undefined ? {} : { revision }),
  }
}

describe('ReferenceIndex', () => {
  it('retains parsed source facts and revision, not a second Markdown authority', () => {
    const index = new ReferenceIndex([
      document('home.md', 'See [[notes#Today]]', homeId, 4),
    ])
    const entry = index.getByPath('home.md')

    expect(entry).toMatchObject({
      sourceId: homeId,
      sourcePath: 'home.md',
      revision: createRevision(4),
    })
    expect(entry?.references).toHaveLength(1)
    expect(entry?.references[0]).toMatchObject({
      raw: '[[notes#Today]]',
      path: 'notes',
      fragment: 'Today',
      from: 4,
    })
    expect(entry && 'markdown' in entry).toBe(false)
    expect(Object.isFrozen(entry)).toBe(true)
    expect(Object.isFrozen(entry?.references)).toBe(true)
  })

  it('updates one document incrementally and keeps id/path conflicts explicit', () => {
    const index = new ReferenceIndex([
      document('home.md', '[[A]]', homeId, 1),
      document('notes.md', '[[home.md]]', notesId, 1),
    ])

    index.indexDocument(document('home.md', '[[B]]', undefined, 2))
    expect(index.getById(homeId)?.references.map((reference) => reference.path)).toEqual([
      'B',
    ])

    index.indexDocument(document('renamed.md', '[[B]]', homeId, 3))
    expect(index.getByPath('home.md')).toBeUndefined()
    expect(index.getById(homeId)?.sourcePath).toBe('renamed.md')

    expect(() =>
      index.indexDocument(document('notes.md', '[[A]]', homeId, 4)),
    ).toThrow(ReferenceIndexConsistencyError)
  })

  it('supports rebuild/remove snapshots through explicit locators', () => {
    const index = new ReferenceIndex()
    index.rebuild([
      document('home.md', '[[notes.md]]', homeId),
      document('notes.md', 'content', notesId),
    ])

    expect(index.get(referenceByPath('home.md'))?.sourceId).toBe(homeId)
    expect(index.get(referenceById(notesId))?.sourcePath).toBe('notes.md')
    expect(index.removeDocument(referenceById(notesId))?.sourcePath).toBe('notes.md')
    expect(index.getByPath('notes.md')).toBeUndefined()
    expect(index.size).toBe(1)

    expect(() => index.getByPath('../outside.md')).toThrow(
      ReferenceIndexValidationError,
    )
  })
})

describe('ReferenceGraph and backlinks', () => {
  it('derives resolved outgoing edges and incoming backlink facts', () => {
    const graph = buildReferenceGraph(
      [
        document(
          'home.md',
          '[[notes#Today]] and ![[notes.md|ro]] and [[missing]]',
          homeId,
          2,
        ),
        document('notes.md', '# Today\n', notesId, 1),
      ],
      {
        workspacePaths: ['home.md', 'notes.md'],
      },
    )

    const outgoing = graph.getOutgoing(referenceById(homeId))
    expect(outgoing).toHaveLength(3)
    expect(outgoing.map((edge) => [edge.kind, edge.status, edge.targetPath])).toEqual([
      ['link', 'resolved', 'notes.md'],
      ['embed', 'resolved', 'notes.md'],
      ['link', 'missing', undefined],
    ])
    expect(outgoing[0]).toMatchObject({
      source: 'home.md',
      fragment: 'Today',
      raw: '[[notes#Today]]',
      sourceRevision: 2,
    })

    const backlinks = graph.getBacklinks('notes.md')
    expect(backlinks).toHaveLength(2)
    expect(backlinks.map((edge) => [edge.sourcePath, edge.kind, edge.readonly])).toEqual([
      ['home.md', 'link', false],
      ['home.md', 'embed', true],
    ])
    expect(graph.getBacklinkSources('notes.md')).toEqual(['home.md'])
    expect(graph.getBrokenReferences()).toHaveLength(1)
  })

  it('resolves explicit relative paths, basename aliases, and ambiguity without false backlinks', () => {
    const graph = new ReferenceGraph({
      workspacePaths: [
        'notes/home.md',
        'notes/target.md',
        'archive/target.md',
      ],
      documents: [
        document(
          'notes/home.md',
          '[[./target]] [[target]] [[../archive/target.md]]',
        ),
      ],
    })

    const outgoing = graph.getOutgoing('notes/home.md')
    expect(outgoing.map((edge) => [edge.status, edge.targetPath])).toEqual([
      ['resolved', 'notes/target.md'],
      ['ambiguous', undefined],
      ['resolved', 'archive/target.md'],
    ])
    expect(graph.getBacklinks('notes/target.md')).toHaveLength(1)
    expect(graph.getBacklinks('archive/target.md')).toHaveLength(1)
  })

  it('rebuilds derived facts after a source update without changing source authority', () => {
    const graph = new ReferenceGraph({
      workspacePaths: ['A.md', 'B.md', 'C.md'],
      documents: [document('A.md', '[[B.md]]', 'a', 1)],
    })

    expect(graph.getBacklinks('B.md')).toHaveLength(1)
    const before = graph.getIndex().getByPath('A.md')

    graph.indexDocument(document('A.md', '[[C.md]]', 'a', 2))

    expect(graph.getBacklinks('B.md')).toHaveLength(0)
    expect(graph.getBacklinks('C.md')).toHaveLength(1)
    expect(graph.getIndex().getByPath('A.md')?.revision).toBe(2)
    expect(before?.references[0].path).toBe('B.md')
  })

  it('keeps unresolved and unindexed targets as graph health facts, not content changes', () => {
    const graph = new ReferenceGraph({
      documents: [document('A.md', '[[B.md]] [[C]]')],
      workspacePaths: ['A.md', 'B.md'],
    })

    expect(graph.getNode('B.md')).toMatchObject({ indexed: false })
    expect(graph.getNode('A.md')).toMatchObject({ indexed: true })
    expect(graph.getEdgesByStatus('resolved')).toHaveLength(1)
    expect(graph.getEdgesByStatus('missing')).toHaveLength(1)
    expect(graph.getBacklinks('B.md')[0].sourcePath).toBe('A.md')
  })
})
