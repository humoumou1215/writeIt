import { describe, expect, it } from 'vitest'
import {
  DocumentStore,
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
} from '../../../../src/core/document'
import type { FileSystemPort } from '../../../../src/platform/filesystem'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'

const id = createDocumentId('persisted-doc')
const path = createDocumentPath('notes/persisted.md')
const idLocator = documentById(id)
const saveOrigin = createDocumentOrigin('persistence', 'memory-fs')
const editOrigin = createDocumentOrigin('user', 'test-editor')

describe('DocumentStore + FileSystemPort', () => {
  it('loads and persists a store snapshot through the filesystem port', async () => {
    const fileSystem: FileSystemPort = new MemoryFileSystem({
      'notes/persisted.md': '# from disk\n',
    })
    const store = new DocumentStore()

    const loaded = store.load({
      id,
      path,
      markdown: await fileSystem.readFile(path),
    })
    expect(loaded.dirty).toBe(false)

    const changed = store.applyChange(idLocator, {
      markdown: '# edited in store\n',
      origin: editOrigin,
    })
    expect(changed.dirty).toBe(true)

    await fileSystem.writeFile(path, changed.markdown)
    const persisted = store.markPersisted(
      idLocator,
      changed.revision,
      saveOrigin,
    )

    expect(await fileSystem.readFile(path)).toBe('# edited in store\n')
    expect(persisted.dirty).toBe(false)
    expect(persisted.persistedRevision).toBe(changed.revision)
  })

  it('keeps external filesystem content outside the store until reconciliation', async () => {
    const fileSystem: FileSystemPort = new MemoryFileSystem({
      'notes/persisted.md': 'store authority\n',
    })
    const store = new DocumentStore()
    store.load({ id, path, markdown: await fileSystem.readFile(path) })

    await fileSystem.writeFile(path, 'external edit\n')

    expect(await fileSystem.readFile(path)).toBe('external edit\n')
    expect(store.get(idLocator)?.markdown).toBe('store authority\n')
    expect(store.isDirty(idLocator)).toBe(false)
  })
})
