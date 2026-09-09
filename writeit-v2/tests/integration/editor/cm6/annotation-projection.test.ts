// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createAnnotation, createRangeAnchor } from '../../../../src/core/annotation'
import { createDocumentId, createDocumentPath, documentById, DocumentStore } from '../../../../src/core/document'
import { createAnnotationExtension, mountSingleDocumentView } from '../../../../src/editor/cm6'

const source = 'Please review this sentence before merging.'

function annotation() {
  const from = source.indexOf('this')
  const anchor = createRangeAnchor(source, 'notes.md', from, from + 'this sentence'.length)
  return createAnnotation({
    id: 'a1', documentPath: 'notes.md', anchor,
    comment: { id: 'c1', author: 'Ada', body: 'Clarify.', createdAt: 'now' }, createdAt: 'now',
  })
}

describe('CM6 annotation projection', () => {
  it('marks resolved anchors without changing Markdown and activates a card callback', () => {
    const store = new DocumentStore()
    const id = createDocumentId('annotation-projection')
    const locator = documentById(id)
    store.load({ id, path: createDocumentPath('notes.md'), markdown: source })
    const item = annotation()!
    const onActivate = vi.fn()
    const projection = mountSingleDocumentView({
      store, locator, parent: document.body, projectionId: 'annotation-editor', editable: true,
      extensions: [createAnnotationExtension({ annotations: [item], onActivate })],
    })
    const mark = document.querySelector<HTMLElement>('[data-annotation-id="a1"]')!
    expect(mark.textContent).toBe('this sentence')
    mark.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onActivate).toHaveBeenCalledWith(item, expect.anything())
    expect(store.get(locator)?.markdown).toBe(source)
    expect(store.getRevision(locator)).toBe(0)
    projection.destroy()
  })
})
