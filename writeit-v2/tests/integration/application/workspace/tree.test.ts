import { describe, expect, it } from 'vitest'
import {
  createWorkspacePath,
  findWorkspaceNode,
} from '../../../../src/core/workspace'
import type { WorkspacePath } from '../../../../src/core/workspace'
import { ReferenceGraph } from '../../../../src/core/reference'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import {
  DocumentPersistenceService,
  WorkspaceDirectoryOperationBlockedError,
  WorkspaceDirectorySafetyCheckError,
  WorkspaceRecoveryStore,
  WorkspaceTabManager,
  WorkspaceTreeService,
} from '../../../../src/application/workspace'
import {
  MemoryFileSystem,
  WorkspaceInvalidOperationError,
} from '../../../../src/platform/filesystem'
import { MemorySettingsStorage } from '../../../../src/platform/settings'

const root = createWorkspacePath('')

function childPaths(service: WorkspaceTreeService): readonly string[] {
  return service.getTree().root.children.map((child) => child.path)
}

class MutationTrackingFileSystem extends MemoryFileSystem {
  renameCalls = 0
  moveCalls = 0

  override async renameEntry(
    path: WorkspacePath,
    name: string,
  ): Promise<WorkspacePath> {
    this.renameCalls += 1
    return super.renameEntry(path, name)
  }

  override async moveEntry(
    source: WorkspacePath,
    destinationDirectory: WorkspacePath,
  ): Promise<WorkspacePath> {
    this.moveCalls += 1
    return super.moveEntry(source, destinationDirectory)
  }
}

