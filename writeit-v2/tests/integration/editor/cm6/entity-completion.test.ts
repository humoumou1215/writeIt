// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import {
  CompletionProviderRegistry,
  createReferenceCompletionProvider,
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
import { MemoryFileSystem } from '../../../../src/platform/filesystem'

const mountedViews: SingleDocumentView[] = []

function makeView(
  registry: CompletionProviderRegistry,
  markdown = '',
): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
  projection: SingleDocumentView
  rawView: EditorView
} {
  const store = new DocumentStore()
  const id = createDocumentId(`entity-completion-${mountedViews.length}`)
  const locator = documentById(id)
  store.load({
    id,
    path: createDocumentPath('host.md'),
    markdown,
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
    projectionId: `entity-completion-editor-${mountedViews.length}`,
    editable: true,
    extensions: [capture, createCompletionExtension({ registry })],
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
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy()
})

describe('CM6 entity completion surface', () => {
  it('keeps the source unchanged while opening file-self and heading candidates', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'meeting.md': '# Meeting\n\n## Decisions\n',
      },
    })
    const registry = new CompletionProviderRegistry()
    registry.register(createReferenceCompletionProvider({ workspace: fileSystem }))
    const { store, locator, rawView } = makeView(registry)

    typeSource(rawView, '[[meet')
    await flushCompletion()
    const popup = menu(rawView)
    const file = popup.querySelector<HTMLElement>(
      '[data-completion-id="reference:file:meeting.md"]',
    )
    if (!file) throw new Error('meeting file completion is missing')

    file.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    file.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushCompletion()

    expect(store.get(locator)?.markdown).toBe('[[meet')
    expect(popup.dataset.completionLevel).toBe('1')
    expect(popup.querySelector('[data-completion-kind="file"]')).not.toBeNull()
    expect(
      popup.querySelector('[data-completion-id="reference:heading:meeting.md#Decisions"]'),
    ).not.toBeNull()

    const heading = popup.querySelector<HTMLElement>(
      '[data-completion-id="reference:heading:meeting.md#Decisions"]',
    )
    if (!heading) throw new Error('heading entity is missing')
    heading.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    heading.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushCompletion()

    expect(store.get(locator)?.markdown).toBe('[[meeting.md#Decisions]]')
  })

  it('uses dynamic suggestion objects through the same completion surface', async () => {
    const fileSystem = new MemoryFileSystem({
      files: { 'report.md': '# Report\n\nRows: 3\n' },
    })
    const registry = new CompletionProviderRegistry()
    registry.register(
      createReferenceCompletionProvider({
        workspace: fileSystem,
        suggestionProvider: {
          objectsFor: (context) => [
            {
              id: 'rows',
              label: `Rows (${context.allText().includes('Rows') ? 'found' : 'missing'})`,
            },
          ],
        },
      }),
    )
    const { store, locator, rawView } = makeView(registry)

    typeSource(rawView, '@report')
    await flushCompletion()
    const popup = menu(rawView)
    const file = popup.querySelector<HTMLElement>(
      '[data-completion-id="reference:file:report.md"]',
    )
    if (!file) throw new Error('report file completion is missing')
    file.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    file.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushCompletion()

    const object = popup.querySelector<HTMLElement>(
      '[data-completion-kind="object"]',
    )
    expect(object?.textContent).toContain('Rows (found)')
    object?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    object?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushCompletion()

    expect(store.get(locator)?.markdown).toBe('[[report.md#rows]]')
  })
})
