// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createDocumentId, createDocumentPath, documentById, DocumentStore } from '../../../../src/core/document'
import { createBlameExtension, mountSingleDocumentView } from '../../../../src/editor/cm6'

describe('CM6 blame projection', () => {
  it('renders committed and local markers without changing source revision', () => {
    const store = new DocumentStore()
    const id = createDocumentId('blame-projection')
    const locator = documentById(id)
    store.load({ id, path: createDocumentPath('notes.md'), markdown: 'one\ntwo\nthree' })
    const onActivate = vi.fn()
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'blame-editor',
      editable: true,
      extensions: [createBlameExtension({
        lines: [
          { line: 1, kind: 'committed', authorName: 'Ada', commitId: 'abc123', summary: 'Initial' },
          { line: 2, kind: 'uncommitted' },
        ],
        onActivate,
      })],
    })
    expect(document.querySelectorAll('[data-blame-line]')).toHaveLength(2)
    expect(document.querySelector('[data-blame-line="1"]')?.textContent).toContain('Ada')
    expect(document.querySelector('[data-blame-line="2"]')?.textContent).toContain('Local')
    ;(document.querySelector('[data-blame-line="1"]') as HTMLElement).click()
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ line: 1, commitId: 'abc123' }))
    expect(store.getRevision(locator)).toBe(0)
    projection.destroy()
  })
})
