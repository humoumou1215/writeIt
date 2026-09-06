import { describe, expect, it } from 'vitest'
import {
  DocumentStore,
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  documentByPath,
} from '../../../../src/core/document'

const documentId = createDocumentId('doc-history')
const documentPath = createDocumentPath('notes/history.md')
const idLocator = documentById(documentId)
const pathLocator = documentByPath(documentPath)

const aTab = createDocumentOrigin('projection', 'A-tab')
const bToA = createDocumentOrigin('projection', 'B/embed-A')
const cToA = createDocumentOrigin('projection', 'C/embed-A')
const historyCommand = createDocumentOrigin('command', 'history')

function makeStore(): DocumentStore {
  const store = new DocumentStore()
  store.load({ id: documentId, path: documentPath, markdown: 'A' })
  return store
}

describe('DocumentStore history', () => {
  it('shares one per-document history across A Tab, B→A, and C→A', () => {
    const store = makeStore()

    store.applyChange(idLocator, { markdown: 'A1', origin: aTab })
    store.applyChange(idLocator, { markdown: 'A1B', origin: bToA })
    store.applyChange(idLocator, { markdown: 'A1BC', origin: cToA })

    expect(store.getHistory(idLocator).undo).toHaveLength(3)
    expect(store.canUndo(pathLocator)).toBe(true)
    expect(store.get(idLocator)?.markdown).toBe('A1BC')

    expect(store.undo(idLocator, historyCommand).markdown).toBe('A1B')
    expect(store.undo(pathLocator, historyCommand).markdown).toBe('A1')
    expect(store.undo(idLocator, historyCommand).markdown).toBe('A')
    expect(store.canUndo(idLocator)).toBe(false)
    expect(store.canRedo(idLocator)).toBe(true)

    expect(store.redo(idLocator, historyCommand).markdown).toBe('A1')
    expect(store.redo(pathLocator, historyCommand).markdown).toBe('A1B')
    expect(store.redo(idLocator, historyCommand).markdown).toBe('A1BC')
    expect(store.canRedo(idLocator)).toBe(false)
  })

  it('keeps history independent per document and emits normal source changes', () => {
    const store = makeStore()
    const otherId = createDocumentId('other-history')
    const otherPath = createDocumentPath('notes/other-history.md')
    const otherLocator = documentById(otherId)
    store.load({ id: otherId, path: otherPath, markdown: 'other' })

    const events: Array<{ markdown: string; origin: string; revision: number }> = []
    store.subscribe(idLocator, (event) => {
      if (event.type === 'changed') {
        events.push({
          markdown: event.document.markdown,
          origin: event.origin.source ?? event.origin.kind,
          revision: event.document.revision,
        })
      }
    })

    store.applyChange(idLocator, { markdown: 'A1', origin: aTab })
    store.applyChange(otherLocator, { markdown: 'other!', origin: bToA })
    store.undo(idLocator, historyCommand)

    expect(store.getHistory(idLocator).undo).toHaveLength(0)
    expect(store.getHistory(otherLocator).undo).toHaveLength(1)
    expect(store.get(idLocator)?.markdown).toBe('A')
    expect(store.get(otherLocator)?.markdown).toBe('other!')
    expect(events).toEqual([
      { markdown: 'A1', origin: 'A-tab', revision: 1 },
      { markdown: 'A', origin: 'history', revision: 2 },
    ])
  })

  it('clears only the redo branch after a new source edit', () => {
    const store = makeStore()

    store.applyChange(idLocator, { markdown: 'one', origin: aTab })
    store.applyChange(idLocator, { markdown: 'two', origin: bToA })
    store.undo(idLocator, historyCommand)

    expect(store.canRedo(idLocator)).toBe(true)
    store.applyChange(idLocator, { markdown: 'branch', origin: cToA })

    expect(store.get(idLocator)?.markdown).toBe('branch')
    expect(store.canRedo(idLocator)).toBe(false)
    expect(store.getHistory(idLocator).undo.map((entry) => entry.after)).toEqual([
      'one',
      'branch',
    ])
  })
})
