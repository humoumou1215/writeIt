// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import {
  createLivePreviewExtension,
  mountSingleDocumentView,
  type SingleDocumentView,
} from '../../../../src/editor/cm6'

const mountedViews: SingleDocumentView[] = []

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy()
})

function makeStore(markdown: string): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
} {
  const store = new DocumentStore()
  const id = createDocumentId('presentation-document')
  const path = createDocumentPath('presentation-document.md')
  store.load({ id, path, markdown })
  return { store, locator: documentById(id) }
}

describe('CM6 raw source / live preview presentation', () => {
  it('toggles decorations on one CM6 document without changing source, selection, or history', () => {
    const source =
      '# Heading\n\nA **strong** [safe link](https://example.test).\n\n:::unknown\nraw\n:::\n'
    const { store, locator } = makeStore(source)
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
      editable: true,
    })
    mountedViews.push(projection)

    projection.view.dispatch({
      changes: { from: source.length, insert: 'after' },
    })
    const afterEdit = store.get(locator)
    if (!afterEdit) throw new Error('document was not loaded')
    const selectionBeforeToggle = projection.view.state.selection.main
    const historyBeforeToggle = store.getHistory(locator)
    const revisionBeforeToggle = afterEdit.revision
    const stateBeforeToggle = projection.view.state

    projection.togglePresentationMode()

    expect(projection.view.state).not.toBe(stateBeforeToggle)
    expect(projection.view.state.doc.toString()).toBe(afterEdit.markdown)
    expect(store.get(locator)?.markdown).toBe(afterEdit.markdown)
    expect(store.getRevision(locator)).toBe(revisionBeforeToggle)
    expect(store.getHistory(locator)).toEqual(historyBeforeToggle)
    expect(projection.view.state.selection.main).toMatchObject({
      anchor: selectionBeforeToggle.anchor,
      head: selectionBeforeToggle.head,
    })
    expect(projection.presentationMode).toBe('live-preview')
    expect(projection.view.dom.dataset.presentationMode).toBe('live-preview')

    const content = projection.view.contentDOM
    expect(content.textContent).toContain('Heading')
    expect(content.textContent).toContain('strong')
    expect(content.textContent).toContain('safe link')
    expect(content.textContent).toContain(':::unknown')
    expect(content.textContent).not.toContain('**strong**')
    expect(content.textContent).not.toContain('[safe link]')
    expect(
      content.querySelector('.cm-writeit-live-preview-link-widget'),
    ).not.toBeNull()

    projection.togglePresentationMode()

    expect(projection.presentationMode).toBe('source')
    expect(projection.view.dom.dataset.presentationMode).toBe('source')
    expect(projection.view.contentDOM.textContent).toContain('# Heading')
    expect(projection.view.contentDOM.textContent).toContain('**strong**')
    expect(projection.view.contentDOM.textContent).toContain('[safe link]')
    expect(projection.view.state.doc.toString()).toBe(afterEdit.markdown)
    expect(store.getRevision(locator)).toBe(revisionBeforeToggle)
  })

  it('allows the presentation extension to be supplied explicitly', () => {
    const { store, locator } = makeStore('# Explicit **preview**')
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
      extensions: [
        createLivePreviewExtension({ initialMode: 'live-preview' }),
      ],
    })
    mountedViews.push(projection)

    expect(projection.presentationMode).toBe('live-preview')
    expect(projection.view.contentDOM.textContent).not.toContain(
      '**preview**',
    )
    expect(store.getRevision(locator)).toBe(0)
  })

  it('supports mounting directly in Live Preview without creating a second editor', () => {
    const { store, locator } = makeStore('# Initial **preview**')
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
      presentationMode: 'live-preview',
    })
    mountedViews.push(projection)

    expect(projection.presentationMode).toBe('live-preview')
    expect(projection.view.dom.dataset.presentationMode).toBe('live-preview')
    expect(projection.view.state.doc.toString()).toBe('# Initial **preview**')
    expect(projection.view.contentDOM.textContent).toContain('Initial')
    expect(projection.view.contentDOM.textContent).toContain('preview')
    expect(projection.view.contentDOM.textContent).not.toContain('**preview**')
    expect(document.body.querySelectorAll('.cm-editor')).toHaveLength(1)
    expect(store.getRevision(locator)).toBe(0)
  })

  it('keeps live decorations source-backed when the Store commits a later revision', () => {
    const { store, locator } = makeStore('# Before\n\n**old**')
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
    })
    mountedViews.push(projection)

    projection.setPresentationMode('live-preview')
    store.applyChange(locator, {
      markdown: '# After\n\n*new*\n\n:::unknown',
      origin: createDocumentOrigin('test', 'presentation-update'),
    })

    expect(projection.presentationMode).toBe('live-preview')
    expect(projection.view.state.doc.toString()).toBe(
      '# After\n\n*new*\n\n:::unknown',
    )
    expect(projection.view.contentDOM.textContent).toContain('After')
    expect(projection.view.contentDOM.textContent).toContain('new')
    expect(projection.view.contentDOM.textContent).toContain(':::unknown')
    expect(projection.view.contentDOM.textContent).not.toContain('*new*')
    expect(projection.displayedRevision).toBe(1)
    expect(projection.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })
  })
})
