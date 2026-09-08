// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import {
  ReferenceGraph,
  ReferenceHealthService,
} from '../../../../src/core/reference'
import {
  createDocumentId,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import {
  createReferenceNavigationExtension,
  mountSingleDocumentView,
  type SingleDocumentView,
} from '../../../../src/editor/cm6'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'

const mounted: SingleDocumentView[] = []

afterEach(() => {
  for (const projection of mounted.splice(0)) projection.destroy()
})

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

describe('CM6 reference navigation projection', () => {
  it('decorates a healthy reference, shows a tooltip, and opens its fragment', async () => {
    const open = vi.fn()
    const fileSystem = new MemoryFileSystem({
      files: { 'target.md': '# Heading\n' },
    })
    const store = new DocumentStore()
    const id = createDocumentId('reference-navigation-healthy')
    const locator = documentById(id)
    const hostDocument = store.load({
      id,
      path: createDocumentPath('host.md'),
      markdown: 'Go [[target#Heading]]',
    })
    const graph = new ReferenceGraph({
      workspacePaths: ['host.md', 'target.md'],
      documents: [hostDocument],
    })
    const health = new ReferenceHealthService({
      graph,
      contentReader: fileSystem,
    })
    let rawView: EditorView | undefined
    const capture = ViewPlugin.define((view) => {
      rawView = view
      return {}
    })
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'reference-navigation-healthy-editor',
      editable: true,
      extensions: [
        capture,
        createReferenceNavigationExtension({
          sourcePath: 'host.md',
          healthResolver: health,
          onOpen: open,
        }),
      ],
    })
    mounted.push(projection)
    if (!rawView) throw new Error('CM6 view was not captured')
    await flush()

    const mark = rawView.dom.querySelector<HTMLElement>('[data-writeit-reference]')
    expect(mark).not.toBeNull()
    expect(mark?.dataset.referenceStatus).toBe('resolved')
    mark?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }))
    const tooltip = document.body.querySelector<HTMLElement>('[data-reference-tooltip]')
    expect(tooltip?.dataset.show).toBe('true')
    expect(tooltip?.textContent).toContain('Heading')

    mark?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(open).toHaveBeenCalledWith('target.md', 'Heading', expect.anything())
  })

  it('marks broken references and reselects only the original token', async () => {
    const reselect = vi.fn()
    const store = new DocumentStore()
    const id = createDocumentId('reference-navigation-broken')
    const locator = documentById(id)
    const hostDocument = store.load({
      id,
      path: createDocumentPath('host.md'),
      markdown: 'Keep [[missing]] intact',
    })
    const graph = new ReferenceGraph({
      workspacePaths: ['host.md'],
      documents: [hostDocument],
    })
    const health = new ReferenceHealthService(graph)
    let rawView: EditorView | undefined
    const capture = ViewPlugin.define((view) => {
      rawView = view
      return {}
    })
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'reference-navigation-broken-editor',
      extensions: [
        capture,
        createReferenceNavigationExtension({
          sourcePath: 'host.md',
          healthResolver: health,
          onReselect: reselect,
        }),
      ],
    })
    mounted.push(projection)
    if (!rawView) throw new Error('CM6 view was not captured')
    await flush()

    const mark = rawView.dom.querySelector<HTMLElement>('[data-writeit-reference]')
    expect(mark?.dataset.referenceStatus).toBe('missing')
    expect(rawView.dom.dataset.referenceBrokenCount).toBe('1')
    mark?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(reselect).toHaveBeenCalledWith(expect.objectContaining({
      raw: '[[missing]]',
      path: 'missing',
      action: 'reselect',
    }))
    expect(store.get(locator)?.markdown).toBe('Keep [[missing]] intact')
  })

  it('refreshes marks when the workspace graph changes', async () => {
    const store = new DocumentStore()
    const id = createDocumentId('reference-navigation-refresh')
    const locator = documentById(id)
    const hostDocument = store.load({
      id,
      path: createDocumentPath('host.md'),
      markdown: '[[target]]',
    })
    const graph = new ReferenceGraph({
      workspacePaths: ['host.md'],
      documents: [hostDocument],
    })
    const health = new ReferenceHealthService(graph)
    let rawView: EditorView | undefined
    const capture = ViewPlugin.define((view) => {
      rawView = view
      return {}
    })
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'reference-navigation-refresh-editor',
      extensions: [
        capture,
        createReferenceNavigationExtension({
          sourcePath: 'host.md',
          healthResolver: health,
        }),
      ],
    })
    mounted.push(projection)
    if (!rawView) throw new Error('CM6 view was not captured')
    await flush()
    expect(rawView.dom.querySelector('[data-reference-status="missing"]')).not.toBeNull()

    graph.setWorkspacePaths(['host.md', 'target.md'])
    await flush()
    expect(rawView.dom.querySelector('[data-reference-status="resolved"]')).not.toBeNull()
  })

  it('offers a source-preserving picker and replaces only the broken token', async () => {
    const store = new DocumentStore()
    const id = createDocumentId('reference-navigation-reselect')
    const locator = documentById(id)
    const hostDocument = store.load({
      id,
      path: createDocumentPath('host.md'),
      markdown: 'Before [[missing]] after',
    })
    const graph = new ReferenceGraph({
      workspacePaths: ['host.md', 'target.md'],
      documents: [hostDocument],
    })
    const health = new ReferenceHealthService(graph)
    let rawView: EditorView | undefined
    const capture = ViewPlugin.define((view) => {
      rawView = view
      return {}
    })
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'reference-navigation-reselect-editor',
      editable: true,
      extensions: [
        capture,
        createReferenceNavigationExtension({
          sourcePath: 'host.md',
          healthResolver: health,
          reselectProvider: () => [{ path: 'target.md', label: 'Target' }],
        }),
      ],
    })
    mounted.push(projection)
    if (!rawView) throw new Error('CM6 view was not captured')
    await flush()

    rawView.dom
      .querySelector<HTMLElement>('[data-writeit-reference]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flush()
    const menu = document.body.querySelector<HTMLElement>('[data-reference-reselect-menu]')
    expect(menu?.dataset.show).toBe('true')
    menu
      ?.querySelector<HTMLElement>('[data-reference-reselect-index="0"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flush()

    expect(store.get(locator)?.markdown).toBe('Before [[target.md]] after')
    expect(store.get(locator)?.revision).toBe(1)
  })
})
