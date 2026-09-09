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
import { WorkspaceImageProjectionResolver } from '../../../../src/editor/preview'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'

const mountedViews: SingleDocumentView[] = []

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy()
})

function makeStore(
  markdown: string,
  pathValue = 'presentation-document.md',
): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
} {
  const store = new DocumentStore()
  const id = createDocumentId('presentation-document')
  const path = createDocumentPath(pathValue)
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

  it('resolves nested document images in the same CM6 live presentation without changing source', async () => {
    const source = '![diagram](images/diagram.png)'
    const { store, locator } = makeStore(source, 'notes/readme.md')
    const resolver = new WorkspaceImageProjectionResolver({
      reader: new MemoryFileSystem({
        binaryFiles: {
          'notes/images/diagram.png': new Uint8Array([1, 2, 3]),
        },
      }),
    })
    const previews: string[] = []
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
      editable: true,
      imageProjection: {
        imageResolver: resolver,
        documentPath: 'notes/readme.md',
        onPreview: (image) => previews.push(image.path ?? image.source),
      },
    })
    mountedViews.push(projection)
    projection.setPresentationMode('live-preview')
    await resolver.resolve('images/diagram.png', 'notes/readme.md')

    const image = projection.view.contentDOM.querySelector<HTMLImageElement>(
      '.cm-writeit-live-preview-image__content',
    )
    expect(image?.dataset.imagePath).toBe('notes/images/diagram.png')
    expect(image?.src).toContain('data:image/png;base64,AQID')
    expect(projection.view.state.doc.toString()).toBe(source)
    expect(store.get(locator)?.markdown).toBe(source)
    expect(store.getRevision(locator)).toBe(0)

    image?.click()
    expect(image?.closest<HTMLElement>('.cm-writeit-live-preview-image')?.dataset.imageFocused)
      .toBe('true')
    projection.view.dom
      .querySelector<HTMLButtonElement>('[data-image-action="preview"]')
      ?.click()
    expect(previews).toEqual(['notes/images/diagram.png'])
    resolver.dispose()
  })

  it('retries a revoked CM6 image URL with the source-backed bytes', async () => {
    const source = '![diagram](images/diagram.png)'
    const { store, locator } = makeStore(source)
    const resolver = new WorkspaceImageProjectionResolver({
      reader: new MemoryFileSystem({
        binaryFiles: {
          'images/diagram.png': new Uint8Array([1, 2, 3]),
        },
      }),
      createObjectUrl: () => 'blob:revoked-image',
    })
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'editor',
      imageProjection: {
        imageResolver: resolver,
        documentPath: 'readme.md',
      },
    })
    mountedViews.push(projection)
    projection.setPresentationMode('live-preview')
    await resolver.resolve('images/diagram.png', 'readme.md')

    const image = projection.view.contentDOM.querySelector<HTMLImageElement>(
      '.cm-writeit-live-preview-image__content',
    )
    expect(image?.dataset.imageStatus).toBe('ready')
    image?.dispatchEvent(new Event('error'))

    expect(image?.dataset.imageStatus).toBe('ready')
    expect(image?.getAttribute('src')).toBe(
      'data:image/png;base64,AQID',
    )
    expect(store.getRevision(locator)).toBe(0)
    resolver.dispose()
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
