import { describe, expect, it } from 'vitest'
import { AnnotationService, MemoryAnnotationRepository } from '../../../../src/application/annotation'
import { createDocumentId, createDocumentPath, createSourceChangeSet, DocumentStore, documentById } from '../../../../src/core/document'

function setup() {
  const store = new DocumentStore()
  const id = createDocumentId('annotation-doc')
  const path = createDocumentPath('notes.md')
  const markdown = 'before important phrase after'
  const document = store.load({ id, path, markdown })
  return { store, locator: documentById(id), document }
}

describe('AnnotationService sidecar contract', () => {
  it('creates/replies/resolves without mutating DocumentStore Markdown', async () => {
    const { store, document } = setup()
    const repository = new MemoryAnnotationRepository()
    const service = new AnnotationService(repository)
    const annotation = await service.create({ id: 'a1', document, from: 7, to: 23, comment: { id: 'c1', author: 'Ada', body: 'Clarify this.', createdAt: '2026-09-09T01:00:00Z' } })
    await service.reply(document.path, annotation.id, { id: 'c2', author: 'Lin', body: 'Done.', createdAt: '2026-09-09T01:01:00Z' })
    await service.setResolved(document.path, annotation.id, 'resolved', '2026-09-09T01:02:00Z')
    expect(store.get({ kind: 'id', id: document.id })?.markdown).toBe(document.markdown)
    expect((await service.list(document.path))[0].thread.resolved).toBe('resolved')
  })

  it('reanchors after a source change and fails closed after deletion', async () => {
    const { store, locator, document } = setup()
    const repository = new MemoryAnnotationRepository()
    const service = new AnnotationService(repository)
    await service.create({ id: 'a1', document, from: 7, to: 23, comment: { id: 'c1', author: 'Ada', body: 'Note', createdAt: 'now' } })
    const changed = store.applyChange(locator, { markdown: 'prefix\nbefore important phrase after', origin: { kind: 'test', source: 'annotation' } })
    await service.reanchor(document.path, changed, createSourceChangeSet(document.markdown, changed.markdown))
    expect((await service.list(document.path))[0].anchorResolution).toMatchObject({ status: 'resolved' })
    const deleted = store.applyChange(locator, { markdown: 'prefix\nbefore after', origin: { kind: 'test', source: 'annotation-delete' } })
    await service.reanchor(document.path, deleted, createSourceChangeSet(changed.markdown, deleted.markdown))
    expect((await service.list(document.path))[0].anchorResolution.status).toBe('unresolved')
  })

  it('keeps cached durable state unchanged when a sidecar save fails', async () => {
    const { document } = setup()
    const repository = new MemoryAnnotationRepository()
    const service = new AnnotationService(repository)
    const annotation = await service.create({ id: 'a1', document, from: 7, to: 23, comment: { id: 'c1', author: 'Ada', body: 'Note', createdAt: 'now' } })
    repository.failNextSave()
    await expect(service.reply(document.path, annotation.id, { id: 'c2', author: 'Lin', body: 'new', createdAt: 'later' })).rejects.toThrow(/sidecar/u)
    expect((await service.list(document.path))[0].thread.comments).toHaveLength(1)
  })
})
