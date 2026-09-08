// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import {
  mountBasicLivePreview,
  renderBasicMarkdownPreview,
  WorkspaceImageProjectionResolver,
} from '../../../../src/editor/preview'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'

function makeStore(
  markdown: string,
  pathValue = 'preview-document.md',
): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
} {
  const store = new DocumentStore()
  const id = createDocumentId('preview-document')
  const path = createDocumentPath(pathValue)
  store.load({ id, path, markdown })
  return { store, locator: documentById(id) }
}

describe('basic live preview', () => {
  it('renders headings, emphasis and safe links without interpreting unknown syntax', () => {
    const parent = document.createElement('div')
    const source =
      '# Heading\n\nA **strong** and *emphasized* [link](https://example.test).\n\n:::unknown\nraw\n:::'

    renderBasicMarkdownPreview(parent, source)

    expect(parent.querySelector('h1')?.textContent).toBe('Heading')
    expect(parent.querySelector('strong')?.textContent).toBe('strong')
    expect(parent.querySelector('em')?.textContent).toBe('emphasized')
    expect(parent.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.test',
    )
    expect(parent.textContent).toContain(':::unknown')
    expect(parent.textContent).toContain('raw')
    expect(parent.querySelector('script')).toBeNull()
  })

  it('projects a relative image path without changing the authoritative Markdown', async () => {
    const source = 'Before ![diagram](images/diagram.png) after'
    const { store, locator } = makeStore(source)
    const fileSystem = new MemoryFileSystem({
      binaryFiles: {
        'images/diagram.png': new Uint8Array([1, 2, 3]),
      },
    })
    const resolver = new WorkspaceImageProjectionResolver({ reader: fileSystem })
    const parent = document.createElement('div')
    const previews: string[] = []
    const reveals: string[] = []

    renderBasicMarkdownPreview(parent, source, {
      imageResolver: resolver,
      documentPath: 'readme.md',
      onPreview: (image) => previews.push(image.path ?? image.source),
      onReveal: (path) => reveals.push(path),
    })
    // Await the resolver's actual read completion rather than a timing guess;
    // the render callback is registered on the same shared request.
    await resolver.resolve('images/diagram.png', 'readme.md')

    const image = parent.querySelector<HTMLImageElement>('.live-preview-image__content')
    expect(image?.dataset.imagePath).toBe('images/diagram.png')
    expect(image?.src).toContain('data:image/png;base64,AQID')
    expect(store.get(locator)?.markdown).toBe(source)
    expect(
      parent.querySelector<HTMLElement>('.live-preview-image')?.dataset.imageSource,
    ).toBe('images/diagram.png')

    image?.click()
    parent.querySelector<HTMLButtonElement>('[data-image-action="reveal"]')?.click()
    expect(previews).toEqual(['images/diagram.png'])
    expect(reveals).toEqual(['images/diagram.png'])
    resolver.dispose()
  })

  it('resolves a nested document image against its containing directory', async () => {
    const source = '![diagram](images/diagram.png)'
    const { store, locator } = makeStore(source, 'notes/readme.md')
    const resolver = new WorkspaceImageProjectionResolver({
      reader: new MemoryFileSystem({
        binaryFiles: {
          'notes/images/diagram.png': new Uint8Array([1, 2, 3]),
        },
      }),
    })
    const parent = document.createElement('div')

    renderBasicMarkdownPreview(parent, source, {
      imageResolver: resolver,
      documentPath: 'notes/readme.md',
    })
    await resolver.resolve('images/diagram.png', 'notes/readme.md')

    const image = parent.querySelector<HTMLImageElement>(
      '.live-preview-image__content',
    )
    expect(image?.dataset.imagePath).toBe('notes/images/diagram.png')
    expect(image?.dataset.imageStatus).toBe('ready')
    expect(store.get(locator)?.markdown).toBe(source)
    resolver.dispose()
  })

  it('retries a revoked source-backed URL with equivalent bytes before degrading', async () => {
    const source = '![diagram](images/diagram.png)'
    const resolver = new WorkspaceImageProjectionResolver({
      reader: new MemoryFileSystem({
        binaryFiles: {
          'images/diagram.png': new Uint8Array([1, 2, 3]),
        },
      }),
      createObjectUrl: () => 'blob:revoked-image',
    })
    const parent = document.createElement('div')

    renderBasicMarkdownPreview(parent, source, {
      imageResolver: resolver,
      documentPath: 'readme.md',
    })
    await resolver.resolve('images/diagram.png', 'readme.md')

    const image = parent.querySelector<HTMLImageElement>(
      '.live-preview-image__content',
    )
    expect(image?.dataset.imageStatus).toBe('ready')
    image?.dispatchEvent(new Event('error'))

    expect(image?.dataset.imageStatus).toBe('ready')
    expect(image?.getAttribute('src')).toBe(
      'data:image/png;base64,AQID',
    )
    resolver.dispose()
  })

  it('shows image read failure in the projection while retaining its source path', async () => {
    const source = '![missing](images/missing.png)'
    const { store, locator } = makeStore(source)
    const resolver = new WorkspaceImageProjectionResolver({
      reader: new MemoryFileSystem(),
    })
    const parent = document.createElement('div')

    renderBasicMarkdownPreview(parent, source, {
      imageResolver: resolver,
      documentPath: 'readme.md',
    })
    await resolver.resolve('images/missing.png', 'readme.md')

    const wrapper = parent.querySelector<HTMLElement>('.live-preview-image')
    expect(wrapper?.dataset.imagePath).toBe('images/missing.png')
    expect(wrapper?.dataset.imageStatus).toBe('unavailable')
    expect(wrapper?.textContent).toContain('Image unavailable')
    expect(store.get(locator)?.markdown).toBe(source)
    expect(store.get(locator)?.revision).toBe(0)
    resolver.dispose()
  })

  it('updates from the authoritative Store and acknowledges the preview revision', () => {
    const { store, locator } = makeStore('# Before')
    const parent = document.createElement('div')
    const preview = mountBasicLivePreview({
      store,
      locator,
      parent,
      projectionId: 'preview',
    })

    store.applyChange(locator, {
      markdown: '# After\n\n**updated**',
      origin: createDocumentOrigin('test', 'preview-sync'),
    })

    expect(parent.querySelector('h1')?.textContent).toBe('After')
    expect(parent.querySelector('strong')?.textContent).toBe('updated')
    expect(preview.displayedRevision).toBe(1)
    expect(preview.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })

    preview.destroy()
    expect(parent.childElementCount).toBe(0)
  })

  it('catches a Store change committed during preview attachment', () => {
    const { store, locator } = makeStore('# Before')
    let changed = false
    const stopTimeline = store.subscribeTimeline((event) => {
      if (event.type !== 'ProjectionAttached' || changed) return
      changed = true
      store.applyChange(locator, {
        markdown: '# During attach',
        origin: createDocumentOrigin('test', 'preview-attach'),
      })
    })
    const parent = document.createElement('div')

    const preview = mountBasicLivePreview({
      store,
      locator,
      parent,
      projectionId: 'preview',
    })
    stopTimeline()

    expect(parent.querySelector('h1')?.textContent).toBe('During attach')
    expect(preview.displayedRevision).toBe(1)
    expect(preview.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })

    preview.destroy()
  })

  it('replays a Store change committed during renderer initialization', () => {
    const { store, locator } = makeStore('# Before')
    const parent = document.createElement('div')
    const originalReplaceChildren = parent.replaceChildren.bind(parent)
    let mutateOnFirstRender = true
    parent.replaceChildren = (...nodes: (Node | string)[]): void => {
      if (mutateOnFirstRender) {
        mutateOnFirstRender = false
        store.applyChange(locator, {
          markdown: '# During render',
          origin: createDocumentOrigin('test', 'preview-render'),
        })
      }
      originalReplaceChildren(...nodes)
    }

    const preview = mountBasicLivePreview({
      store,
      locator,
      parent,
      projectionId: 'preview',
    })

    expect(parent.querySelector('h1')?.textContent).toBe('During render')
    expect(preview.displayedRevision).toBe(1)
    expect(preview.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })

    preview.destroy()
  })

  it('keeps source current while showing a degraded fallback after initial render failure', () => {
    const { store, locator } = makeStore('# Initial source')
    const parent = document.createElement('div')
    let shouldFail = true
    const renderer = (host: HTMLElement, source: string): void => {
      if (shouldFail) throw new Error('rich renderer unavailable')
      renderBasicMarkdownPreview(host, source)
    }

    const preview = mountBasicLivePreview({
      store,
      locator,
      parent,
      projectionId: 'preview',
      renderer,
    })

    expect(preview.renderMode).toBe('source-fallback')
    expect(preview.displayedRevision).toBe(0)
    expect(parent.querySelector('.live-preview-degraded')).not.toBeNull()
    expect(parent.querySelector('.live-preview-source-fallback')?.textContent).toBe(
      '# Initial source',
    )
    expect(preview.projectionState).toMatchObject({
      revision: 0,
      stale: false,
      degraded: true,
      degradedReason: 'Error: rich renderer unavailable',
    })

    const revisionBeforeRetry = store.getRevision(locator)
    shouldFail = false
    preview.retryRender()

    expect(store.getRevision(locator)).toBe(revisionBeforeRetry)
    expect(preview.renderMode).toBe('rich')
    expect(preview.displayedRevision).toBe(0)
    expect(preview.projectionState).toMatchObject({
      revision: 0,
      stale: false,
      degraded: false,
    })

    preview.destroy()
  })

  it('acknowledges the current revision when an update falls back to source', () => {
    const { store, locator } = makeStore('# Before')
    const parent = document.createElement('div')
    let shouldFail = false
    const renderer = (host: HTMLElement, source: string): void => {
      if (shouldFail) throw new Error('update renderer unavailable')
      renderBasicMarkdownPreview(host, source)
    }
    const preview = mountBasicLivePreview({
      store,
      locator,
      parent,
      projectionId: 'preview',
      renderer,
    })

    shouldFail = true
    store.applyChange(locator, {
      markdown: '# Current source',
      origin: createDocumentOrigin('test', 'preview-fallback'),
    })

    expect(preview.renderMode).toBe('source-fallback')
    expect(preview.displayedRevision).toBe(1)
    expect(parent.querySelector('.live-preview-source-fallback')?.textContent).toBe(
      '# Current source',
    )
    expect(preview.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: true,
      degradedReason: 'Error: update renderer unavailable',
    })

    shouldFail = false
    preview.retryRender()

    expect(preview.renderMode).toBe('rich')
    expect(preview.displayedRevision).toBe(1)
    expect(preview.projectionState).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })
    expect(parent.querySelector('h1')?.textContent).toBe('Current source')

    preview.destroy()
  })

  it('keeps source stale and degraded when both rich and source fallback fail', () => {
    const { store, locator } = makeStore('# Source')
    const parent = document.createElement('div')
    const originalReplaceChildren = parent.replaceChildren.bind(parent)
    parent.replaceChildren = (..._nodes: (Node | string)[]): void => {
      throw new Error('fallback DOM unavailable')
    }

    const preview = mountBasicLivePreview({
      store,
      locator,
      parent,
      projectionId: 'preview',
      renderer: () => {
        throw new Error('rich renderer unavailable')
      },
    })

    expect(preview.renderMode).toBe('unavailable')
    expect(preview.displayedRevision).toBe(0)
    expect(preview.projectionState).toMatchObject({
      revision: 0,
      stale: true,
      degraded: true,
    })
    expect(preview.projectionState.degradedReason).toContain(
      'source fallback failed: Error: fallback DOM unavailable',
    )

    parent.replaceChildren = originalReplaceChildren
    preview.destroy()
  })

  it('unsubscribes before teardown-triggered Store changes', () => {
    const { store, locator } = makeStore('before-teardown')
    const parent = document.createElement('div')
    const originalReplaceChildren = parent.replaceChildren.bind(parent)
    let mutateOnCleanup = false
    parent.replaceChildren = (...nodes: (Node | string)[]): void => {
      if (mutateOnCleanup) {
        mutateOnCleanup = false
        store.applyChange(locator, {
          markdown: 'during-teardown',
          origin: createDocumentOrigin('test', 'preview-teardown'),
        })
      }
      originalReplaceChildren(...nodes)
    }

    const preview = mountBasicLivePreview({
      store,
      locator,
      parent,
      projectionId: 'preview',
    })
    mutateOnCleanup = true

    expect(() => preview.destroy()).not.toThrow()
    expect(store.get(locator)?.markdown).toBe('during-teardown')
    expect(() => store.getProjection(locator, 'preview')).toThrow(
      /not attached/,
    )
  })
})
