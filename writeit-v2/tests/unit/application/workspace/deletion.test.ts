import { describe, expect, it } from 'vitest'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import type { DocumentPath } from '../../../../src/core/document'
import { createWorkspacePath } from '../../../../src/core/workspace'
import type { WorkspacePath } from '../../../../src/core/workspace'
import { ReferenceGraph } from '../../../../src/core/reference'
import {
  DocumentPersistenceService,
  PersistenceDeletionSaveError,
  type PersistenceScheduler,
} from '../../../../src/application/persistence'
import {
  WorkspaceDeletionService,
  type WorkspaceDeletionDecision,
} from '../../../../src/application/workspace'
import {
  MemoryFileSystem,
} from '../../../../src/platform/filesystem'
import type { WorkspaceDeleteOptions as PlatformWorkspaceDeleteOptions } from '../../../../src/platform/filesystem'
import { MemorySettingsStorage } from '../../../../src/platform/settings'
import {
  WorkspaceRecoveryStore,
  WorkspaceTabManager,
} from '../../../../src/application/workspace'

class FailOnceFileSystem extends MemoryFileSystem {
  constructor(
    initial: ConstructorParameters<typeof MemoryFileSystem>[0],
    private readonly failPath: string,
  ) {
    super(initial)
  }

  override async writeFile(path: DocumentPath, content: string): Promise<void> {
    if (path === this.failPath) {
      throw new Error(`write failed for ${this.failPath}`)
    }
    await super.writeFile(path, content)
  }
}

class FailDeleteFileSystem extends MemoryFileSystem {
  override async deleteEntry(
    _path: WorkspacePath,
    _options?: PlatformWorkspaceDeleteOptions,
  ): Promise<void> {
    throw new Error('recursive delete failed')
  }
}

class ManualScheduler implements PersistenceScheduler {
  private nextHandle = 0
  private readonly callbacks = new Map<number, () => void>()

  set(callback: () => void): number {
    const handle = ++this.nextHandle
    this.callbacks.set(handle, callback)
    return handle
  }

  clear(handle: unknown): void {
    this.callbacks.delete(handle as number)
  }

  runAll(): void {
    for (const callback of [...this.callbacks.values()]) callback()
    this.callbacks.clear()
  }
}

interface Harness {
  readonly fileSystem: MemoryFileSystem
  readonly store: DocumentStore
  readonly persistence: DocumentPersistenceService
  readonly tabs: WorkspaceTabManager
  readonly recovery: WorkspaceRecoveryStore
  readonly recoveryStorage: MemorySettingsStorage
  readonly graph: ReferenceGraph
  readonly service: WorkspaceDeletionService
  readonly dirtyId: ReturnType<typeof createDocumentId>
  readonly cleanId: ReturnType<typeof createDocumentId>
  readonly choose: (decision: WorkspaceDeletionDecision) => void
  readonly destroyed: string[]
}

function createHarness(
  fileSystem: MemoryFileSystem = new MemoryFileSystem({
    files: {
      'notes/deep/dirty.md': 'dirty on disk\n',
      'notes/deep/clean.md': 'clean on disk\n',
      'outside.md': 'outside\n',
    },
  }),
): Harness {
  const store = new DocumentStore()
  const dirtyId = createDocumentId('deletion-dirty')
  const cleanId = createDocumentId('deletion-clean')
  const dirty = store.load({
    id: dirtyId,
    path: createDocumentPath('notes/deep/dirty.md'),
    markdown: 'dirty on disk\n',
  })
  const clean = store.load({
    id: cleanId,
    path: createDocumentPath('notes/deep/clean.md'),
    markdown: 'clean on disk\n',
  })
  const scheduler = new ManualScheduler()
  const persistence = new DocumentPersistenceService(store, fileSystem, {
    autoSaveDelayMs: 500,
    scheduler,
  })
  persistence.track(documentById(dirty.id), { persistedMarkdown: dirty.markdown })
  persistence.track(documentById(clean.id), { persistedMarkdown: clean.markdown })
  store.applyChange(documentById(dirty.id), {
    markdown: 'local dirty Markdown\n',
    origin: createDocumentOrigin('test', 'deletion'),
  })

  const tabs = new WorkspaceTabManager()
  tabs.open(dirty.id)
  tabs.open(clean.id)

  const recoveryStorage = new MemorySettingsStorage()
  const recovery = new WorkspaceRecoveryStore(recoveryStorage, {
    workspacePath: '',
  })
  recovery.record({
    workspacePath: '',
    openDocumentPaths: [dirty.path, clean.path],
    activeDocumentPath: dirty.path,
    selectedWorkspacePath: 'notes',
  })

  const graph = new ReferenceGraph({
    documents: [dirty, clean],
    workspacePaths: ['notes/deep/dirty.md', 'notes/deep/clean.md', 'outside.md'],
  })
  const destroyed: string[] = []
  const pendingDecision: {
    resolve: ((decision: WorkspaceDeletionDecision) => void) | undefined
    queued: WorkspaceDeletionDecision | undefined
  } = {
    resolve: undefined,
    queued: undefined,
  }
  const service = new WorkspaceDeletionService({
    fileSystem,
    store,
    tabs,
    persistence,
    recovery,
    referenceGraph: graph,
    getProjectionBindings: () => [
      {
        documentId: dirty.id,
        projectionId: 'editor',
        destroy: () => {
          destroyed.push('editor')
          store.detachProjection(documentById(dirty.id), 'editor')
        },
      },
    ],
    resolveDirty: async () => {
      if (pendingDecision.queued !== undefined) {
        const decision = pendingDecision.queued
        pendingDecision.queued = undefined
        return decision
      }
      return new Promise<WorkspaceDeletionDecision>((resolve) => {
        pendingDecision.resolve = resolve
      })
    },
  })
  store.attachProjection(documentById(dirty.id), 'editor')

  return {
    fileSystem,
    store,
    persistence,
    tabs,
    recovery,
    recoveryStorage,
    graph,
    service,
    dirtyId,
    cleanId,
    choose: (decision) => {
      if (pendingDecision.resolve) {
        const resolve = pendingDecision.resolve
        pendingDecision.resolve = undefined
        resolve(decision)
      } else {
        pendingDecision.queued = decision
      }
    },
    destroyed,
  }
}

