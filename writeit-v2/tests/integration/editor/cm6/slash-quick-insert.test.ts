// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import { createBasicMarkdownCommandRegistry } from '../../../../src/application/commands'
import {
  createDocumentId,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import {
  createSlashQuickInsertExtension,
  mountSingleDocumentView,
  type SingleDocumentView,
} from '../../../../src/editor/cm6'

const mountedViews: SingleDocumentView[] = []

function makeView(markdown = ''): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
  projection: SingleDocumentView
  rawView: EditorView
} {
  const store = new DocumentStore()
  const id = createDocumentId('slash-quick-insert-document')
  const path = createDocumentPath('slash-quick-insert-document.md')
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
    projectionId: `slash-editor-${mountedViews.length}`,
    editable: true,
    extensions: [
      captureView,
      createSlashQuickInsertExtension({
        registry: createBasicMarkdownCommandRegistry(),
      }),
    ],
  })
  mountedViews.push(projection)
  if (!rawView) throw new Error('CM6 view was not captured')
  return { store, locator, projection, rawView }
}

function typeSlashQuery(view: EditorView, query: string): void {
  const source = `/${query}`
  view.dispatch({
    changes: { from: 0, insert: source },
    selection: { anchor: source.length },
  })
}

function menu(view: EditorView): HTMLElement {
  const element = view.dom.querySelector<HTMLElement>('[data-slash-menu]')
  if (!element) throw new Error('slash menu is not mounted')
  return element
}

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy()
})

describe('CM6 slash quick-insert surface', () => {
  it('opens on slash, filters commands, and executes keyboard selection', async () => {
    const { store, locator, rawView } = makeView()

    typeSlashQuery(rawView, 'head')

    const popup = menu(rawView)
    expect(popup.dataset.show).toBe('true')
    expect(
      [...popup.querySelectorAll<HTMLElement>('[role="option"]')].map(
        (option) => option.textContent,
      ),
    ).toEqual(['Heading 1', 'Heading 2', 'Heading 3'])

    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      }),
    )
    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(store.get(locator)?.markdown).toBe('## ')
    expect(store.get(locator)?.revision).toBe(2)
    expect(popup.dataset.show).toBe('false')
  })

  it('executes a command selected with the mouse through DocumentStore', async () => {
    const { store, locator, rawView } = makeView()
    typeSlashQuery(rawView, 'quote')

    const option = menu(rawView).querySelector<HTMLElement>(
      '[data-command-id="markdown.quote"]',
    )
    if (!option) throw new Error('quote command is not visible')
    option.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    option.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(store.get(locator)?.markdown).toBe('> ')
    expect(store.getTimeline(locator)).toContainEqual(
      expect.objectContaining({
        type: 'DocumentChanged',
        origin: { kind: 'command', source: 'markdown.quote' },
      }),
    )
  })

  it('navigates groups without leaving the editor or changing source', () => {
    const { store, locator, rawView } = makeView()
    typeSlashQuery(rawView, '')

    const popup = menu(rawView)
    const initialSelection = rawView.state.selection.main
    const initialHistory = store.getHistory(locator)
    const groupSelectors = () =>
      [...popup.querySelectorAll<HTMLElement>('[data-quick-insert-group-selector]')]
    const selectedOption = () =>
      popup.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')

    expect(groupSelectors().map((selector) => selector.textContent)).toEqual([
      'Headings',
      'Lists',
      'Blocks',
    ])
    expect(popup.dataset.activeGroup).toBe('Headings')
    expect(selectedOption()?.textContent).toBe('Heading 1')

    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(selectedOption()?.textContent).toBe('Heading 2')
    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      }),
    )
    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(selectedOption()?.textContent).toBe('Heading 3')

    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(popup.dataset.activeGroup).toBe('Lists')
    expect(selectedOption()?.textContent).toBe('Bullet list')
    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(selectedOption()?.textContent).toBe('Task list')

    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(popup.dataset.activeGroup).toBe('Headings')
    expect(selectedOption()?.textContent).toBe('Heading 1')

    const blocksSelector = popup.querySelector<HTMLElement>(
      '[data-quick-insert-group-selector][data-command-group="Blocks"]',
    )
    if (!blocksSelector) throw new Error('Blocks group selector is not visible')
    blocksSelector.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    blocksSelector.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    expect(popup.dataset.activeGroup).toBe('Blocks')
    expect(selectedOption()?.textContent).toBe('Quote')
    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(selectedOption()?.textContent).toBe('Divider')

    expect(rawView.state.selection.main).toEqual(initialSelection)
    expect(store.get(locator)?.markdown).toBe('/')
    expect(store.getHistory(locator)).toEqual(initialHistory)

    rawView.dispatch({
      changes: { from: 1, insert: 'head' },
      selection: { anchor: 5 },
    })
    expect(popup.dataset.activeGroup).toBe('Headings')
    expect(groupSelectors().map((selector) => selector.textContent)).toEqual([
      'Headings',
    ])
    expect(selectedOption()?.textContent).toBe('Heading 1')
    const filteredState = store.get(locator)
    if (!filteredState) throw new Error('filtered document is missing')
    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(store.get(locator)).toEqual(filteredState)
  })

  it('keeps wraparound keyboard selection visible without changing source state', () => {
    const { store, locator, rawView } = makeView()
    typeSlashQuery(rawView, '')
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
        const indexText = (this as HTMLElement).dataset.quickInsertIndex
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
    expect(
      popup.querySelector('[role="option"][aria-selected="true"]')?.textContent,
    ).toBe('Heading 3')
    expect(popup.scrollTop).toBeGreaterThan(0)

    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(
      popup.querySelector('[role="option"][aria-selected="true"]')?.textContent,
    ).toBe('Heading 1')
    expect(popup.scrollTop).toBe(0)
    expect(store.get(locator)?.markdown).toBe('/')
    expect(store.get(locator)?.revision).toBe(1)
    expect(rawView.state.selection.main).toEqual(selection)
    expect(store.getHistory(locator)).toEqual(history)
    rectSpy.mockRestore()
  })

  it('closes with Escape without changing the slash source', () => {
    const { store, locator, rawView } = makeView()
    typeSlashQuery(rawView, '')

    const popup = menu(rawView)
    expect(popup.dataset.show).toBe('true')
    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    )

    expect(popup.dataset.show).toBe('false')
    expect(store.get(locator)?.markdown).toBe('/')
    expect(store.get(locator)?.revision).toBe(1)
  })
})
