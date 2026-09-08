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
  it.each([
    ['@meet', '@', 'link', '[[meeting.md#Decisions]]'],
    ['[[meet', '[[', 'link', '[[meeting.md#Decisions]]'],
    ['![[meet', '![[' , 'embed', '![[meeting.md#Decisions]]'],
    ['＠meet', '@', 'link', '[[meeting.md#Decisions]]'],
    ['［［meet', '[[', 'link', '[[meeting.md#Decisions]]'],
    ['！【【meet', '![[' , 'embed', '![[meeting.md#Decisions]]'],
  ] as const)('opens file-self and heading candidates for %s', async (
    source,
    triggerKind,
    initialMode,
    expected,
  ) => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'meeting.md': '# Meeting\n\n## Decisions\n',
      },
    })
    const registry = new CompletionProviderRegistry()
    registry.register(createReferenceCompletionProvider({ workspace: fileSystem }))
    const { store, locator, rawView } = makeView(registry)

    typeSource(rawView, source)
    await flushCompletion()
    const popup = menu(rawView)
    expect(popup.dataset.triggerKind).toBe(triggerKind)
    expect(popup.dataset.activeMode).toBe(initialMode)
    const file = popup.querySelector<HTMLElement>(
      '[data-completion-id="reference:file:meeting.md"]',
    )
    if (!file) throw new Error('meeting file completion is missing')

    const before = store.get(locator)
    const history = store.getHistory(locator)
    const selection = rawView.state.selection.main
    file.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    file.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushCompletion()

    expect(store.get(locator)).toEqual(before)
    expect(store.getHistory(locator)).toEqual(history)
    expect(rawView.state.selection.main).toEqual(selection)
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

    expect(store.get(locator)?.markdown).toBe(expected)
  })

  it.each([
    ['link', '[[meeting.md#Decisions]]'],
    ['embed', '![[meeting.md#Decisions]]'],
    ['embed-readonly', '![[meeting.md#Decisions|ro]]'],
  ] as const)('keeps navigation source-safe and applies heading in %s mode', async (
    mode,
    expected,
  ) => {
    const fileSystem = new MemoryFileSystem({
      files: { 'meeting.md': '# Meeting\n\n## Decisions\n' },
    })
    const registry = new CompletionProviderRegistry()
    registry.register(createReferenceCompletionProvider({ workspace: fileSystem }))
    const { store, locator, rawView } = makeView(registry)

    typeSource(rawView, '@meet')
    await flushCompletion()
    const popup = menu(rawView)
    const beforeMode = store.get(locator)
    const beforeHistory = store.getHistory(locator)
    const beforeSelection = rawView.state.selection.main
    if (mode !== 'link') {
      const modeButton = popup.querySelector<HTMLElement>(
        `[data-completion-mode-id="${mode}"]`,
      )
      if (!modeButton) throw new Error(`${mode} mode is missing`)
      modeButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      modeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }
    expect(popup.dataset.activeMode).toBe(mode)
    expect(store.get(locator)).toEqual(beforeMode)
    expect(store.getHistory(locator)).toEqual(beforeHistory)
    expect(rawView.state.selection.main).toEqual(beforeSelection)
    expect(popup.querySelectorAll('[data-completion-kind="file"]')).toHaveLength(1)

    const openFile = popup.querySelector<HTMLElement>(
      '[data-completion-id="reference:file:meeting.md"]',
    )
    if (!openFile) throw new Error('meeting file completion is missing')
    openFile.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    openFile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushCompletion()
    expect(store.get(locator)).toEqual(beforeMode)
    expect(store.getHistory(locator)).toEqual(beforeHistory)
    expect(rawView.state.selection.main).toEqual(beforeSelection)

    const back = popup.querySelector<HTMLElement>('[data-completion-back]')
    if (!back) throw new Error('entity back control is missing')
    back.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    back.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(popup.dataset.completionLevel).toBe('0')
    expect(store.get(locator)).toEqual(beforeMode)
    expect(store.getHistory(locator)).toEqual(beforeHistory)
    expect(rawView.state.selection.main).toEqual(beforeSelection)

    const reopenFile = popup.querySelector<HTMLElement>(
      '[data-completion-id="reference:file:meeting.md"]',
    )
    if (!reopenFile) throw new Error('meeting file completion is missing after back')
    reopenFile.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    reopenFile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushCompletion()
    const heading = popup.querySelector<HTMLElement>(
      '[data-completion-id="reference:heading:meeting.md#Decisions"]',
    )
    if (!heading) throw new Error('heading entity is missing')
    heading.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    heading.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushCompletion()
    expect(store.get(locator)?.markdown).toBe(expected)
  })

  it.each([
    ['link', '[[report.md#rows]]'],
    ['embed', '![[report.md#rows]]'],
    ['embed-readonly', '![[report.md#rows|ro]]'],
  ] as const)('uses dynamic suggestion objects through the same %s surface', async (
    mode,
    expected,
  ) => {
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
    const modeButton = popup.querySelector<HTMLElement>(
      `[data-completion-mode-id="${mode}"]`,
    )
    if (!modeButton) throw new Error(`${mode} mode is missing`)
    modeButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    modeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const file = popup.querySelector<HTMLElement>(
      '[data-completion-id="reference:file:report.md"]',
    )
    if (!file) throw new Error('report file completion is missing')
    const before = store.get(locator)
    file.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    file.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushCompletion()
    expect(store.get(locator)).toEqual(before)

    const object = popup.querySelector<HTMLElement>(
      '[data-completion-kind="object"]',
    )
    expect(object?.textContent).toContain('Rows (found)')
    object?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    object?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushCompletion()

    expect(store.get(locator)?.markdown).toBe(expected)
  })
})