describe('WorkspaceDeletionService', () => {
  it('plans every nested runtime binding and leaves all state unchanged on Cancel', async () => {
    const harness = createHarness()
    const beforeDirty = harness.store.get(documentById(harness.dirtyId))
    const beforeClean = harness.store.get(documentById(harness.cleanId))
    const beforeTabs = harness.tabs.getSnapshot()
    const beforeRecovery = harness.recovery.getSnapshot()
    const beforeRecoveryStorage = harness.recoveryStorage.read(
      'writeit-v2.workspace-recovery',
    )
    const beforeGraph = harness.graph.getSnapshot()
    const beforeDirtyPersistence = harness.persistence.getState(
      documentById(harness.dirtyId),
    )

    const planPromise = harness.service.delete('notes')
    await Promise.resolve()
    harness.choose('cancel')
    const result = await planPromise

    expect(result).toMatchObject({ deleted: false, decision: 'cancel' })
    expect(result.plan.documents).toMatchObject([
      { documentId: harness.cleanId, path: 'notes/deep/clean.md', dirty: false },
      { documentId: harness.dirtyId, path: 'notes/deep/dirty.md', dirty: true },
    ])
    expect(result.plan.tabs.map((tab) => tab.documentId)).toEqual([
      harness.dirtyId,
      harness.cleanId,
    ])
    expect(result.plan.projections).toEqual([
      expect.objectContaining({ documentId: harness.dirtyId, projectionId: 'editor' }),
    ])
    expect(result.plan.persistenceRegistrations).toEqual([
      harness.cleanId,
      harness.dirtyId,
    ].sort())
    expect(result.plan.recoveryPaths).toEqual([
      'notes',
      'notes/deep/clean.md',
      'notes/deep/dirty.md',
    ])
    expect(harness.fileSystem.hasFile(createDocumentPath('notes/deep/dirty.md'))).toBe(true)
    expect(harness.store.get(documentById(harness.dirtyId))).toBe(beforeDirty)
    expect(harness.store.get(documentById(harness.cleanId))).toBe(beforeClean)
    expect(harness.store.getProjections(documentById(harness.dirtyId))).toHaveLength(1)
    expect(harness.tabs.getSnapshot()).toBe(beforeTabs)
    expect(harness.persistence.getState(documentById(harness.dirtyId))).toEqual(
      beforeDirtyPersistence,
    )
    expect(harness.recovery.getSnapshot()).toBe(beforeRecovery)
    expect(harness.recoveryStorage.read('writeit-v2.workspace-recovery')).toBe(
      beforeRecoveryStorage,
    )
    expect(harness.graph.getSnapshot()).toEqual(beforeGraph)
    expect(harness.destroyed).toEqual([])
  })

  it('supports Save and removes nested Documents, projections, tabs, persistence and graph facts', async () => {
    const harness = createHarness()
    const deletion = harness.service.delete('notes')
    await Promise.resolve()
    harness.choose('save')
    const result = await deletion

    expect(result.deleted).toBe(true)
    expect(result.decision).toBe('save')
    expect(harness.fileSystem.hasEntry(createWorkspacePath('notes'))).toBe(false)
    expect(harness.store.getAll()).toEqual([])
    expect(harness.tabs.getSnapshot().tabs).toEqual([])
    expect(harness.tabs.getSnapshot().activeDocumentId).toBeNull()
    expect(harness.persistence.getTrackedDocumentIds()).toEqual([])
    expect(harness.graph.getIndex().getAll()).toEqual([])
    expect(harness.graph.getWorkspacePaths()).toEqual(['outside.md'])
    expect(harness.recovery.getSnapshot().openDocumentPaths).toEqual([])
    expect(harness.recovery.getSnapshot().activeDocumentPath).toBeNull()
    expect(harness.recovery.getSnapshot().selectedWorkspacePath).toBeNull()
    expect(harness.destroyed).toEqual(['editor'])
    expect(await harness.fileSystem.readFile(createDocumentPath('outside.md'))).toBe(
      'outside\n',
    )
  })

  it('discards dirty Markdown without mutating Store before filesystem deletion', async () => {
    const harness = createHarness()
    const deletion = harness.service.delete('notes')
    await Promise.resolve()
    harness.choose('discard')
    const result = await deletion

    expect(result.deleted).toBe(true)
    expect(result.decision).toBe('discard')
    expect(harness.fileSystem.hasEntry(createWorkspacePath('notes'))).toBe(false)
    expect(harness.store.getAll()).toEqual([])
  })

  it('rolls back earlier guarded saves when a later dirty file cannot be saved', async () => {
    const fileSystem = new FailOnceFileSystem(
      {
        files: {
          'notes/deep/dirty.md': 'dirty on disk\n',
          'notes/deep/clean.md': 'clean on disk\n',
        },
      },
      'notes/deep/dirty.md',
    )
    const harness = createHarness(fileSystem)
    // Make the alphabetically later dirty target fail after an earlier dirty
    // target was written. The filesystem deletion must never start.
    harness.store.applyChange(documentById(harness.cleanId), {
      markdown: 'local second dirty Markdown\n',
      origin: createDocumentOrigin('test', 'deletion-second'),
    })
    const before = harness.store.get(documentById(harness.dirtyId))
    const beforeSecond = harness.store.get(documentById(harness.cleanId))
    const beforePersistence = harness.persistence.getState(
      documentById(harness.dirtyId),
    )
    const beforeSecondPersistence = harness.persistence.getState(
      documentById(harness.cleanId),
    )

    const deletion = harness.service.delete('notes')
    await Promise.resolve()
    harness.choose('save')
    const error = await deletion.catch((value: unknown) => value)

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ phase: 'save' })
    expect((error as WorkspaceDeletionSaveErrorLike).cause).toBeInstanceOf(
      PersistenceDeletionSaveError,
    )
    expect(fileSystem.hasEntry(createWorkspacePath('notes'))).toBe(true)
    expect(await fileSystem.readFile(createDocumentPath('notes/deep/dirty.md'))).toBe(
      'dirty on disk\n',
    )
    expect(harness.store.get(documentById(harness.dirtyId))).toBe(before)
    expect(harness.store.get(documentById(harness.cleanId))).toBe(beforeSecond)
    expect(harness.persistence.getState(documentById(harness.dirtyId))).toEqual(
      beforePersistence,
    )
    expect(harness.persistence.getState(documentById(harness.cleanId))).toEqual(
      beforeSecondPersistence,
    )
    expect(harness.tabs.getSnapshot().tabs).toHaveLength(2)
  })

  it('rolls back guarded Save writes when filesystem deletion fails', async () => {
    const harness = createHarness(new FailDeleteFileSystem({
      files: {
        'notes/deep/dirty.md': 'dirty on disk\n',
        'notes/deep/clean.md': 'clean on disk\n',
        'outside.md': 'outside\n',
      },
    }))
    const beforeDocument = harness.store.get(documentById(harness.dirtyId))
    const beforePersistence = harness.persistence.getState(
      documentById(harness.dirtyId),
    )

    const deletion = harness.service.delete('notes')
    await Promise.resolve()
    harness.choose('save')
    const error = await deletion.catch((value: unknown) => value)

    expect(error).toMatchObject({ phase: 'filesystem' })
    expect(harness.fileSystem.hasEntry(createWorkspacePath('notes'))).toBe(true)
    expect(await harness.fileSystem.readFile(createDocumentPath('notes/deep/dirty.md'))).toBe(
      'dirty on disk\n',
    )
    expect(harness.store.get(documentById(harness.dirtyId))).toBe(beforeDocument)
    expect(harness.persistence.getState(documentById(harness.dirtyId))).toEqual(
      beforePersistence,
    )
    expect(harness.tabs.getSnapshot().tabs).toHaveLength(2)
  })

  it('cancels pending autosave registrations so deletion cannot resurrect a file', async () => {
    const harness = createHarness()
    const deletion = harness.service.delete('notes')
    await Promise.resolve()
    harness.choose('discard')
    await deletion

    expect(harness.persistence.getTrackedDocumentIds()).toEqual([])
    expect(harness.fileSystem.hasEntry(createWorkspacePath('notes'))).toBe(false)
  })

  it('uses the same application entry for an unopened file and recursive directory', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'single.md': 'single\n',
        'folder/nested.md': 'nested\n',
      },
    })
    const service = new WorkspaceDeletionService({ fileSystem })

    const fileResult = await service.delete('single.md')
    const directoryResult = await service.delete('folder')

    expect(fileResult.deleted).toBe(true)
    expect(directoryResult.deleted).toBe(true)
    expect(fileSystem.hasEntry(createWorkspacePath('single.md'))).toBe(false)
    expect(fileSystem.hasEntry(createWorkspacePath('folder'))).toBe(false)
  })
})

type WorkspaceDeletionSaveErrorLike = {
  readonly cause: unknown
}
