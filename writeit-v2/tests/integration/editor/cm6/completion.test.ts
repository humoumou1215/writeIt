// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
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

function createReferenceModeRegistry(): CompletionProviderRegistry {
  const registry = new CompletionProviderRegistry()
  registry.register({
    id: 'reference-modes',
    triggers: ['@', '[[', '![['],
    modes: [
      { id: 'link', label: 'Link' },
      { id: 'embed', label: 'Editable embed' },
      { id: 'embed-readonly', label: 'Readonly embed' },
    ],
    initialMode: (trigger) => (trigger.kind === '![[' ? 'embed' : 'link'),
    provide: () => [
      {
        id: 'alpha',
        label: 'Alpha document',
        detail: 'alpha.md',
        apply: (context) => ({
          from: context.trigger.from,
          to: context.trigger.to,
          insert:
            context.mode?.id === 'embed'
              ? '![[alpha.md]]'
              : context.mode?.id === 'embed-readonly'
                ? '![[alpha.md|ro]]'
                : '[[alpha.md]]',
        }),
      },
      {
        id: 'beta',
        label: 'Beta document',
        detail: 'beta.md',
        apply: (context) => ({
          from: context.trigger.from,
          to: context.trigger.to,
          insert:
            context.mode?.id === 'embed'
              ? '![[beta.md]]'
              : context.mode?.id === 'embed-readonly'
                ? '![[beta.md|ro]]'
                : '[[beta.md]]',
        }),
      },
    ],
  })
  return registry
}

function makeView(
  markdown = '',
  registry: CompletionProviderRegistry = createRegistry(),
): {
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
        registry,
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

  it('switches reference modes without refetching, moving the caret, or changing source', async () => {
    const registry = createReferenceModeRegistry()
    const completeSpy = vi.spyOn(registry, 'complete')
    const { store, locator, rawView } = makeView('', registry)
    typeSource(rawView, '@alp')
    await flushCompletion()

    const popup = menu(rawView)
    expect(popup.dataset.activeMode).toBe('link')
    expect(popup.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(popup.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      'Link',
    )
    const selection = rawView.state.selection.main
    const history = store.getHistory(locator)
    const beforeSwitch = store.get(locator)
    if (!beforeSwitch) throw new Error('completion document is missing')

    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(popup.dataset.activeMode).toBe('embed')
    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(popup.dataset.activeMode).toBe('link')

    const readonlyMode = popup.querySelector<HTMLElement>(
      '[data-completion-mode-id="embed-readonly"]',
    )
    if (!readonlyMode) throw new Error('readonly completion mode is missing')
    readonlyMode.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    readonlyMode.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    expect(popup.dataset.activeMode).toBe('embed-readonly')
    expect(rawView.state.selection.main).toEqual(selection)
    expect(store.get(locator)).toEqual(beforeSwitch)
    expect(store.getHistory(locator)).toEqual(history)
    expect(completeSpy).toHaveBeenCalledTimes(1)

    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    )
    await flushCompletion()
    expect(store.get(locator)?.markdown).toBe('![[alpha.md|ro]]')
    expect(store.get(locator)?.revision).toBe(beforeSwitch.revision + 1)
  })

  it.each([
    ['link', 0, '[[alpha.md]]'],
    ['embed', 1, '![[alpha.md]]'],
    ['embed-readonly', 2, '![[alpha.md|ro]]'],
  ] as const)('applies the %s reference mode starting from @', async (
    _mode,
    tabCount,
    expected,
  ) => {
    const { store, locator, rawView } = makeView('', createReferenceModeRegistry())
    typeSource(rawView, '@alp')
    await flushCompletion()
    for (let index = 0; index < tabCount; index += 1) {
      rawView.dom.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      )
    }
    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    )
    await flushCompletion()
    expect(store.get(locator)?.markdown).toBe(expected)
  })

  it.each([
    ['@alp', 'link', '[[alpha.md]]'],
    ['[[alp', 'link', '[[alpha.md]]'],
    ['![[alp', 'embed', '![[alpha.md]]'],
    ['＠alp', 'link', '[[alpha.md]]'],
    ['［［alp', 'link', '[[alpha.md]]'],
    ['！【【alp', 'embed', '![[alpha.md]]'],
  ] as const)('selects the initial reference mode for %s', async (
    source,
    initialMode,
    expected,
  ) => {
    const { store, locator, rawView } = makeView('', createReferenceModeRegistry())
    typeSource(rawView, source)
    await flushCompletion()
    const popup = menu(rawView)
    expect(popup.dataset.activeMode).toBe(initialMode)
    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    )
    await flushCompletion()
    expect(store.get(locator)?.markdown).toBe(expected)
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

  it('keeps wraparound keyboard selection visible without changing source state', async () => {
    const registry = new CompletionProviderRegistry()
    registry.register(
      createStaticCompletionProvider({
        id: 'long-list',
        triggers: ['@'],
        items: Array.from({ length: 20 }, (_, index) => ({
          id: `item-${index + 1}`,
          label: `Item ${index + 1}`,
          insertText: `[[item-${index + 1}.md]]`,
        })),
      }),
    )
    const { store, locator, rawView } = makeView('', registry)
    typeSource(rawView, '@')
    await flushCompletion()

    const popup = menu(rawView)
    const selection = rawView.state.selection.main
    const history = store.getHistory(locator)
    Object.defineProperties(popup, {
      clientHeight: { configurable: true, value: 80 },
      clientTop: { configurable: true, value: 0 },
    })
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this === popup) {
          return { top: 0, bottom: 80, left: 0, right: 200, width: 200, height: 80 } as DOMRect
        }
        const indexText = (this as HTMLElement).dataset.completionIndex
        if (indexText !== undefined) {
          const top = Number(indexText) * 30 - popup.scrollTop
          return { top, bottom: top + 30, left: 0, right: 200, width: 200, height: 30 } as DOMRect
        }
        return originalRect.call(this)
      })

    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(popup.querySelector('[aria-selected="true"]')?.textContent).toBe('Item 20')
    expect(popup.scrollTop).toBeGreaterThan(0)

    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(popup.querySelector('[aria-selected="true"]')?.textContent).toBe('Item 1')
    expect(popup.scrollTop).toBe(0)
    expect(store.get(locator)?.markdown).toBe('@')
    expect(store.get(locator)?.revision).toBe(1)
    expect(rawView.state.selection.main).toEqual(selection)
    expect(store.getHistory(locator)).toEqual(history)
    rectSpy.mockRestore()
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
