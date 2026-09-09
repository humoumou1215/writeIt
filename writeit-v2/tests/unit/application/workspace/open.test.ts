import { describe, expect, it } from 'vitest'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import {
  decideWorkspaceOpen,
  DocumentPersistenceService,
  WorkspaceTabManager,
} from '../../../../src/application/workspace'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'

const documentId = createDocumentId('loaded-target')

describe('loaded Document explicit Open policy', () => {
  it('loads a Document that is not in the Store', () => {
    expect(
      decideWorkspaceOpen({
        dirty: false,
        tabOpen: false,
      }),
    ).toEqual({ kind: 'load' })
  })

  it('activates a loaded dirty Document when it has no tab', () => {
    expect(
      decideWorkspaceOpen({
        loadedDocumentId: documentId,
        dirty: true,
        tabOpen: false,
      }),
    ).toEqual({ kind: 'activate-existing', documentId })
  })

  it('activates the existing tab for a loaded dirty Document', () => {
    expect(
      decideWorkspaceOpen({
        loadedDocumentId: documentId,
        dirty: true,
        tabOpen: true,
      }),
    ).toEqual({ kind: 'activate-existing', documentId })
  })

  it('activates an already-open clean tab without reopening it', () => {
    expect(
      decideWorkspaceOpen({
        loadedDocumentId: documentId,
        dirty: false,
        tabOpen: true,
      }),
    ).toEqual({ kind: 'activate-existing', documentId })
  })

  it('keeps clean closed-document reopen semantics', () => {
    expect(
      decideWorkspaceOpen({
        loadedDocumentId: documentId,
        dirty: false,
        tabOpen: false,
      }),
    ).toEqual({ kind: 'reopen-clean', documentId })
  })

  it('activates a conflicted dirty Document without resolving its persistence state', async () => {
    const path = createDocumentPath('notes/open-conflict.md')
    const fileSystem = new MemoryFileSystem({
      'notes/open-conflict.md': 'disk source',
    })
    const store = new DocumentStore()
    const persistence = new DocumentPersistenceService(store, fileSystem, {
      autoSaveDelayMs: null,
    })
    const loaded = await persistence.loadFromFile({
      id: createDocumentId('open-conflict'),
      path,
    })
    store.applyChange(documentById(loaded.id), {
      markdown: 'local source',
      origin: createDocumentOrigin('user', 'open-conflict-test'),
    })
    await fileSystem.writeFile(path, 'external source')
    await expect(persistence.save(documentById(loaded.id))).rejects.toThrow(
      'changed externally',
    )

    const beforeOpen = store.get(documentById(loaded.id))
    const decision = decideWorkspaceOpen({
      loadedDocumentId: loaded.id,
      dirty: true,
      tabOpen: false,
    })
    expect(decision).toEqual({ kind: 'activate-existing', documentId: loaded.id })
    const tabs = new WorkspaceTabManager()
    if (decision.kind === 'activate-existing') tabs.open(decision.documentId)

    expect(store.getAll()).toHaveLength(1)
    expect(store.get(documentById(loaded.id))).toBe(beforeOpen)
    expect(persistence.getState(documentById(loaded.id))).toMatchObject({
      dirty: true,
      status: 'conflict',
    })
    expect(tabs.getSnapshot().tabs).toEqual([{ documentId: loaded.id }])

    // The existing explicit Discard path still owns conflict resolution.
    await persistence.discardLocalChanges(documentById(loaded.id))
    expect(store.get(documentById(loaded.id))).toMatchObject({
      markdown: 'external source',
      dirty: false,
    })
  })
})
