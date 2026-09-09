import { describe, expect, it } from 'vitest'
import { SearchService } from '../../../../src/application/search'
import { createDocumentId, createDocumentPath, DocumentStore, documentById } from '../../../../src/core/document'

describe('SearchService', () => {
  it('caches queries and invalidates after source changes', () => {
    let calls = 0
    const service = new SearchService({ list: () => { calls += 1; return [{ path: 'a.md', markdown: 'needle' }] } })
    service.search({ text: 'needle' }); service.search({ text: 'needle' }); expect(calls).toBe(1)
    service.invalidate(); service.search({ text: 'needle' }); expect(calls).toBe(2)
  })
  it('replaces through DocumentStore revision checks', () => {
    const store = new DocumentStore(); const id = createDocumentId('a');
    store.load({ id, path: createDocumentPath('a.md'), markdown: 'before needle after' })
    const service = new SearchService({ list: () => [] })
    service.replaceInDocument(store, documentById(id), 7, 13, 'done')
    expect(store.get(documentById(id))?.markdown).toBe('before done after')
    expect(store.get(documentById(id))?.revision).toBe(1)
  })
})
