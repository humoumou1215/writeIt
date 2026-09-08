import { describe, expect, it } from 'vitest'
import {
  DocumentPersistenceService,
  ReferenceRenameConflictError,
  ReferenceRenameTransactionError,
  ReferenceRenameService,
} from '../../../src/application'
import type {
  PersistenceRebindPathOptions,
  PersistenceState,
} from '../../../src/application'
import {
  createDocumentId,
  createDocumentPath,
  documentById,
  DocumentStore,
  type DocumentLocator,
  type DocumentPath,
} from '../../../src/core/document'
import { ReferenceGraph } from '../../../src/core/reference'
import { MemoryFileSystem } from '../../../src/platform/filesystem'
import type { WorkspacePath } from '../../../src/core/workspace'

const targetId = createDocumentId('rename-target')
const sourceId = createDocumentId('rename-source')
const nestedSourceId = createDocumentId('rename-nested-source')

function createRenameFixture(fileSystem: MemoryFileSystem) {
  const store = new DocumentStore()
  const target = store.load({
    id: targetId,
    path: createDocumentPath('target.md'),
    markdown: '# Target\n',
  })
  const source = store.load({
    id: sourceId,
    path: createDocumentPath('source.md'),
    markdown: [
      '[[target]] [[target#Target]] ![[target.md|ro]]',
      'Keep this source exact.\n',
    ].join(' '),
  })
  const nestedSource = store.load({
    id: nestedSourceId,
    path: createDocumentPath('notes/source.md'),
    markdown: 'See [[../target.md]].\n',
  })
  const persistence = new DocumentPersistenceService(store, fileSystem, {
    autoSaveDelayMs: null,
  })
  persistence.track(documentById(targetId), { persistedMarkdown: target.markdown })
  persistence.track(documentById(sourceId), { persistedMarkdown: source.markdown })
  persistence.track(documentById(nestedSourceId), {
    persistedMarkdown: nestedSource.markdown,
  })
  const graph = new ReferenceGraph({
    workspacePaths: ['target.md', 'source.md', 'notes/source.md'],
    documents: [target, source, nestedSource],
  })
  const service = new ReferenceRenameService({
    fileSystem,
    store,
    graph,
    persistence,
  })
  return { store, persistence, graph, service }
}

class FailOnceOnSourceWriteFileSystem extends MemoryFileSystem {
  private failed = false

  override async writeFile(path: DocumentPath, content: string): Promise<void> {
    if (!this.failed && String(path) === 'source.md') {
      this.failed = true
      throw new Error('simulated reference write failure')
    }
    await super.writeFile(path, content)
  }
}

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

class FailOnRollbackRenameFileSystem extends MemoryFileSystem {
  override async renameEntry(
    path: WorkspacePath,
    name: string,
  ): Promise<WorkspacePath> {
    if (String(path) === 'renamed.md' && name === 'target.md') {
      throw new Error('simulated filesystem compensation failure')
    }
    return super.renameEntry(path, name)
  }
}

function createCompensationFixture(
  fileSystem: MemoryFileSystem,
  persistenceClass = DocumentPersistenceService,
) {
  const store = new DocumentStore()
  const target = store.load({
    id: targetId,
    path: createDocumentPath('target.md'),
    markdown: '# Target\n',
  })
  const source = store.load({
    id: sourceId,
    path: createDocumentPath('source.md'),
    markdown: '[[target]]\n',
  })
  const persistence = new persistenceClass(store, fileSystem, {
    autoSaveDelayMs: null,
  })
  persistence.track(documentById(targetId), { persistedMarkdown: target.markdown })
  persistence.track(documentById(sourceId), { persistedMarkdown: source.markdown })
  const graph = new ReferenceGraph({
    workspacePaths: ['target.md', 'source.md'],
    documents: [target, source],
  })
  const unsubscribe = store.subscribe(
    documentById(sourceId),
    (event) => {
      if (event.type === 'changed' || event.type === 'renamed') {
        graph.indexDocument(event.document)
      }
    },
  )
  const service = new ReferenceRenameService({
    fileSystem,
    store,
    graph,
    persistence,
  })
  return { store, persistence, graph, service, unsubscribe }
}

