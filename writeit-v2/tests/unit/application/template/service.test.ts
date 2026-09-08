import { describe, expect, it } from 'vitest'
import { TemplateCatalog } from '../../../../src/application/template/catalog'
import { TemplateService } from '../../../../src/application/template/service'

describe('Template catalog and service', () => {
  it('prefers workspace templates and rescans failures safely', async () => {
    let fail = false
    const catalog = new TemplateCatalog({ list: async (scope) => { if (fail) throw new Error('offline'); return scope === 'global' ? [{ path: 'meeting.md', content: '# global' }] : [{ path: 'meeting.md', content: '# workspace' }] } })
    await catalog.rescan(); expect(catalog.get('meeting')?.scope).toBe('workspace'); expect(catalog.get('meeting')?.markdown).toContain('workspace')
    fail = true; await catalog.rescan(); expect(catalog.list()).toHaveLength(0); expect(catalog.getFailure()).toBe('offline')
  })
  it('keeps placeholders source-backed and isolates provider errors', async () => {
    const catalog = new TemplateCatalog({ list: async () => [] }); const service = new TemplateService(catalog, { enabled: true, objectsFor: async () => { throw new Error('bad') } })
    expect(service.placeholders('Hi {{name}}')[0]).toMatchObject({ from: 3, to: 11, label: 'name' })
  })
})