describe('WorkspaceTreeService', () => {
  it('refreshes a recursive, deterministic projection of the filesystem', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'welcome.md': '# welcome\n',
        'notes/deep/todo.md': 'todo\n',
      },
      directories: ['empty'],
    })
    const service = new WorkspaceTreeService(fileSystem)
    const generations: number[] = []
    service.subscribe((snapshot) => generations.push(snapshot.revision))

    const snapshot = await service.refresh()

    expect(snapshot.revision).toBe(1)
    expect(generations).toEqual([1])
    expect(childPaths(service)).toEqual(['empty', 'notes', 'welcome.md'])
    expect(
      findWorkspaceNode(snapshot.tree, createWorkspacePath('notes/deep/todo.md')),
    ).toMatchObject({ kind: 'file', name: 'todo.md' })
    expect(findWorkspaceNode(snapshot.tree, root)?.kind).toBe('directory')
  })

  it('publishes only after successful create, rename, move and delete operations', async () => {
    const fileSystem = new MemoryFileSystem({
      files: { 'notes/todo.md': 'todo\r\n' },
      directories: ['archive'],
    })
    const service = new WorkspaceTreeService(fileSystem)
    await service.refresh()
    const revisions: number[] = []
    service.subscribe(({ revision }) => revisions.push(revision))

    const folder = await service.createDirectory(root, 'drafts')
    const created = await service.createFile(folder, 'new.md', 'new\n')
    expect(created).toBe('drafts/new.md')

    const renamed = await service.rename(created, 'renamed.md')
    expect(renamed).toBe('drafts/renamed.md')
    const moved = await service.move(
      renamed,
      createWorkspacePath('archive'),
    )
    expect(moved).toBe('archive/renamed.md')
    await service.delete(createWorkspacePath('archive'))

    expect(revisions).toEqual([2, 3, 4, 5, 6])
    expect(fileSystem.hasFile(createDocumentPath('drafts/renamed.md'))).toBe(false)
    expect(findWorkspaceNode(service.getTree(), createWorkspacePath('archive'))).toBeUndefined()
  })

  it('keeps the previous tree on failed mutations and rejects paths outside the root', async () => {
    const fileSystem = new MemoryFileSystem({
      files: { 'workspace/notes/todo.md': 'todo' },
    })
    const service = new WorkspaceTreeService(fileSystem, {
      rootPath: 'workspace',
    })
    await service.refresh()
    const before = service.getSnapshot()

    await expect(
      service.createFile(createWorkspacePath('workspace/missing'), 'new.md'),
    ).rejects.toThrow()
    expect(service.getSnapshot()).toBe(before)

    await expect(
      service.move(
        createWorkspacePath('workspace/notes/todo.md'),
        createWorkspacePath('outside'),
      ),
    ).rejects.toBeInstanceOf(WorkspaceInvalidOperationError)
    expect(service.getSnapshot()).toBe(before)
  })

  it('blocks directory rename and move before changing any bound state', async () => {
    const fileSystem = new MutationTrackingFileSystem({
      files: {
        'notes/deep/draft.md': 'draft\n',
        'notes/deep/more/clean.md': 'clean\n',
      },
      directories: ['archive'],
    })
    const store = new DocumentStore()
    const dirty = store.load({
      id: createDocumentId('directory-dirty'),
      path: createDocumentPath('notes/deep/draft.md'),
      markdown: 'draft\n',
    })
    const clean = store.load({
      id: createDocumentId('directory-clean'),
      path: createDocumentPath('notes/deep/more/clean.md'),
      markdown: 'clean\n',
    })
    const dirtyLocator = documentById(dirty.id)
    const cleanLocator = documentById(clean.id)
    const persistence = new DocumentPersistenceService(store, fileSystem, {
      autoSaveDelayMs: null,
    })
    persistence.track(dirtyLocator, { persistedMarkdown: dirty.markdown })
    persistence.track(cleanLocator, { persistedMarkdown: clean.markdown })
    store.applyChange(dirtyLocator, {
      markdown: 'local draft\n',
      origin: createDocumentOrigin('test', 'directory-safety'),
    })

    const tabs = new WorkspaceTabManager()
    tabs.open(dirty.id)
    tabs.open(clean.id)
    const recoveryStorage = new MemorySettingsStorage()
    const recovery = new WorkspaceRecoveryStore(recoveryStorage, {
      workspacePath: root,
    })
    recovery.record({
      workspacePath: root,
      openDocumentPaths: [dirty.path, clean.path],
      activeDocumentPath: dirty.path,
      selectedWorkspacePath: createWorkspacePath('notes'),
    })
    const service = new WorkspaceTreeService(fileSystem, {
      getOpenDocuments: () =>
        store.getAll().map((document) => ({
          documentId: document.id,
          path: document.path,
          dirty: document.dirty,
        })),
      getRecoveryPaths: () => recovery.getSnapshot().openDocumentPaths,
    })
    await service.refresh()
    const beforeTree = service.getSnapshot()
    const beforeFiles = fileSystem.snapshot()
    const beforeDirectories = fileSystem.snapshotDirectories()
    const beforeDirty = store.get(dirtyLocator)
    const beforeClean = store.get(cleanLocator)
    const beforeTabs = tabs.getSnapshot()
    const beforeDirtyPersistence = persistence.getState(dirtyLocator)
    const beforeCleanPersistence = persistence.getState(cleanLocator)
    const beforeRecovery = recovery.getSnapshot()
    const beforeRecoveryStorage = recoveryStorage.read(
      'writeit-v2.workspace-recovery',
    )
    const refreshRevisions: number[] = []
    service.subscribe(({ revision }) => refreshRevisions.push(revision))

    const renameError = await service
      .rename(createWorkspacePath('notes'), 'renamed')
      .catch((error: unknown) => error)
    expect(renameError).toBeInstanceOf(WorkspaceDirectoryOperationBlockedError)
    expect(renameError).toMatchObject({
      operation: 'rename',
      sourcePath: 'notes',
      targetPath: 'renamed',
      reason: 'open-document-path-binding',
      affectedDocuments: [
        {
          documentId: dirty.id,
          path: 'notes/deep/draft.md',
          dirty: true,
        },
        {
          documentId: clean.id,
          path: 'notes/deep/more/clean.md',
          dirty: false,
        },
      ],
    })
    expect((renameError as Error).message).toContain('DocumentStore')
    expect((renameError as Error).message).toContain('dirty')

    const moveError = await service
      .move(createWorkspacePath('notes'), createWorkspacePath('archive'))
      .catch((error: unknown) => error)
    expect(moveError).toBeInstanceOf(WorkspaceDirectoryOperationBlockedError)
    expect(moveError).toMatchObject({
      operation: 'move',
      sourcePath: 'notes',
      targetPath: 'archive/notes',
    })

    expect(fileSystem.renameCalls).toBe(0)
    expect(fileSystem.moveCalls).toBe(0)
    expect(fileSystem.snapshot()).toEqual(beforeFiles)
    expect(fileSystem.snapshotDirectories()).toEqual(beforeDirectories)
    expect(service.getSnapshot()).toBe(beforeTree)
    expect(refreshRevisions).toEqual([])
    expect(store.get(dirtyLocator)).toBe(beforeDirty)
    expect(store.get(cleanLocator)).toBe(beforeClean)
    expect(store.getRevision(dirtyLocator)).toBe(dirty.revision + 1)
    expect(store.getRevision(cleanLocator)).toBe(clean.revision)
    expect(tabs.getSnapshot()).toBe(beforeTabs)
    expect(persistence.getState(dirtyLocator)).toEqual(beforeDirtyPersistence)
    expect(persistence.getState(cleanLocator)).toEqual(beforeCleanPersistence)
    expect(recovery.getSnapshot()).toBe(beforeRecovery)
    expect(recoveryStorage.read('writeit-v2.workspace-recovery')).toBe(
      beforeRecoveryStorage,
    )
  })

  it('fails closed when a directory binding snapshot cannot be read', async () => {
    const fileSystem = new MutationTrackingFileSystem({
      files: { 'notes/open.md': 'open\n' },
    })
    const service = new WorkspaceTreeService(fileSystem, {
      getOpenDocuments: () => {
        throw new Error('binding provider unavailable')
      },
    })
    await service.refresh()
    const beforeTree = service.getSnapshot()
    const beforeFiles = fileSystem.snapshot()

    const error = await service
      .rename(createWorkspacePath('notes'), 'renamed')
      .catch((value: unknown) => value)
    expect(error).toBeInstanceOf(WorkspaceDirectorySafetyCheckError)
    expect((error as Error).message).toContain('binding provider unavailable')
    expect(fileSystem.renameCalls).toBe(0)
    expect(fileSystem.snapshot()).toEqual(beforeFiles)
    expect(service.getSnapshot()).toBe(beforeTree)
  })

  it('protects a recovery-only nested path before it can become stale', async () => {
    const fileSystem = new MutationTrackingFileSystem({
      directories: ['notes', 'notes/deep'],
    })
    const recoveryStorage = new MemorySettingsStorage()
    const recovery = new WorkspaceRecoveryStore(recoveryStorage, {
      workspacePath: root,
    })
    recovery.record({
      workspacePath: root,
      openDocumentPaths: ['notes/deep/restored.md'],
      activeDocumentPath: 'notes/deep/restored.md',
    })
    const service = new WorkspaceTreeService(fileSystem, {
      getOpenDocuments: () => [],
      getRecoveryPaths: () => recovery.getSnapshot().openDocumentPaths,
    })
    await service.refresh()
    const beforeTree = service.getSnapshot()
    const beforeRecovery = recovery.getSnapshot()
    const beforeStorage = recoveryStorage.read(
      'writeit-v2.workspace-recovery',
    )

    const error = await service
      .rename(createWorkspacePath('notes'), 'renamed')
      .catch((value: unknown) => value)
    expect(error).toBeInstanceOf(WorkspaceDirectoryOperationBlockedError)
    expect(error).toMatchObject({
      affectedDocuments: [],
      affectedRecoveryPaths: ['notes/deep/restored.md'],
    })
    expect(fileSystem.renameCalls).toBe(0)
    expect(service.getSnapshot()).toBe(beforeTree)
    expect(recovery.getSnapshot()).toBe(beforeRecovery)
    expect(recoveryStorage.read('writeit-v2.workspace-recovery')).toBe(
      beforeStorage,
    )
  })

  it('preserves existing directory rename and move behavior when no binding is affected', async () => {
    const fileSystem = new MutationTrackingFileSystem({
      files: { 'outside.md': 'outside\n' },
      directories: ['empty', 'archive'],
    })
    const store = new DocumentStore()
    const outside = store.load({
      id: createDocumentId('directory-outside'),
      path: createDocumentPath('outside.md'),
      markdown: 'outside\n',
    })
    const service = new WorkspaceTreeService(fileSystem, {
      getOpenDocuments: () => [
        { documentId: outside.id, path: outside.path, dirty: outside.dirty },
      ],
    })
    await service.refresh()

    await expect(
      service.rename(createWorkspacePath('empty'), 'renamed'),
    ).resolves.toBe('renamed')
    await expect(
      service.move(createWorkspacePath('renamed'), createWorkspacePath('archive')),
    ).resolves.toBe('archive/renamed')

    expect(fileSystem.renameCalls).toBe(1)
    expect(fileSystem.moveCalls).toBe(1)
    expect(fileSystem.hasDirectory(createWorkspacePath('archive/renamed'))).toBe(true)
    expect(findWorkspaceNode(service.getTree(), createWorkspacePath('empty'))).toBeUndefined()
  })

  it('does not block a same-path directory no-op even when it contains an open document', async () => {
    const fileSystem = new MutationTrackingFileSystem({
      files: { 'notes/open.md': 'open\n' },
    })
    const store = new DocumentStore()
    const document = store.load({
      id: createDocumentId('directory-no-op'),
      path: createDocumentPath('notes/open.md'),
      markdown: 'open\n',
    })
    const service = new WorkspaceTreeService(fileSystem, {
      getOpenDocuments: () => [
        { documentId: document.id, path: document.path, dirty: document.dirty },
      ],
    })
    await service.refresh()

    await expect(
      service.move(createWorkspacePath('notes'), createWorkspacePath('notes')),
    ).resolves.toBe('notes')
    expect(fileSystem.moveCalls).toBe(1)
    expect(fileSystem.hasFile(createDocumentPath('notes/open.md'))).toBe(true)
  })

  it('routes tree deletion through the dirty-aware application service', async () => {
    const fileSystem = new MutationTrackingFileSystem({
      files: {
        'notes/deep/open.md': 'open on disk\n',
        'notes/deep/other.md': 'other on disk\n',
      },
    })
    const store = new DocumentStore()
    const open = store.load({
      id: createDocumentId('tree-delete-open'),
      path: createDocumentPath('notes/deep/open.md'),
      markdown: 'open on disk\n',
    })
    const other = store.load({
      id: createDocumentId('tree-delete-other'),
      path: createDocumentPath('notes/deep/other.md'),
      markdown: 'other on disk\n',
    })
    const persistence = new DocumentPersistenceService(store, fileSystem, {
      autoSaveDelayMs: null,
    })
    persistence.track(documentById(open.id), { persistedMarkdown: open.markdown })
    persistence.track(documentById(other.id), { persistedMarkdown: other.markdown })
    store.applyChange(documentById(open.id), {
      markdown: 'unsaved open\n',
      origin: createDocumentOrigin('test', 'tree-delete'),
    })
    const tabs = new WorkspaceTabManager([open.id, other.id])
    const graph = new ReferenceGraph({
      documents: [open, other],
      workspacePaths: ['notes/deep/open.md', 'notes/deep/other.md'],
    })
    let decision: 'save' | 'discard' | 'cancel' = 'cancel'
    const service = new WorkspaceTreeService(fileSystem, {
      deletion: {
        store,
        tabs,
        persistence,
        referenceGraph: graph,
        resolveDirty: () => decision,
      },
    })
    await service.refresh()
    const beforeTree = service.getSnapshot()
    const beforeStore = store.get(documentById(open.id))

    const cancelled = await service.delete(createWorkspacePath('notes'))
    expect(cancelled).toMatchObject({ deleted: false, decision: 'cancel' })
    expect(fileSystem.hasEntry(createWorkspacePath('notes'))).toBe(true)
    expect(service.getSnapshot()).toBe(beforeTree)
    expect(store.get(documentById(open.id))).toBe(beforeStore)
    expect(tabs.getSnapshot().tabs).toHaveLength(2)

    decision = 'discard'
    const deleted = await service.delete(createWorkspacePath('notes'))
    expect(deleted).toMatchObject({ deleted: true, decision: 'discard' })
    expect(fileSystem.hasEntry(createWorkspacePath('notes'))).toBe(false)
    expect(store.getAll()).toEqual([])
    expect(tabs.getSnapshot().tabs).toEqual([])
    expect(persistence.getTrackedDocumentIds()).toEqual([])
    expect(graph.getIndex().getAll()).toEqual([])
  })
})