describe('ReferenceRenameService', () => {
  it('updates incoming links, stable Store identity, persistence baselines, and graph backlinks', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'target.md': '# Target\n',
        'source.md': '[[target]] [[target#Target]] ![[target.md|ro]] Keep this source exact.\n',
        'notes/source.md': 'See [[../target.md]].\n',
      },
    })
    const { store, persistence, graph, service } = createRenameFixture(fileSystem)

    const result = await service.rename('target.md', 'renamed.md')

    expect(result).toMatchObject({
      sourcePath: 'target.md',
      targetPath: 'renamed.md',
      renamedDocumentId: targetId,
      updatedReferences: 4,
      updatedDocumentCount: 2,
    })
    expect(await fileSystem.readFile(createDocumentPath('source.md'))).toBe(
      '[[renamed]] [[renamed#Target]] ![[renamed.md|ro]] Keep this source exact.\n',
    )
    expect(await fileSystem.readFile(createDocumentPath('notes/source.md'))).toBe(
      'See [[../renamed.md]].\n',
    )
    expect(fileSystem.hasFile(createDocumentPath('target.md'))).toBe(false)
    expect(fileSystem.hasFile(createDocumentPath('renamed.md'))).toBe(true)
    expect(store.get(documentById(targetId))).toMatchObject({
      id: targetId,
      path: 'renamed.md',
      markdown: '# Target\n',
      dirty: false,
    })
    expect(store.get(documentById(sourceId))).toMatchObject({
      path: 'source.md',
      markdown: '[[renamed]] [[renamed#Target]] ![[renamed.md|ro]] Keep this source exact.\n',
      dirty: false,
    })
    expect(persistence.getState(documentById(targetId))).toMatchObject({
      path: 'renamed.md',
      baselineMarkdown: '# Target\n',
      status: 'clean',
    })
    expect(persistence.getState(documentById(sourceId))).toMatchObject({
      baselineMarkdown: '[[renamed]] [[renamed#Target]] ![[renamed.md|ro]] Keep this source exact.\n',
      status: 'clean',
    })
    expect(graph.getBacklinks('target.md')).toHaveLength(0)
    expect(graph.getBacklinks('renamed.md')).toHaveLength(4)
    expect(graph.getBacklinks('renamed.md').map((edge) => edge.sourcePath)).toEqual([
      'notes/source.md',
      'source.md',
      'source.md',
      'source.md',
    ])
    expect(graph.getIndex().getById(targetId)?.revision).toBe(
      store.get(documentById(targetId))?.revision,
    )
    for (const edge of graph.getBacklinks('renamed.md')) {
      const source = store.get(documentById(edge.sourceId as typeof sourceId))
      expect(edge.sourceRevision).toBe(source?.revision)
    }
  })

  it('rewrites incoming references in unopened workspace documents from the filesystem', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'target.md': '# Target\n',
        'unopened.md': 'See [[target.md#Target]].\n',
      },
    })
    const store = new DocumentStore()
    store.load({
      id: targetId,
      path: createDocumentPath('target.md'),
      markdown: '# Target\n',
    })
    const service = new ReferenceRenameService({ fileSystem, store })

    const result = await service.renameFile('target.md', 'renamed.md')

    expect(result.updatedReferences).toBe(1)
    expect(await fileSystem.readFile(createDocumentPath('unopened.md'))).toBe(
      'See [[renamed.md#Target]].\n',
    )
    expect(store.get(documentById(targetId))?.path).toBe('renamed.md')
  })

  it('updates references when a file is moved to another workspace directory', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'target.md': '# Target\n',
        'source.md': 'See [[target.md]].\n',
      },
      directories: ['archive'],
    })
    const store = new DocumentStore()
    store.load({
      id: targetId,
      path: createDocumentPath('target.md'),
      markdown: '# Target\n',
    })
    const service = new ReferenceRenameService({ fileSystem, store })

    const result = await service.moveFile('target.md', 'archive')

    expect(result).toMatchObject({
      operation: 'move',
      targetPath: 'archive/target.md',
      updatedReferences: 1,
    })
    expect(await fileSystem.readFile(createDocumentPath('source.md'))).toBe(
      'See [[archive/target.md]].\n',
    )
    expect(store.get(documentById(targetId))?.path).toBe('archive/target.md')
  })

  it('rejects an existing target before changing the file or incoming sources', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'target.md': '# old\n',
        'renamed.md': '# already here\n',
        'source.md': '[[target.md]]\n',
        'notes/source.md': 'no link\n',
      },
    })
    const { store, service } = createRenameFixture(fileSystem)

    await expect(service.rename('target.md', 'renamed.md')).rejects.toBeInstanceOf(
      ReferenceRenameConflictError,
    )
    expect(await fileSystem.readFile(createDocumentPath('target.md'))).toBe('# old\n')
    expect(await fileSystem.readFile(createDocumentPath('source.md'))).toBe(
      '[[target.md]]\n',
    )
    expect(store.get(documentById(targetId))?.path).toBe('target.md')
  })

  it('rejects dirty incoming documents instead of persisting over local edits', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'target.md': '# Target\n',
        'source.md': '[[target.md]]\n',
        'notes/source.md': 'See [[../target.md]].\n',
      },
    })
    const { store, service } = createRenameFixture(fileSystem)
    store.applyChange(documentById(sourceId), {
      markdown: 'local [[target.md]] edit\n',
      origin: { kind: 'test', source: 'dirty-rename' },
    })

    await expect(service.rename('target.md', 'renamed.md')).rejects.toMatchObject({
      name: 'ReferenceRenameConflictError',
      conflicts: [
        expect.objectContaining({ kind: 'dirty-document', documentId: sourceId }),
      ],
    })
    expect(fileSystem.hasFile(createDocumentPath('renamed.md'))).toBe(false)
    expect(store.get(documentById(sourceId))?.markdown).toBe(
      'local [[target.md]] edit\n',
    )
  })

  it('rejects an incoming source with an external change before moving the target', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'target.md': '# Target\n',
        'source.md': '[[target.md]]\n',
        'notes/source.md': 'See [[../target.md]].\n',
      },
    })
    const { store, graph, service } = createRenameFixture(fileSystem)
    await fileSystem.writeFile(
      createDocumentPath('source.md'),
      'external [[target.md]]\n',
    )

    await expect(service.rename('target.md', 'renamed.md')).rejects.toMatchObject({
      name: 'ReferenceRenameConflictError',
      conflicts: [
        expect.objectContaining({ kind: 'external-change', path: 'source.md' }),
      ],
    })
    expect(fileSystem.hasFile(createDocumentPath('target.md'))).toBe(true)
    expect(fileSystem.hasFile(createDocumentPath('renamed.md'))).toBe(false)
    expect(store.get(documentById(sourceId))?.markdown).toContain(
      '[[target]]',
    )
    expect(graph.getIndex().getById(sourceId)?.revision).toBe(0)
  })

  it('compensates a reference write failure and leaves the old link graph intact', async () => {
    const fileSystem = new FailOnceOnSourceWriteFileSystem({
      files: {
        'target.md': '# Target\n',
        'source.md': '[[target]] [[target#Target]] ![[target.md|ro]] Keep this source exact.\n',
        'notes/source.md': 'See [[../target.md]].\n',
      },
    })
    const { store, graph, service } = createRenameFixture(fileSystem)

    const error = await service.rename('target.md', 'renamed.md').catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ReferenceRenameTransactionError)
    expect(error).toMatchObject({
      rollbackAttempted: true,
      rollbackSucceeded: true,
      filesystemRollbackSucceeded: true,
      graphRollbackSucceeded: true,
    })
    expect(fileSystem.hasFile(createDocumentPath('target.md'))).toBe(true)
    expect(fileSystem.hasFile(createDocumentPath('renamed.md'))).toBe(false)
    expect(await fileSystem.readFile(createDocumentPath('source.md'))).toBe(
      '[[target]] [[target#Target]] ![[target.md|ro]] Keep this source exact.\n',
    )
    expect(store.get(documentById(targetId))?.path).toBe('target.md')
    expect(graph.getBacklinks('target.md')).toHaveLength(4)
    expect(graph.getBacklinks('renamed.md')).toHaveLength(0)
    for (const edge of graph.getBacklinks('target.md')) {
      const source = store.get(documentById(edge.sourceId as typeof sourceId))
      expect(source).toBeDefined()
      expect(edge.sourceRevision).toBe(source?.revision)
    }
  })

  it('rebuilds graph revisions from the compensated Store and follows a later update', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'target.md': '# Target\n',
        'source.md': '[[target]]\n',
      },
    })
    const { store, graph, service, unsubscribe } = createCompensationFixture(
      fileSystem,
      FailOnceOnSourceRebindPersistence,
    )

    const error = await service.rename('target.md', 'renamed.md').catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ReferenceRenameTransactionError)
    expect(error).toMatchObject({
      rollbackAttempted: true,
      rollbackSucceeded: true,
      storeRollbackSucceeded: true,
      filesystemRollbackSucceeded: true,
      graphRollbackSucceeded: true,
    })

    const compensatedSource = store.get(documentById(sourceId))
    expect(compensatedSource).toMatchObject({
      path: 'source.md',
      markdown: '[[target]]\n',
    })
    expect(compensatedSource?.revision).toBe(2)
    expect(graph.getIndex().getById(sourceId)?.revision).toBe(
      compensatedSource?.revision,
    )
    expect(graph.getBacklinks('target.md')).toHaveLength(1)
    expect(graph.getBacklinks('target.md')[0]?.sourceRevision).toBe(
      compensatedSource?.revision,
    )

    const updated = store.applyChange(documentById(sourceId), {
      markdown: 'No link after compensation\n',
      origin: { kind: 'test', source: 'post-compensation-update' },
      expectedRevision: compensatedSource?.revision,
    })
    expect(graph.getIndex().getById(sourceId)?.revision).toBe(updated.revision)
    expect(graph.getOutgoing(`source.md`)).toHaveLength(0)
    expect(graph.getBacklinks('target.md')).toHaveLength(0)
    unsubscribe()
  })

  it('reports a graph re-sync failure without hiding the Store/filesystem rollback result', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'target.md': '# Target\n',
        'source.md': '[[target]]\n',
      },
    })
    const { store, graph, service, unsubscribe } = createCompensationFixture(
      fileSystem,
      FailOnceOnSourceRebindPersistence,
    )
    const mutableGraph = graph as unknown as {
      rebuild: (documents?: Iterable<unknown>) => unknown
    }
    mutableGraph.rebuild = () => {
      throw new Error('simulated graph re-sync failure')
    }

    const error = await service.rename('target.md', 'renamed.md').catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ReferenceRenameTransactionError)
    expect(error).toMatchObject({
      rollbackAttempted: true,
      rollbackSucceeded: false,
      storeRollbackSucceeded: true,
      filesystemRollbackSucceeded: true,
      graphRollbackSucceeded: false,
      compensationFailures: [
        expect.objectContaining({
          phase: 'graph',
          message: 'simulated graph re-sync failure',
        }),
      ],
    })
    expect(store.get(documentById(sourceId))?.markdown).toBe('[[target]]\n')
    expect(await fileSystem.readFile(createDocumentPath('source.md'))).toBe(
      '[[target]]\n',
    )
    unsubscribe()
  })

  it('keeps graph Store revisions diagnosable when filesystem compensation fails', async () => {
    const fileSystem = new FailOnRollbackRenameFileSystem({
      files: {
        'target.md': '# Target\n',
        'source.md': '[[target]]\n',
      },
    })
    const { store, graph, service, unsubscribe } = createCompensationFixture(
      fileSystem,
      FailOnceOnSourceRebindPersistence,
    )

    const error = await service.rename('target.md', 'renamed.md').catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ReferenceRenameTransactionError)
    expect(error).toMatchObject({
      rollbackAttempted: true,
      rollbackSucceeded: false,
      storeRollbackSucceeded: true,
      filesystemRollbackSucceeded: false,
      graphRollbackSucceeded: true,
      compensationFailures: [
        expect.objectContaining({ phase: 'filesystem' }),
      ],
    })
    const currentSource = store.get(documentById(sourceId))
    expect(currentSource?.revision).toBe(2)
    expect(graph.getIndex().getById(sourceId)?.revision).toBe(
      currentSource?.revision,
    )
    expect(graph.getBacklinks('target.md')[0]?.sourceRevision).toBe(
      currentSource?.revision,
    )
    expect(fileSystem.hasFile(createDocumentPath('renamed.md'))).toBe(true)
    expect(fileSystem.hasFile(createDocumentPath('target.md'))).toBe(false)
    expect(await fileSystem.readFile(createDocumentPath('source.md'))).toBe(
      '[[target]]\n',
    )
    unsubscribe()
  })
})
