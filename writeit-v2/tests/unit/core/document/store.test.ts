import { describe, expect, it } from 'vitest'
import {
  DocumentIdentityConflictError,
  DocumentNotFoundError,
  DocumentRevisionConflictError,
  DocumentStore,
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  createRevision,
  documentById,
  documentByPath,
} from '../../../../src/core/document'

const id = createDocumentId('doc-1')
const path = createDocumentPath('notes/readme.md')
const idLocator = documentById(id)
const pathLocator = documentByPath(path)
const editorOrigin = createDocumentOrigin('user', 'main-editor')
const saveOrigin = createDocumentOrigin('persistence', 'memory-fs')

function makeStore(markdown = '# title\n'): DocumentStore {
  const store = new DocumentStore()
  store.load({ id, path, markdown })
  return store
}

describe('DocumentStore', () => {
  it('loads one authoritative state and resolves it by explicit id or path', () => {
    const store = makeStore()
    const byId = store.get(idLocator)
    const byPath = store.get(pathLocator)

    expect(byId).toBeDefined()
    expect(byPath).toBe(byId)
    expect(byId).toMatchObject({
      id,
      path,
      markdown: '# title\n',
      revision: 0,
      persistedRevision: 0,
      dirty: false,
    })

    // Re-loading must not overwrite the in-memory authority.
    expect(
      store.load({ id, path, markdown: '# external replacement\n' }),
    ).toBe(byId)
    expect(store.get(idLocator)?.markdown).toBe('# title\n')
  })

  it('rejects conflicting document identities', () => {
    const store = makeStore()
    const otherId = createDocumentId('doc-2')
    const otherPath = createDocumentPath('notes/other.md')

    expect(() =>
      store.load({ id, path: otherPath, markdown: '' }),
    ).toThrow(DocumentIdentityConflictError)
    expect(() =>
      store.load({ id: otherId, path, markdown: '' }),
    ).toThrow(DocumentIdentityConflictError)
  })

  it('keeps id and path namespaces distinct for every store operation', () => {
    const store = new DocumentStore()
    const sharedId = createDocumentId('shared')
    const firstPath = createDocumentPath('notes/first.md')
    const secondId = createDocumentId('second')
    const sharedPath = createDocumentPath('shared')
    const firstById = documentById(sharedId)
    const secondByPath = documentByPath(sharedPath)

    store.load({ id: sharedId, path: firstPath, markdown: 'first' })
    store.load({ id: secondId, path: sharedPath, markdown: 'second' })

    expect(store.get(firstById)?.markdown).toBe('first')
    expect(store.get(secondByPath)?.markdown).toBe('second')
    expect(() => store.get(sharedId as never)).toThrow(TypeError)

    const observedDocumentIds = [] as string[]
    const unsubscribe = store.subscribe(
      secondByPath,
      (event) => observedDocumentIds.push(event.document.id),
    )

    store.applyChange(secondByPath, {
      markdown: 'second edited',
      origin: editorOrigin,
    })
    expect(store.getRevision(secondByPath)).toBe(1)
    expect(store.getPersistedRevision(secondByPath)).toBe(0)
    expect(store.isDirty(secondByPath)).toBe(true)
    expect(store.getHistory(secondByPath).undo).toHaveLength(1)
    expect(store.canUndo(secondByPath)).toBe(true)

    expect(store.undo(secondByPath, editorOrigin).markdown).toBe('second')
    expect(store.canRedo(secondByPath)).toBe(true)
    expect(store.redo(secondByPath, editorOrigin).markdown).toBe(
      'second edited',
    )

    store.markPersisted(secondByPath, createRevision(3), saveOrigin)
    expect(store.isDirty(secondByPath)).toBe(false)
    unsubscribe()

    store.attachProjection(secondByPath, 'manual-projection')
    store.markProjectionStale(secondByPath, 'manual-projection', 'probe')
    store.updateProjection(secondByPath, 'manual-projection')
    store.detachProjection(secondByPath, 'manual-projection')

    expect(store.get(firstById)?.markdown).toBe('first')
    expect(store.get(secondByPath)?.markdown).toBe('second edited')
    expect(observedDocumentIds).toEqual([
      secondId,
      secondId,
      secondId,
      secondId,
    ])
    expect(
      store
        .getTimeline(secondByPath)
        .every((event) => event.documentId === secondId),
    ).toBe(true)
    expect(store.getTimeline(firstById).map((event) => event.type)).toEqual([
      'DocumentLoaded',
    ])
  })

  it('requires an explicit origin and applies source changes synchronously', () => {
    const store = makeStore()
    const events: string[] = []
    let observedRevision = -1
    store.subscribe(idLocator, (event) => {
      events.push(event.type)
      observedRevision = event.document.revision
      expect(event.origin).toEqual(editorOrigin)
    })

    const next = store.applyChange(idLocator, {
      markdown: '# edited\n',
      origin: editorOrigin,
    })

    expect(next.revision).toBe(1)
    expect(next.persistedRevision).toBe(0)
    expect(next.dirty).toBe(true)
    expect(observedRevision).toBe(1)
    expect(events).toEqual(['changed'])
    expect(() =>
      store.applyChange(idLocator, '# invalid\n', undefined as never),
    ).toThrow(TypeError)
  })

  it('does not create a revision for a no-op and can guard stale changes', () => {
    const store = makeStore()
    const listener = [] as number[]
    store.subscribe(idLocator, (event) =>
      listener.push(event.document.revision),
    )

    expect(
      store.applyChange(idLocator, {
        markdown: '# title\n',
        origin: editorOrigin,
      }),
    ).toBe(store.get(idLocator))
    expect(listener).toEqual([])

    store.applyChange(idLocator, {
      markdown: '# edited\n',
      origin: editorOrigin,
      expectedRevision: createRevision(0),
    })
    expect(() =>
      store.applyChange(idLocator, {
        markdown: '# stale\n',
        origin: editorOrigin,
        expectedRevision: createRevision(0),
      }),
    ).toThrow(DocumentRevisionConflictError)
  })

  it('acknowledges the exact persisted revision without hiding newer edits', () => {
    const store = makeStore()
    const events: string[] = []
    store.subscribe(idLocator, (event) => events.push(event.type))

    store.applyChange(idLocator, {
      markdown: '# one\n',
      origin: editorOrigin,
    })
    store.applyChange(idLocator, {
      markdown: '# two\n',
      origin: editorOrigin,
    })

    const partiallyPersisted = store.markPersisted(
      idLocator,
      createRevision(1),
      saveOrigin,
    )
    expect(partiallyPersisted.revision).toBe(2)
    expect(partiallyPersisted.persistedRevision).toBe(1)
    expect(partiallyPersisted.dirty).toBe(true)
    expect(store.getPersistedRevision(idLocator)).toBe(1)

    const clean = store.markPersisted(
      idLocator,
      createRevision(2),
      saveOrigin,
    )
    expect(clean.dirty).toBe(false)
    expect(store.isDirty(idLocator)).toBe(false)
    expect(events).toEqual(['changed', 'changed', 'persisted', 'persisted'])

    expect(() =>
      store.markPersisted(idLocator, createRevision(1), saveOrigin),
    ).toThrow(RangeError)
    expect(() =>
      store.markPersisted(idLocator, createRevision(3), saveOrigin),
    ).toThrow(RangeError)
  })

  it('supports unsubscribe and reports unknown documents explicitly', () => {
    const store = makeStore()
    const revisions: number[] = []
    const unsubscribe = store.subscribe(idLocator, (event) =>
      revisions.push(event.document.revision),
    )

    store.applyChange(idLocator, { markdown: 'one', origin: editorOrigin })
    unsubscribe()
    unsubscribe()
    store.applyChange(idLocator, { markdown: 'two', origin: editorOrigin })
    expect(revisions).toEqual([1])

    const unknownLocator = documentById(createDocumentId('unknown'))
    expect(store.get(unknownLocator)).toBeUndefined()
    expect(() => store.getRevision(unknownLocator)).toThrow(
      DocumentNotFoundError,
    )
    expect(() =>
      store.applyChange(unknownLocator, {
        markdown: '',
        origin: editorOrigin,
      }),
    ).toThrow(DocumentNotFoundError)
  })
})
