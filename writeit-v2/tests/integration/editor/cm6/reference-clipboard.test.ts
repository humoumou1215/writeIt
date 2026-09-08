// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import {
  createDocumentId,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import { ReferenceClipboardStore } from '../../../../src/core/reference'
import {
  createReferenceClipboardExtension,
  mountSingleDocumentView,
  type SingleDocumentView,
} from '../../../../src/editor/cm6'

const mounted: SingleDocumentView[] = []

function makeView(markdown = ''): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
  projection: SingleDocumentView
  rawView: EditorView
  clipboard: ReferenceClipboardStore
} {
  const store = new DocumentStore()
  const id = createDocumentId(`clipboard-editor-${mounted.length}`)
  const locator = documentById(id)
  store.load({
    id,
    path: createDocumentPath(`clipboard-editor-${mounted.length}.md`),
    markdown,
  })
  const clipboard = new ReferenceClipboardStore()
  let rawView: EditorView | undefined
  const capture = ViewPlugin.define((view) => {
    rawView = view
    return {}
  })
  const projection = mountSingleDocumentView({
    store,
    locator,
    parent: document.body,
    projectionId: `clipboard-editor-${mounted.length}`,
    editable: true,
    extensions: [
      capture,
      createReferenceClipboardExtension({ store: clipboard }),
    ],
  })
  mounted.push(projection)
  if (!rawView) throw new Error('CM6 view was not captured')
  return { store, locator, projection, rawView, clipboard }
}

function paste(target: HTMLElement, values: Readonly<Record<string, string>>): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: {
      types: Object.keys(values),
      getData: (type: string) => values[type] ?? '',
    },
  })
  target.dispatchEvent(event)
  return event
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

afterEach(() => {
  for (const projection of mounted.splice(0)) projection.destroy()
  document.body.replaceChildren()
})

describe('CM6 reference clipboard projection', () => {
  it('uses Ctrl+V/file paste as a normal link and keeps directories as text', async () => {
    const { store, locator, rawView } = makeView('prefix ')
    rawView.dispatch({ selection: { anchor: rawView.state.doc.length } })
    const event = paste(rawView.contentDOM, {
      'application/x-writeit-node': JSON.stringify([
        { kind: 'file', path: 'notes/a.md' },
        { kind: 'directory', path: 'assets' },
      ]),
    })
    await flush()

    expect(event.defaultPrevented).toBe(true)
    expect(store.get(locator)?.markdown).toBe('prefix [[notes/a.md]]\nassets')
    expect(rawView.state.doc.toString()).toBe('prefix [[notes/a.md]]\nassets')
  })

  it('accepts system text/uri-list and falls back to basename for outside files', async () => {
    const { store, locator, rawView } = makeView()
    const event = paste(rawView.contentDOM, {
      'text/uri-list': 'file:///Users/test/notes/%E6%B5%8B%E8%AF%95.md',
    })
    await flush()

    expect(event.defaultPrevented).toBe(true)
    expect(store.get(locator)?.markdown).toBe('[[测试.md]]')
  })

  it('offers right-click modes and applies the selected readonly embed', async () => {
    const { store, locator, rawView, clipboard } = makeView('before')
    clipboard.set([{ kind: 'file', path: 'target.md' }])
    rawView.dispatch({ selection: { anchor: rawView.state.doc.length } })

    const contextMenu = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 50,
    })
    rawView.dom.dispatchEvent(contextMenu)
    const menu = document.body.querySelector<HTMLElement>(
      '[data-reference-clipboard-menu]',
    )
    expect(contextMenu.defaultPrevented).toBe(true)
    expect(menu?.dataset.show).toBe('true')
    expect(menu?.querySelectorAll('[data-reference-paste-mode]')).toHaveLength(3)

    menu
      ?.querySelector<HTMLElement>('[data-reference-paste-mode="embed-readonly"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flush()

    expect(store.get(locator)?.markdown).toBe('before![[target.md|ro]]')
  })

  it('does not consume ordinary text paste or mutate readonly projections', async () => {
    const editable = makeView('source')
    paste(editable.rawView.contentDOM, {
      'text/plain': 'ordinary text',
    })
    await flush()
    expect(editable.store.get(editable.locator)?.markdown).toBe('ordinary textsource')
    expect(editable.rawView.dom.dataset.referenceClipboardError).toBeUndefined()

    const store = new DocumentStore()
    const id = createDocumentId('clipboard-readonly')
    const locator = documentById(id)
    store.load({ id, path: createDocumentPath('readonly.md'), markdown: 'source' })
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'clipboard-readonly-editor',
      editable: false,
      extensions: [createReferenceClipboardExtension()],
    })
    mounted.push(projection)
    const event = paste(projection.view.dom, {
      'application/x-writeit-node': JSON.stringify([{ kind: 'file', path: 'target.md' }]),
    })
    await flush()
    expect(event.defaultPrevented).toBe(false)
    expect(store.get(locator)?.markdown).toBe('source')
  })
})
