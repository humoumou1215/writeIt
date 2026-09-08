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

function makeView(markdown = ''): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
  projection: SingleDocumentView
  rawView: EditorView
} {
  const fileSystem = new MemoryFileSystem({
    files: {
      'alpha.md': '# Alpha\n',
      'notes/beta.md': '# Beta\n',
      'notes/readme.markdown': '# Readme\n',
      'notes/ignored.js': 'const ignored = true\n',
      '.hidden/secret.md': '# Hidden\n',
    },
    directories: ['notes', '.hidden'],
  })
  const registry = new CompletionProviderRegistry()
  registry.register(createReferenceCompletionProvider({ workspace: fileSystem }))

  const store = new DocumentStore()
  const id = createDocumentId(`reference-completion-${mountedViews.length}`)
  const path = createDocumentPath('host.md')
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
    projectionId: `reference-completion-editor-${mountedViews.length}`,
    editable: true,
    extensions: [
      captureView,
      createCompletionExtension({ registry }),
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
  // The provider awaits one catalog read per visible directory; flush the
  // resulting promise chain without introducing a clock-based wait.
  for (let index = 0; index < 16; index += 1) await Promise.resolve()
}

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy()
})

describe('workspace-backed CM6 reference completion', () => {
  it('connects the workspace provider to @, [[, and ![[ triggers', async () => {
    for (const [source, triggerKind, expected] of [
      ['@alp', '@', '[[alpha.md]]'],
      ['[[alp', '[[', '[[alpha.md]]'],
      ['![[alp', '![[' , '![[alpha.md]]'],
    ] as const) {
      const { store, locator, rawView } = makeView()
      typeSource(rawView, source)
      await flushCompletion()

      const popup = menu(rawView)
      expect(popup.dataset.triggerKind).toBe(triggerKind)
      expect(popup.querySelectorAll('[data-completion-id="reference:file:alpha.md"]')).toHaveLength(1)

      rawView.dom.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      )
      await flushCompletion()
      expect(store.get(locator)?.markdown).toBe(source)
      rawView.dom.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      )
      await flushCompletion()
      expect(store.get(locator)?.markdown).toBe(expected)
    }
  })

  it('shows visible directories, continues a directory path, and excludes hidden descendants', async () => {
    const { store, locator, rawView } = makeView()
    typeSource(rawView, '[[no')
    await flushCompletion()

    const popup = menu(rawView)
    const directory = popup.querySelector<HTMLElement>(
      '[data-completion-kind="directory"]',
    )
    if (!directory) throw new Error('notes directory completion is missing')
    expect(directory.dataset.completionId).toBe('reference:directory:notes')
    expect(popup.querySelector('[data-completion-id*=".hidden"]')).toBeNull()
    expect(popup.querySelector('[data-completion-id*="ignored.js"]')).toBeNull()

    directory.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    directory.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    await flushCompletion()
    expect(store.get(locator)?.markdown).toBe('[[notes/')
    expect(popup.dataset.triggerKind).toBe('[[')
    expect(popup.querySelector('[data-completion-id="reference:file:notes/beta.md"]')).not.toBeNull()
    expect(popup.querySelector('[data-completion-id*=".hidden"]')).toBeNull()

    const file = popup.querySelector<HTMLElement>(
      '[data-completion-id="reference:file:notes/beta.md"]',
    )
    if (!file) throw new Error('nested beta completion is missing')
    file.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    file.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    await flushCompletion()
    expect(store.get(locator)?.markdown).toBe('[[notes/')
    const fileSelf = popup.querySelector<HTMLElement>(
      '[data-completion-id="reference:file:notes/beta.md"]',
    )
    if (!fileSelf) throw new Error('nested beta file-self entity is missing')
    fileSelf.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    fileSelf.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    await flushCompletion()
    expect(store.get(locator)?.markdown).toBe('[[notes/beta.md]]')
  })

  it('preserves provider-owned embed mode when applying a workspace file', async () => {
    const { store, locator, rawView } = makeView()
    typeSource(rawView, '![[alp')
    await flushCompletion()

    const popup = menu(rawView)
    expect(popup.dataset.activeMode).toBe('embed')
    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    )
    await flushCompletion()
    expect(store.get(locator)?.markdown).toBe('![[alp')
    rawView.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    )
    await flushCompletion()
    expect(store.get(locator)?.markdown).toBe('![[alpha.md]]')
  })
})
