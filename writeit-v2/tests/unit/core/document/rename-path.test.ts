import { describe, expect, it } from 'vitest'
import {
  DocumentPathConflictError,
  DocumentStore,
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  createRevision,
  documentById,
  documentByPath,
} from '../../../../src/core/document'

const origin = createDocumentOrigin('workspace', 'rename-path-test')

describe('DocumentStore path linkage', () => {
  it('moves a stable document identity without creating a source revision', () => {
    const store = new DocumentStore()
    const id = createDocumentId('path-document')
    const oldPath = createDocumentPath('old.md')
    const newPath = createDocumentPath('new.md')
    store.load({ id, path: oldPath, markdown: '# source\n' })
    const events: string[] = []
    store.subscribe(documentById(id), (event) => events.push(event.type))

    const renamed = store.renamePath(
      documentById(id),
      newPath,
      origin,
      createRevision(0),
    )

    expect(renamed).toMatchObject({
      id,
      path: newPath,
      markdown: '# source\n',
      revision: 0,
      persistedRevision: 0,
      dirty: false,
    })
    expect(store.get(documentByPath(oldPath))).toBeUndefined()
    expect(store.get(documentByPath(newPath))).toBe(renamed)
    expect(events).toEqual(['renamed'])
    expect(store.getTimeline(documentById(id)).map((event) => event.type)).toEqual([
      'DocumentLoaded',
      'DocumentRenamed',
    ])
  })

  it('rejects a path already owned by another document', () => {
    const store = new DocumentStore()
    const first = createDocumentId('first-path-document')
    const second = createDocumentId('second-path-document')
    store.load({
      id: first,
      path: createDocumentPath('first.md'),
      markdown: 'first',
    })
    store.load({
      id: second,
      path: createDocumentPath('second.md'),
      markdown: 'second',
    })

    expect(() =>
      store.renamePath(
        documentById(first),
        createDocumentPath('second.md'),
        origin,
      ),
    ).toThrow(DocumentPathConflictError)
    expect(store.get(documentById(first))?.path).toBe('first.md')
  })
})
