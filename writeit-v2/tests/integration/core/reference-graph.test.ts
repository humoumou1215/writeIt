import { describe, expect, it } from 'vitest'
import {
  DocumentPersistenceService,
  ReferenceRenameService,
  ReferenceRenameTransactionError,
} from '../../../src/application'
import type {
  PersistenceRebindPathOptions,
  PersistenceState,
} from '../../../src/application'
import {
  DocumentStore,
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  type DocumentLocator,
  type DocumentPath,
} from '../../../src/core/document'
import { ReferenceGraph } from '../../../src/core/reference'
import { MemoryFileSystem } from '../../../src/platform/filesystem'

const origin = createDocumentOrigin('user', 'reference-graph-test')

class FailOnceOnSourceRebindPersistence extends DocumentPersistenceService {
  private failed = false

  override rebindPath(
    locator: DocumentLocator,
    path: DocumentPath,
    options: PersistenceRebindPathOptions = {},
  ): PersistenceState {
    if (!this.failed && String(path) === 'source.md') {
      this.failed = true
      throw new Error('simulated Store transaction failure')
    }
    return super.rebindPath(locator, path, options)
  }
}

describe('DocumentStore + ReferenceGraph', () => {
  it('rebuilds rollback graph facts from the current Store revision and accepts the next update', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'target.md': '# target\n',
        'source.md': '[[target]]\n',
      },
    })
    const store = new DocumentStore()
    const targetId = createDocumentId('rollback-target')
    const sourceId = createDocumentId('rollback-source')
    const target = store.load({
      id: targetId,
      path: createDocumentPath('target.md'),
      markdown: '# target\n',
    })
    const source = store.load({
      id: sourceId,
      path: createDocumentPath('source.md'),
      markdown: '[[target]]\n',
    })
    const persistence = new FailOnceOnSourceRebindPersistence(
      store,
      fileSystem,
      { autoSaveDelayMs: null },
    )
    persistence.track(documentById(targetId), { persistedMarkdown: target.markdown })
    persistence.track(documentById(sourceId), { persistedMarkdown: source.markdown })
    const graph = new ReferenceGraph({
      workspacePaths: ['target.md', 'source.md'],
      documents: [target, source],
    })
    const unsubscribe = store.subscribe(documentById(sourceId), (event) => {
      if (event.type === 'changed' || event.type === 'renamed') {
        graph.indexDocument(event.document)
      }
    })
    const service = new ReferenceRenameService({
      fileSystem,
      store,
      graph,
      persistence,
    })

    const error = await service.rename('target.md', 'renamed.md').catch(
      (value: unknown) => value,
    )
    expect(error).toBeInstanceOf(ReferenceRenameTransactionError)
    expect(error).toMatchObject({
      rollbackSucceeded: true,
      storeRollbackSucceeded: true,
      filesystemRollbackSucceeded: true,
      graphRollbackSucceeded: true,
    })

    const compensated = store.get(documentById(sourceId))
    expect(compensated?.revision).toBe(2)
    expect(graph.getIndex().getById(sourceId)?.revision).toBe(
      compensated?.revision,
    )
    expect(graph.getBacklinks('target.md')[0]?.sourceRevision).toBe(
      compensated?.revision,
    )

    const updated = store.applyChange(documentById(sourceId), {
      markdown: 'No reference\n',
      origin,
      expectedRevision: compensated?.revision,
    })
    expect(graph.getIndex().getById(sourceId)?.revision).toBe(updated.revision)
    expect(graph.getBacklinks('target.md')).toHaveLength(0)
    unsubscribe()
  })

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
