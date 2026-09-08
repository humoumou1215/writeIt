import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../src/core/document'
import {
  DocumentPersistenceService,
  SaveConflictError,
} from '../../../src/application/persistence'
import { MemoryFileSystem } from '../../../src/platform/filesystem'
import { createWorkspacePath } from '../../../src/core/workspace'

const id = createDocumentId('persistence-test')
const path = createDocumentPath('notes/persistence.md')
const locator = documentById(id)
const editorOrigin = createDocumentOrigin('user', 'test-editor')

function createTestPersistence(options: { autoSaveDelayMs?: number | null } = {}) {
  const fileSystem = new MemoryFileSystem({
    'notes/persistence.md': 'initial\r\n',
  })
  const store = new DocumentStore()
  const persistence = new DocumentPersistenceService(store, fileSystem, options)
  return { fileSystem, store, persistence }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DocumentPersistenceService', () => {
  it('loads, manually saves exact source, and acknowledges only the saved revision', async () => {
    const { fileSystem, store, persistence } = createTestPersistence({
      autoSaveDelayMs: null,
    })
    await persistence.loadFromFile({ id, path })

    const changed = store.applyChange(locator, {
      markdown: 'edited\r\n未知语法 :::keep\r\n',
      origin: editorOrigin,
    })
    expect(persistence.getState(locator)).toMatchObject({
      dirty: true,
      status: 'dirty',
      pendingAutoSave: false,
    })

    const result = await persistence.save(locator)

    expect(result.written).toBe(true)
    expect(result.revision).toBe(changed.revision)
    expect(await fileSystem.readFile(path)).toBe(
      'edited\r\n未知语法 :::keep\r\n',
    )
    expect(store.get(locator)).toMatchObject({
      markdown: 'edited\r\n未知语法 :::keep\r\n',
      persistedRevision: changed.revision,
      dirty: false,
    })
    expect(persistence.getState(locator).status).toBe('clean')

    const noOp = await persistence.save(locator)
    expect(noOp.written).toBe(false)
  })

  it('does not overwrite an external edit and exposes a save conflict', async () => {
    const { fileSystem, store, persistence } = createTestPersistence({
      autoSaveDelayMs: null,
    })
    await persistence.loadFromFile({ id, path })
    store.applyChange(locator, {
      markdown: 'local edit\n',
      origin: editorOrigin,
    })
    await fileSystem.writeFile(path, 'external edit\n')

    await expect(persistence.save(locator)).rejects.toBeInstanceOf(
      SaveConflictError,
    )
    expect(await fileSystem.readFile(path)).toBe('external edit\n')
    expect(persistence.getState(locator)).toMatchObject({
      dirty: true,
      status: 'conflict',
      externalChange: {
        kind: 'changed',
        markdown: 'external edit\n',
      },
    })

    const discarded = await persistence.discardLocalChanges(locator)
    expect(discarded.markdown).toBe('external edit\n')
    expect(discarded.dirty).toBe(false)
    expect(persistence.getState(locator).status).toBe('clean')
  })

  it('guards even a clean manual save against an external replacement', async () => {
    const { fileSystem, persistence } = createTestPersistence({
      autoSaveDelayMs: null,
    })
    await persistence.loadFromFile({ id, path })
    await fileSystem.writeFile(path, 'external replacement\n')

    await expect(persistence.save(locator)).rejects.toBeInstanceOf(
      SaveConflictError,
    )
    expect(await fileSystem.readFile(path)).toBe('external replacement\n')
    expect(persistence.getState(locator).status).toBe('external-change')
  })

  it('detects a clean external change without mutating the Store until reload', async () => {
    const { fileSystem, store, persistence } = createTestPersistence({
      autoSaveDelayMs: null,
    })
    await persistence.loadFromFile({ id, path })
    await fileSystem.writeFile(path, 'changed outside\n')

    const detected = await persistence.checkExternalChange(locator)
    expect(detected).toMatchObject({
      changed: true,
      kind: 'changed',
      markdown: 'changed outside\n',
    })
    expect(store.get(locator)?.markdown).toBe('initial\r\n')
    expect(persistence.getState(locator).status).toBe('external-change')

    const reloaded = await persistence.reloadFromDisk(locator)
    expect(reloaded.markdown).toBe('changed outside\n')
    expect(reloaded.dirty).toBe(false)
    expect(persistence.getState(locator).status).toBe('clean')
  })

  it('auto-saves after the configured debounce and preserves newer edits', async () => {
    vi.useFakeTimers()
    const { fileSystem, store, persistence } = createTestPersistence({
      autoSaveDelayMs: 250,
    })
    await persistence.loadFromFile({ id, path })

    store.applyChange(locator, {
      markdown: 'first\n',
      origin: editorOrigin,
    })
    expect(persistence.getState(locator).pendingAutoSave).toBe(true)
    await vi.advanceTimersByTimeAsync(249)
    expect(await fileSystem.readFile(path)).toBe('initial\r\n')

    store.applyChange(locator, {
      markdown: 'second\n',
      origin: editorOrigin,
    })
    await vi.advanceTimersByTimeAsync(250)

    expect(await fileSystem.readFile(path)).toBe('second\n')
    expect(store.get(locator)?.dirty).toBe(false)
  })

  it('reopens a clean closed document from disk and reports deleted files', async () => {
    const { fileSystem, persistence } = createTestPersistence({
      autoSaveDelayMs: null,
    })
    await persistence.loadFromFile({ id, path })
    await fileSystem.writeFile(path, 'reopened from disk\n')

    const reopened = await persistence.reopen(locator)
    expect(reopened.markdown).toBe('reopened from disk\n')
    expect(reopened.dirty).toBe(false)

    await fileSystem.deleteEntry(createWorkspacePath(path))
    const result = await persistence.checkExternalChange(locator)
    expect(result).toMatchObject({ changed: true, kind: 'deleted' })
    expect(persistence.getState(locator).status).toBe('external-change')
  })
})
