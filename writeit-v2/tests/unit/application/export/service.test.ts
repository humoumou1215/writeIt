import { describe, expect, it } from 'vitest'
import { ExportService } from '../../../../src/application/export'
import { createDocumentId, createDocumentPath, DocumentStore, documentById } from '../../../../src/core/document'

describe('ExportService', () => {
  it('exports immutable snapshots in built-in formats without mutating Store', async () => {
    const store = new DocumentStore(); const id = createDocumentId('export')
    store.load({ id, path: createDocumentPath('note.md'), markdown: '# Hello 世界', })
    const service = new ExportService(); const snapshot = service.snapshot(store, documentById(id))
    for (const format of ['markdown', 'pdf', 'docx'] as const) {
      const result = await service.export(snapshot, { format }); expect(result.success).toBe(true); expect(result.output?.bytes.length).toBeGreaterThan(0)
    }
    expect(store.get(documentById(id))?.markdown).toBe('# Hello 世界')
  })
  it('keeps partial batch failures visible', async () => {
    const service = new ExportService(); service.register({ format: 'custom', export: () => { throw new Error('nope') } })
    const results = await service.batch([{ snapshot: { id: 'a', path: createDocumentPath('a.md'), markdown: 'a', revision: 0 }, context: { format: 'custom' } }, { snapshot: { id: 'b', path: createDocumentPath('b.md'), markdown: 'b', revision: 0 }, context: { format: 'markdown' } }])
    expect(results[0].success).toBe(false); expect(results[1].success).toBe(true)
  })
})
