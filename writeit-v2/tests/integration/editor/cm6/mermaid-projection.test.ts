// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createDocumentId, createDocumentPath, documentById, DocumentStore } from '../../../../src/core/document'
import { mountSingleDocumentView } from '../../../../src/editor/cm6'
import { createLivePreviewExtension } from '../../../../src/editor/cm6/extensions/live-preview'
import type { MermaidRenderResult } from '../../../../src/editor/cm6/widgets/mermaid'

const source = '# Diagram\n\n```mermaid\nflowchart LR\nA[Start] --> B[End]\n```\n'

function mount(renderer?: { render(source: string): MermaidRenderResult | Promise<MermaidRenderResult> }) {
  document.body.replaceChildren()
  const store = new DocumentStore()
  const id = createDocumentId('mermaid-projection')
  const locator = documentById(id)
  store.load({ id, path: createDocumentPath('diagram.md'), markdown: source })
  const projection = mountSingleDocumentView({
    store,
    locator,
    parent: document.body,
    projectionId: 'mermaid-editor',
    editable: true,
    presentationMode: 'live-preview',
    extensions: [createLivePreviewExtension({ initialMode: 'live-preview', mermaidRenderer: renderer })],
  })
  return { store, locator, projection }
}

describe('CM6 Mermaid source-backed projection', () => {
  it('renders a fenced flowchart and keeps the source out of DocumentStore mutations', async () => {
    const { store, locator, projection } = mount()
    await Promise.resolve()
    await Promise.resolve()
    expect(document.querySelector('.cm-writeit-mermaid[data-mermaid-status="ready"]')).not.toBeNull()
    expect(document.querySelectorAll('[data-mermaid-node]')).toHaveLength(2)
    expect(document.querySelector<HTMLTextAreaElement>('.cm-writeit-mermaid__editor')?.hidden).toBe(true)
    expect(store.get(locator)?.markdown).toBe(source)
    expect(store.getRevision(locator)).toBe(0)
    projection.destroy()
  })

  it('expands source, commits edits through CM6/DocumentStore, and re-renders', async () => {
    const { store, locator, projection } = mount()
    await Promise.resolve()
    document.querySelector<HTMLButtonElement>('.cm-writeit-mermaid__action')!.click()
    const editor = document.querySelector<HTMLTextAreaElement>('.cm-writeit-mermaid__editor')!
    expect(editor.hidden).toBe(false)
    editor.value = 'flowchart LR\nA[Changed] --> B[End]'
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(store.get(locator)?.markdown).toContain('A[Changed] --> B[End]')
    expect(store.getRevision(locator)).toBe(1)
    await Promise.resolve()
    expect(document.querySelector('[data-mermaid-node]')?.textContent).toContain('Changed')
    projection.destroy()
  })

  it('shows explicit renderer error with source fallback and never rewrites Markdown', async () => {
    const { store, locator, projection } = mount({ render: vi.fn(() => ({ error: 'syntax error' })) })
    await Promise.resolve()
    const card = document.querySelector<HTMLElement>('.cm-writeit-mermaid')!
    expect(card.dataset.mermaidStatus).toBe('error')
    expect(card.textContent).toContain('syntax error')
    expect(card.querySelector('textarea')?.hidden).toBe(false)
    expect(store.get(locator)?.markdown).toBe(source)
    expect(store.getRevision(locator)).toBe(0)
    projection.destroy()
  })

  it('ignores a late render result after a newer source revision replaces the widget', async () => {
    const resolvers: Array<(result: MermaidRenderResult) => void> = []
    const renderer = { render: vi.fn(() => new Promise<MermaidRenderResult>((resolve) => resolvers.push(resolve))) }
    const { store, locator, projection } = mount(renderer)
    await Promise.resolve()
    const edit = document.querySelector<HTMLButtonElement>('.cm-writeit-mermaid__action')!
    edit.click()
    const textarea = document.querySelector<HTMLTextAreaElement>('.cm-writeit-mermaid__editor')!
    textarea.value = 'flowchart LR\nA[New] --> B[End]'
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(store.getRevision(locator)).toBe(1)
    resolvers[0]?.({ error: 'old result' })
    await Promise.resolve()
    expect(document.querySelector('.cm-writeit-mermaid')?.textContent).not.toContain('old result')
    projection.destroy()
  })

  it('marks unavailable internal references without hiding the source', async () => {
    const referenceSource = '# Diagram\n\n```mermaid\nflowchart LR\nA --> B\n[[missing.md]]\n```\n'
    const store = new DocumentStore()
    const id = createDocumentId('mermaid-missing-reference')
    const locator = documentById(id)
    store.load({ id, path: createDocumentPath('notes.md'), markdown: referenceSource })
    const host = document.createElement('div')
    document.body.append(host)
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: host,
      editable: true,
      extensions: [createLivePreviewExtension({
        initialMode: 'live-preview',
        isMermaidReferenceAvailable: () => false,
      })],
    })
    await Promise.resolve()
    expect(host.querySelector('.cm-writeit-mermaid__reference--missing')?.textContent).toContain('Missing missing.md')
    expect(store.get(locator)?.markdown).toBe(referenceSource)
    projection.destroy()
  })
})
