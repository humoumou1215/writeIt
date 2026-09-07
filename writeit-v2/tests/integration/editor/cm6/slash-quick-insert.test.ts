// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
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
        store,
        locator,
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
