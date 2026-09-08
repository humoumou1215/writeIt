// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import { Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { mountSingleDocumentView } from '../../../../src/editor/cm6'

function makeStore(markdown = 'hello'): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
} {
  const store = new DocumentStore()
  const id = createDocumentId('sync-document')
  const path = createDocumentPath('sync-document.md')
  store.load({ id, path, markdown })
  return { store, locator: documentById(id) }
}

describe('CM6 and DocumentStore projection synchronization', () => {
  it('submits an editable user transaction through DocumentStore', () => {
    const { store, locator } = makeStore()
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
      editable: true,
    })

    projection.view.dispatch({
      changes: { from: projection.view.state.doc.length, insert: ' world' },
    })

    expect(store.get(locator)?.markdown).toBe('hello world')
    expect(store.getRevision(locator)).toBe(1)
    expect(projection.view.state.doc.toString()).toBe('hello world')
    expect(projection.displayedRevision).toBe(1)
    expect(projection.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })

    projection.destroy()
  })

  it('applies Store updates with a sync annotation without creating a loop', () => {
    const { store, locator } = makeStore()
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
    })

    const projectionUpdatesBefore = store
      .getTimeline(locator)
      .filter((event) => event.type === 'ProjectionUpdated').length

    store.applyChange(locator, {
      markdown: 'updated by Store',
      origin: createDocumentOrigin('test', 'external'),
    })

    expect(projection.view.state.doc.toString()).toBe('updated by Store')
    expect(projection.displayedRevision).toBe(1)
    expect(projection.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })
    expect(
      store.getTimeline(locator).filter((event) => event.type === 'DocumentChanged'),
    ).toHaveLength(1)
    expect(
      store
        .getTimeline(locator)
        .filter((event) => event.type === 'ProjectionUpdated'),
    ).toHaveLength(projectionUpdatesBefore + 1)

    projection.destroy()
  })

  it('propagates one source change to two views of the same document', () => {
    const { store, locator } = makeStore('A')
    const first = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor-a',
      editable: true,
    })
    const second = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor-b',
      editable: true,
    })

    first.view.dispatch({ changes: { from: 1, insert: '!' } })

    expect(store.get(locator)?.markdown).toBe('A!')
    expect(first.view.state.doc.toString()).toBe('A!')
    expect(second.view.state.doc.toString()).toBe('A!')
    expect(store.getProjections(locator)).toEqual([
      expect.objectContaining({
        projectionId: 'editor-a',
        revision: 1,
        stale: false,
      }),
      expect.objectContaining({
        projectionId: 'editor-b',
        revision: 1,
        stale: false,
      }),
    ])

    first.destroy()
    second.destroy()
  })

  it('exposes stale state and recovers on the next committed Store revision', () => {
    const { store, locator } = makeStore()
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
    })

    store.markProjectionStale(locator, 'editor', 'manual probe')
    expect(projection.projectionState).toMatchObject({
      revision: 0,
      stale: true,
      degraded: true,
      degradedReason: 'manual probe',
    })

    store.applyChange(locator, {
      markdown: 'recovered',
      origin: createDocumentOrigin('test', 'recovery'),
    })

    expect(projection.view.state.doc.toString()).toBe('recovered')
    expect(projection.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })

    projection.destroy()
  })

  it('rejects a captured Store-sync annotation in a read-only projection', () => {
    const { store, locator } = makeStore()
    let rawView: EditorView | undefined
    let capturedAnnotations: unknown
    const captureInternalTransaction = EditorView.updateListener.of((update) => {
      rawView = update.view
      const transaction = update.transactions.find((candidate) => candidate.docChanged)
      if (transaction) {
        capturedAnnotations = (
          transaction as unknown as { readonly annotations: unknown }
        ).annotations
      }
    })
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
      extensions: [captureInternalTransaction],
    })

    store.applyChange(locator, {
      markdown: 'authoritative',
      origin: createDocumentOrigin('test', 'external'),
    })
    if (!rawView || capturedAnnotations === undefined) {
      throw new Error('test did not observe a Store synchronization transaction')
    }

    rawView.dispatch({
      changes: { from: 0, to: rawView.state.doc.length, insert: 'forged' },
      annotations: capturedAnnotations as never,
    })

    expect(projection.view).not.toBe(rawView)
    expect(projection.view.state.doc.toString()).toBe('authoritative')
    expect(store.get(locator)?.markdown).toBe('authoritative')
    expect(store.getRevision(locator)).toBe(1)
    expect(projection.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })

    projection.destroy()
  })

  it('maps a secondary selection through a minimal Store fan-out change', () => {
    const { store, locator } = makeStore('0123456789')
    const fanoutChanges: Array<{
      from: number
      to: number
      insertedFrom: number
      insertedTo: number
    }> = []
    const captureFanout = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      update.changes.iterChanges((from, to, insertedFrom, insertedTo) => {
        fanoutChanges.push({ from, to, insertedFrom, insertedTo })
      })
    })
    const first = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor-a',
      editable: true,
    })
    const second = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor-b',
      editable: true,
      extensions: [captureFanout],
    })
    const secondRaw = EditorView.findFromDOM(second.view.dom)
    if (!secondRaw) throw new Error('secondary CM6 view was not found')
    secondRaw.dispatch({ selection: { anchor: 3, head: 5 } })

    first.view.dispatch({ changes: { from: 0, insert: '!' } })

    expect(second.view.state.doc.toString()).toBe('!0123456789')
    expect(second.view.state.selection.main).toMatchObject({
      anchor: 4,
      head: 6,
    })
    expect(fanoutChanges).toEqual([
      { from: 0, to: 0, insertedFrom: 0, insertedTo: 1 },
    ])
    expect(second.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })

    first.destroy()
    second.destroy()
  })

  it('keeps selection and CM6 document unchanged for source-only line-ending changes', () => {
    const { store, locator } = makeStore('one\r\ntwo\nthree')
    let documentChangeCount = 0
    const captureChanges = EditorView.updateListener.of((update) => {
      if (update.docChanged) documentChangeCount += 1
    })
    const first = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor-a',
      editable: true,
    })
    const second = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor-b',
      editable: true,
      extensions: [captureChanges],
    })
    const secondRaw = EditorView.findFromDOM(second.view.dom)
    if (!secondRaw) throw new Error('secondary CM6 view was not found')
    secondRaw.dispatch({ selection: { anchor: 4 } })
    const selectionBefore = second.view.state.selection.main

    store.applyChange(locator, {
      markdown: 'one\ntwo\nthree',
      origin: createDocumentOrigin('test', 'line-ending-only'),
    })

    expect(documentChangeCount).toBe(0)
    expect(second.view.state.doc.toString()).toBe('one\ntwo\nthree')
    expect(second.view.state.selection.main).toEqual(selectionBefore)
    expect(second.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })

    first.destroy()
    second.destroy()
  })

  it('groups CM6 typing transactions and starts a new step after a caret move', () => {
    const { store, locator } = makeStore('')
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'typing-editor',
      editable: true,
    })
    const rawView = EditorView.findFromDOM(projection.view.dom)
    if (!rawView) throw new Error('typing CM6 view was not found')
    const typed = Transaction.userEvent.of('input.type')

    rawView.dispatch({ changes: { from: 0, insert: 'a' }, annotations: typed })
    rawView.dispatch({ changes: { from: 1, insert: 'b' }, annotations: typed })
    expect(store.getHistory(locator).undo).toHaveLength(1)
    expect(store.getHistory(locator).undo[0]?.after).toBe('ab')

    rawView.dispatch({
      selection: { anchor: 1 },
      annotations: Transaction.userEvent.of('select.pointer'),
    })
    rawView.dispatch({ changes: { from: 1, insert: 'c' }, annotations: typed })

    expect(store.getHistory(locator).undo).toHaveLength(2)
    expect(store.undo(locator, createDocumentOrigin('test', 'undo')).markdown).toBe(
      'ab',
    )
    expect(store.undo(locator, createDocumentOrigin('test', 'undo')).markdown).toBe(
      '',
    )

    projection.destroy()
  })

  it('routes an untrusted annotated edit through Store for editable projections', () => {
    const { store, locator } = makeStore()
    let rawView: EditorView | undefined
    let capturedAnnotations: unknown
    const captureInternalTransaction = EditorView.updateListener.of((update) => {
      rawView = update.view
      const transaction = update.transactions.find((candidate) => candidate.docChanged)
      if (transaction) {
        capturedAnnotations = (
          transaction as unknown as { readonly annotations: unknown }
        ).annotations
      }
    })
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
      editable: true,
      extensions: [captureInternalTransaction],
    })

    store.applyChange(locator, {
      markdown: 'authoritative',
      origin: createDocumentOrigin('test', 'external'),
    })
    if (!rawView || capturedAnnotations === undefined) {
      throw new Error('test did not observe a Store synchronization transaction')
    }

    rawView.dispatch({
      changes: { from: 0, to: rawView.state.doc.length, insert: 'forged' },
      annotations: capturedAnnotations as never,
    })

    expect(store.get(locator)?.markdown).toBe('forged')
    expect(store.getRevision(locator)).toBe(2)
    expect(projection.view.state.doc.toString()).toBe('forged')
    expect(projection.projectionState).toMatchObject({
      revision: 2,
      stale: false,
      degraded: false,
    })

    projection.destroy()
  })
})
