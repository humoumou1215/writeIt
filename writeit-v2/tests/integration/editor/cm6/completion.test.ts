// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import {
  CompletionProviderRegistry,
  createStaticCompletionProvider,
} from '../../../../src/application/assistance'
import {
  createDocumentId,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import {
  createCompletionExtension,
  mountSingleDocumentView,
  type SingleDocumentView,
} from '../../../../src/editor/cm6'

const mountedViews: SingleDocumentView[] = []

function createRegistry(): CompletionProviderRegistry {
  const registry = new CompletionProviderRegistry()
  registry.register(
    createStaticCompletionProvider({
      id: 'test-references',
      triggers: ['@', '[[', '![['],
      items: [
        {
          id: 'alpha',
          label: 'Alpha document',
          detail: 'alpha.md',
          keywords: ['first'],
          insertText: '[[alpha.md]]',
        },
        {
          id: 'beta',
          label: 'Beta document',
          detail: 'beta.md',
          insertText: '[[beta.md]]',
        },
      ],
    }),
  )
  return registry
}

function makeView(markdown = ''): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
  projection: SingleDocumentView
  rawView: EditorView
} {
  const store = new DocumentStore()
  const id = createDocumentId('completion-document')
  const path = createDocumentPath('completion-document.md')
  const locator = documentById(id)
  store.load({ id, path, markdown })

  let rawView: EditorView | undefined
  const captureView = ViewPlugin.define((view) => {
    rawView = view
    return {}
  })
  const projection = mountSingleDocumentView({
    store,
    locator,
    parent: document.body,
    projectionId: `completion-editor-${mountedViews.length}`,
    editable: true,
    extensions: [
      captureView,
      createCompletionExtension({
        store,
        locator,
        registry: createRegistry(),
      }),
    ],
  })
  mountedViews.push(projection)
  if (!rawView) throw new Error('CM6 view was not captured')
  return { store, locator, projection, rawView }
}

function typeSource(view: EditorView, source: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: source },
    selection: { anchor: source.length },
  })
}

function menu(view: EditorView): HTMLElement {
  const element = view.dom.querySelector<HTMLElement>('[data-completion-menu]')
  if (!element) throw new Error('completion menu is not mounted')
  return element
}

async function flushCompletion(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy()
})

describe('CM6 completion surface', () => {
  it.each([
    ['@alp', '@', '[[alpha.md]]'],
    ['[[alp', '[[', '[[alpha.md]]'],
    ['![[alp', '![[', '[[alpha.md]]'],
    ['＠alp', '@', '[[alpha.md]]'],
    ['［［alp', '[[', '[[alpha.md]]'],
    ['！【【alp', '![[', '[[alpha.md]]'],
  ] as const)('opens for the %s trigger and applies a selected item', async (
    source,
    triggerKind,
    expected,
  ) => {
    const { store, locator, rawView } = makeView()
    typeSource(rawView, source)
    await flushCompletion()

    const popup = menu(rawView)
    expect(popup.dataset.show).toBe('true')
    expect(popup.dataset.triggerKind).toBe(triggerKind)
    expect(
      [...popup.querySelectorAll<HTMLElement>('[role="option"]')].map(
        (option) => option.textContent,
      ),
    ).toEqual(['Alpha documentalpha.md'])

    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    )
    await flushCompletion()

    expect(store.get(locator)?.markdown).toBe(expected)
    expect(store.get(locator)?.revision).toBe(2)
    expect(popup.dataset.show).toBe('false')
  })

  it('keeps full-width trigger source unchanged while the menu is open', async () => {
    const { store, locator, rawView } = makeView()
    typeSource(rawView, '！【【alp')
    await flushCompletion()

    const popup = menu(rawView)
    expect(popup.dataset.show).toBe('true')
    expect(popup.dataset.triggerKind).toBe('![[')
    expect(store.get(locator)?.markdown).toBe('！【【alp')
    expect(rawView.state.doc.toString()).toBe('！【【alp')

    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(store.get(locator)?.markdown).toBe('！【【alp')
  })

  it('supports keyboard selection and query filtering without CM6-owned source state', async () => {
    const { store, locator, rawView } = makeView()
    typeSource(rawView, '[[bet')
    await flushCompletion()

    const popup = menu(rawView)
    expect(popup.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(popup.querySelector('[data-completion-id="beta"]')).not.toBeNull()

    typeSource(rawView, '[[alp')
    await flushCompletion()
    expect(popup.querySelector('[data-completion-id="alpha"]')).not.toBeNull()

    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    )
    await flushCompletion()

    expect(store.get(locator)?.markdown).toBe('[[alpha.md]]')
    expect(rawView.state.doc.toString()).toBe(store.get(locator)?.markdown)
  })

  it('applies a mouse-selected item through the Store bridge', async () => {
    const { store, locator, rawView } = makeView()
    typeSource(rawView, '[[bet')
    await flushCompletion()

    const option = menu(rawView).querySelector<HTMLElement>(
      '[data-completion-id="beta"]',
    )
    if (!option) throw new Error('beta completion is not visible')
    option.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    option.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    await flushCompletion()

    expect(store.get(locator)?.markdown).toBe('[[beta.md]]')
    expect(store.get(locator)?.revision).toBe(2)
  })

  it('does not open or execute while an IME composition is active', async () => {
    const { store, locator, rawView } = makeView()
    rawView.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    typeSource(rawView, '＠a')
    await flushCompletion()

    const popup = menu(rawView)
    expect(popup.dataset.show).toBe('false')
    expect(store.get(locator)?.markdown).toBe('＠a')

    rawView.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await flushCompletion()
    expect(popup.dataset.show).toBe('true')
  })
})
