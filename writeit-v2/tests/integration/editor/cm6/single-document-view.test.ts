// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { ViewPlugin } from '@codemirror/view'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import {
  mountSingleDocumentView,
  type SingleDocumentView,
} from '../../../../src/editor/cm6'

const mountedViews: SingleDocumentView[] = []

function makeStore(markdown: string): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
} {
  const store = new DocumentStore()
  const id = createDocumentId('single-view-document')
  const path = createDocumentPath('single-view-document.md')
  store.load({ id, path, markdown })
  return { store, locator: documentById(id) }
}

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy()
})

describe('single Document / single CM6 View', () => {
  it('mounts the authoritative Markdown and acknowledges one projection', () => {
    const markdown = '# Keep source\n\n:::unknown-syntax\nvalue\n:::\n'
    const { store, locator } = makeStore(markdown)

    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'main-editor',
    })
    mountedViews.push(projection)

    expect(projection.view.state.doc.toString()).toBe(markdown)
    expect(projection.view.state.readOnly).toBe(true)
    expect(projection.view.contentDOM.getAttribute('contenteditable')).toBe(
      'false',
    )
    expect(projection.initialDocument.markdown).toBe(markdown)
    expect(document.body.querySelectorAll('.cm-editor')).toHaveLength(1)
    expect(store.getProjections(locator)).toHaveLength(1)
    expect(projection.displayedRevision).toBe(0)
    expect(store.getProjection(locator, 'main-editor')).toMatchObject({
      projectionId: 'main-editor',
      revision: 0,
      stale: false,
      degraded: false,
    })
    expect(store.getTimeline(locator).map((event) => event.type)).toEqual([
      'DocumentLoaded',
      'ProjectionAttached',
      'ProjectionUpdated',
    ])
  })

  it('does not create an unsynchronized local source edit in P2-01', () => {
    const { store, locator } = makeStore('source')
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
    })
    mountedViews.push(projection)
    const before = store.get(locator)
    if (!before) throw new Error('test document was not loaded')

    projection.view.dispatch({
      changes: { from: 0, to: 0, insert: 'local ' },
    })

    expect(projection.view.state.doc.toString()).toBe('source')
    expect(store.get(locator)).toBe(before)
    expect(projection.displayedRevision).toBe(before.revision)
  })

  it('catches a Store change committed during projection attachment', () => {
    const { store, locator } = makeStore('revision-zero')
    let changed = false
    const stopTimeline = store.subscribeTimeline((event) => {
      if (event.type !== 'ProjectionAttached' || changed) return
      changed = true
      store.applyChange(locator, {
        markdown: 'revision-one',
        origin: createDocumentOrigin('test', 'attach-initialization'),
      })
    })

    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
    })
    mountedViews.push(projection)
    stopTimeline()

    expect(projection.view.state.doc.toString()).toBe('revision-one')
    expect(projection.displayedRevision).toBe(1)
    expect(projection.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })
  })

  it('replays a Store change committed during CM6 initialization', () => {
    const { store, locator } = makeStore('revision-zero')
    const initialization = ViewPlugin.define(() => {
      store.applyChange(locator, {
        markdown: 'revision-one',
        origin: createDocumentOrigin('test', 'cm6-initialization'),
      })
      return {}
    })

    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
      extensions: [initialization],
    })
    mountedViews.push(projection)

    expect(projection.view.state.doc.toString()).toBe('revision-one')
    expect(projection.displayedRevision).toBe(1)
    expect(projection.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })
  })

  it('unsubscribes before teardown-triggered Store changes', () => {
    const { store, locator } = makeStore('before-teardown')
    const teardown = ViewPlugin.define(() => ({
      destroy(): void {
        store.applyChange(locator, {
          markdown: 'during-teardown',
          origin: createDocumentOrigin('test', 'cm6-teardown'),
        })
      },
    }))
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
      extensions: [teardown],
    })

    expect(() => projection.destroy()).not.toThrow()
    expect(store.get(locator)?.markdown).toBe('during-teardown')
    expect(() => store.getProjection(locator, 'editor')).toThrow(
      /not attached/,
    )
  })

  it('detaches the projection and destroys the view exactly once', () => {
    const { store, locator } = makeStore('source')
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
    })

    projection.destroy()
    projection.destroy()

    expect(projection.isDestroyed).toBe(true)
    expect(document.body.querySelector('.cm-editor')).toBeNull()
    expect(store.getTimeline(locator).at(-1)?.type).toBe('ProjectionDetached')
    expect(() => store.getProjection(locator, projection.projectionId)).toThrow(
      /not attached/,
    )
  })
})
