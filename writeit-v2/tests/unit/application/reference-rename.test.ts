import { describe, expect, it } from 'vitest'
import {
  DocumentPersistenceService,
  ReferenceRenameConflictError,
  ReferenceRenameTransactionError,
  ReferenceRenameService,
} from '../../../src/application'
import {
  createDocumentId,
  createDocumentPath,
  documentById,
  DocumentStore,
  type DocumentPath,
} from '../../../src/core/document'
import { ReferenceGraph } from '../../../src/core/reference'
import { MemoryFileSystem } from '../../../src/platform/filesystem'

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
    expect(error).toMatchObject({ rollbackAttempted: true, rollbackSucceeded: true })
    expect(fileSystem.hasFile(createDocumentPath('target.md'))).toBe(true)
    expect(fileSystem.hasFile(createDocumentPath('renamed.md'))).toBe(false)
    expect(await fileSystem.readFile(createDocumentPath('source.md'))).toBe(
      '[[target]] [[target#Target]] ![[target.md|ro]] Keep this source exact.\n',
    )
    expect(store.get(documentById(targetId))?.path).toBe('target.md')
    expect(graph.getBacklinks('target.md')).toHaveLength(4)
    expect(graph.getBacklinks('renamed.md')).toHaveLength(0)
  })
})