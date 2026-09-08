import { describe, expect, it } from 'vitest'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  createSourceChangeSetFromChanges,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'

const id = createDocumentId('history-budget')
const path = createDocumentPath('history-budget.md')
const locator = documentById(id)
const editOrigin = createDocumentOrigin('test', 'history-budget')

function loadStore(
  markdown = 'base',
  history: { maxEntries?: number; maxBytes?: number } = {},
): DocumentStore {
  const store = new DocumentStore({ history })
  store.load({ id, path, markdown })
  return store
}

describe('DocumentStore source-change history budget', () => {
  it('records a source delta in events and groups explicit typing steps', () => {
    const store = loadStore('')
    const events: Array<{
      change: ReturnType<typeof createSourceChangeSetFromChanges>
      source: string
    }> = []
    store.subscribe(locator, (event) => {
      if (event.type === 'changed') {
        events.push({ change: event.change, source: event.document.markdown })
      }
    })

    store.applyChange(locator, {
      markdown: 'a',
      origin: editOrigin,
      historyGroup: {
        id: 'typing-1',
        kind: 'typing',
        continuation: 'start',
      },
    })
    store.applyChange(locator, {
      markdown: 'ab',
      origin: editOrigin,
      historyGroup: {
        id: 'typing-1',
        kind: 'typing',
        continuation: 'continue',
      },
    })

    expect(events).toHaveLength(2)
    expect(events[1]?.change.changes[0]).toMatchObject({
      from: 1,
      to: 1,
      deleted: '',
      inserted: 'b',
    })
    expect(store.getHistory(locator).undo).toHaveLength(1)
    expect(store.getHistory(locator).undo[0]).toMatchObject({
      before: '',
      after: 'ab',
      change: { changes: [{ changes: [{ inserted: 'ab' }] }] },
      historyGroup: {
        id: 'typing-1',
        kind: 'typing',
      },
      byteSize: 2,
    })

    expect(store.undo(locator, editOrigin).markdown).toBe('')
    expect(store.redo(locator, editOrigin).markdown).toBe('ab')
  })

  it('does not merge across an explicit non-typing boundary', () => {
    const store = loadStore('')
    store.applyChange(locator, {
      markdown: 'a',
      origin: editOrigin,
      historyGroup: {
        id: 'typing-2',
        kind: 'typing',
        continuation: 'start',
      },
    })
    store.applyChange(locator, { markdown: 'a ', origin: editOrigin })
    store.applyChange(locator, {
      markdown: 'a b',
      origin: editOrigin,
      historyGroup: {
        id: 'typing-2b',
        kind: 'typing',
        continuation: 'start',
      },
    })

    expect(store.getHistory(locator).undo).toHaveLength(3)
  })

  it('evicts oldest source deltas by byte budget while retaining entry cap compatibility', () => {
    const store = loadStore('base', { maxEntries: 10, maxBytes: 2 })
    store.applyChange(locator, { markdown: 'basex', origin: editOrigin })
    store.applyChange(locator, { markdown: 'basexx', origin: editOrigin })
    store.applyChange(locator, { markdown: 'basexxx', origin: editOrigin })

    const history = store.getHistory(locator)
    expect(history.maxEntries).toBe(10)
    expect(history.maxBytes).toBe(2)
    expect(history.undo).toHaveLength(2)
    expect(history.undo.map((entry) => entry.after)).toEqual([
      'basexx',
      'basexxx',
    ])
    expect(history.undoBytes).toBe(2)
    expect(history.totalBytes).toBeLessThanOrEqual(history.maxBytes)
  })

  it('drops an oversize Unicode edit but still commits the authoritative source', () => {
    const store = loadStore('base', { maxEntries: 10, maxBytes: 3 })
    const current = store.get(locator)
    if (!current) throw new Error('budget document is missing')
    const change = createSourceChangeSetFromChanges(current.markdown, [
      { from: current.markdown.length, to: current.markdown.length, insert: '你好' },
    ])

    store.applySourceChange(locator, {
      change,
      origin: editOrigin,
    })

    expect(store.get(locator)?.markdown).toBe('base你好')
    expect(store.getHistory(locator)).toMatchObject({
      undo: [],
      undoBytes: 0,
      maxBytes: 3,
    })
  })

  it('bounds delta retention for a large document and honors maxEntries', () => {
    const largeSource = 'x'.repeat(200_000)
    const store = loadStore(largeSource, { maxEntries: 3, maxBytes: 8 })
    let current = largeSource
    for (let index = 0; index < 12; index += 1) {
      const change = createSourceChangeSetFromChanges(current, [
        { from: current.length, to: current.length, insert: '!' },
      ])
      current += '!'
      store.applySourceChange(locator, { change, origin: editOrigin })
    }

    const history = store.getHistory(locator)
    expect(store.get(locator)?.markdown).toBe(current)
    expect(history.undo).toHaveLength(3)
    expect(history.undoBytes).toBe(3)
    expect(history.undo.every((entry) => entry.change.changes.length === 1)).toBe(
      true,
    )
    expect(history.totalBytes).toBeLessThanOrEqual(8)
  })

  it('validates byte and entry limits', () => {
    expect(() => new DocumentStore({ history: { maxBytes: -1 } })).toThrow(
      /maxBytes/,
    )
    expect(() => new DocumentStore({ history: { maxEntries: -1 } })).toThrow(
      /maxEntries/,
    )
    const store = loadStore('base', { maxEntries: 0, maxBytes: 0 })
    store.applyChange(locator, { markdown: 'base!', origin: editOrigin })
    expect(store.getHistory(locator)).toMatchObject({
      undo: [],
      redo: [],
      totalBytes: 0,
    })
  })
})
