import { describe, expect, it } from 'vitest'
import { DiagnosticsService, DebugApi } from '../../../../src/application/diagnostics'
import { createDocumentId, createDocumentPath, DocumentStore } from '../../../../src/core/document'

describe('diagnostics and debug API', () => {
  it('keeps a bounded failure ring and excludes content by default', () => {
    const service = new DiagnosticsService(2); service.ring.recordError(new Error('a')); service.ring.recordError({ message: 'b' }); service.ring.recordError(new Error('c'))
    expect(service.ring.snapshot().errors).toHaveLength(2)
    const store = new DocumentStore(); store.load({ id: createDocumentId('x'), path: createDocumentPath('secret.md'), markdown: 'secret' })
    const report = service.report(store); expect(report.documents).toBeUndefined(); expect(report.privacy.includeDocumentContent).toBe(false)
  })
  it('requires explicit read permission for debug transport', async () => {
    const store = new DocumentStore(); const service = new DiagnosticsService(); let payload: unknown
    const api = new DebugApi(store, service, { send: (value) => { payload = value } })
    await expect(api.handle({ method: 'diagnostics.get' })).rejects.toThrow(/permission denied/)
    await api.handle({ method: 'diagnostics.get', permission: 'read-diagnostics' }); expect(payload).toBeTruthy()
  })
})
