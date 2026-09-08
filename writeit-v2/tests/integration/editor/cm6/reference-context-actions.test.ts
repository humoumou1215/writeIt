// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import {
  createDocumentId,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import {
  createReferenceClipboardExtension,
  mountSingleDocumentView,
  type SingleDocumentView,
} from '../../../../src/editor/cm6'

const mounted: SingleDocumentView[] = []

function makeView(markdown = '[[target.md#Heading]]'): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
  projection: SingleDocumentView
  rawView: EditorView
  copyText: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
} {
  const store = new DocumentStore()
  const id = createDocumentId(`context-actions-${mounted.length}`)
  const locator = documentById(id)
  store.load({
    id,
    path: createDocumentPath(`context-actions-${mounted.length}.md`),
    markdown,
  })
  let rawView: EditorView | undefined
  const capture = ViewPlugin.define((view) => {
    rawView = view
    return {}
  })
  const copyText = vi.fn(async () => undefined)
  const open = vi.fn()
  const projection = mountSingleDocumentView({
    store,
    locator,
    parent: document.body,
    projectionId: `context-actions-${mounted.length}`,
    editable: true,
    extensions: [
      capture,
      createReferenceClipboardExtension({
        contextActions: {
          copyText,
          onOpen: open,
        },
      }),
    ],
  })
  mounted.push(projection)
  if (!rawView) throw new Error('CM6 view was not captured')
  return { store, locator, projection, rawView, copyText, open }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

function openContextMenu(view: EditorView): Event {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 20,
    clientY: 20,
  })
  view.dom.dispatchEvent(event)
  return event
}

afterEach(() => {
  for (const projection of mounted.splice(0)) projection.destroy()
  document.body.replaceChildren()
})

describe('CM6 reference context actions', () => {
  it('opens and copies the exact source-backed reference syntax', async () => {
    const { rawView, open, copyText } = makeView()
    const event = openContextMenu(rawView)
    const menu = document.body.querySelector<HTMLElement>(
      '[data-reference-context-menu="true"]',
    )

    expect(event.defaultPrevented).toBe(true)
    expect(menu).not.toBeNull()
    expect(menu?.querySelector('[data-reference-context-action="open"]')).not.toBeNull()

    menu
      ?.querySelector<HTMLButtonElement>('[data-reference-context-action="open"]')
      ?.click()
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      action: 'open',
      path: 'target.md',
      fragment: 'Heading',
    }))

    openContextMenu(rawView)
    document.body
      .querySelector<HTMLButtonElement>('[data-reference-context-action="copy-syntax"]')
      ?.click()
    await flush()
    expect(copyText).toHaveBeenCalledWith('[[target.md#Heading]]')
  })

  it('preserves untouched line endings while changing a reference mode', async () => {
    const { store, locator, rawView } = makeView('[[target.md]]\r\nuntouched\r\n')
    openContextMenu(rawView)
    document.body
      .querySelector<HTMLButtonElement>('[data-reference-context-mode="embed"]')
      ?.click()
    await flush()

    expect(store.get(locator)?.markdown).toBe('![[target.md]]\r\nuntouched\r\n')
  })

  it('switches link/embed modes through DocumentStore without rewriting neighbors', async () => {
    const { store, locator, rawView } = makeView('[[target.md#Heading]] before')
    // jsdom has no layout coordinates; the token starts at the beginning so
    // the DOM fallback can identify it deterministically.
    openContextMenu(rawView)
    const readonly = document.body.querySelector<HTMLButtonElement>(
      '[data-reference-context-mode="embed-readonly"]',
    )
    expect(readonly?.disabled).toBe(false)
    readonly?.click()
    await flush()
    expect(store.get(locator)?.markdown).toBe('![[target.md#Heading|ro]] before')
    expect(store.get(locator)?.revision).toBe(1)

    openContextMenu(rawView)
    const link = document.body.querySelector<HTMLButtonElement>(
      '[data-reference-context-mode="link"]',
    )
    expect(link?.disabled).toBe(false)
    link?.click()
    await flush()
    expect(store.get(locator)?.markdown).toBe('[[target.md#Heading]] before')
    expect(store.get(locator)?.revision).toBe(2)
  })
})
