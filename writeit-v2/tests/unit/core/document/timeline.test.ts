import { describe, expect, it } from 'vitest'
import {
  DocumentStore,
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  createRevision,
  documentById,
  documentByPath,
} from '../../../../src/core/document'

const id = createDocumentId('doc-timeline')
const path = createDocumentPath('notes/timeline.md')
const idLocator = documentById(id)
const pathLocator = documentByPath(path)
const editOrigin = createDocumentOrigin('user', 'timeline-test')
const saveOrigin = createDocumentOrigin('persistence', 'memory-fs')

function loadStore(): DocumentStore {
  const store = new DocumentStore()
  store.load({ id, path, markdown: 'initial' })
  return store
}

describe('DocumentStore event timeline', () => {
  it('records document and projection facts in deterministic sequence order', () => {
    const store = new DocumentStore()
    const seen: string[] = []
    const unsubscribe = store.subscribeTimeline((event) => {
      seen.push(event.type)
    })

    store.load({ id, path, markdown: 'initial' })
    store.attachProjection(idLocator, 'main-editor', createRevision(0))
    store.applyChange(idLocator, { markdown: 'edited', origin: editOrigin })
    store.updateProjection(idLocator, 'main-editor', createRevision(1))
    store.markProjectionStale(
      idLocator,
      'main-editor',
      createRevision(0),
      'render failed',
    )
    store.updateProjection(idLocator, 'main-editor', createRevision(1))
    store.markPersisted(idLocator, createRevision(1), saveOrigin)
    store.detachProjection(pathLocator, 'main-editor')
    unsubscribe()

    expect(seen).toEqual([
      'DocumentLoaded',
      'ProjectionAttached',
      'DocumentChanged',
      'ProjectionUpdated',
      'ProjectionStale',
      'ProjectionUpdated',
      'DocumentPersisted',
      'ProjectionDetached',
    ])

    const timeline = store.getTimeline(pathLocator)
    expect(timeline.map((event) => event.sequence)).toEqual(
      timeline.map((_, index) => index + 1),
    )
    expect(timeline).toContainEqual(
      expect.objectContaining({
        type: 'ProjectionStale',
        documentId: id,
        projectionId: 'main-editor',
        revision: 0,
        reason: 'render failed',
      }),
    )
  })

  it('treats subscribed projections as lifecycle participants and reports failures as stale', () => {
    const store = loadStore()
    const unsubscribe = store.subscribe(idLocator, 'broken-preview', () => {
      throw new Error('preview cannot render')
    })

    expect(() =>
      store.applyChange(idLocator, {
        markdown: 'edited',
        origin: editOrigin,
      }),
    ).toThrow('preview cannot render')

    expect(store.getTimeline(idLocator).map((event) => event.type)).toEqual([
      'DocumentLoaded',
      'ProjectionAttached',
      'DocumentChanged',
      'ProjectionStale',
    ])
    expect(store.getTimeline(idLocator)).toContainEqual(
      expect.objectContaining({
        type: 'ProjectionStale',
        projectionId: 'broken-preview',
        revision: 0,
        reason: 'Error: preview cannot render',
      }),
    )

    unsubscribe()
    expect(store.getTimeline(idLocator).at(-1)).toMatchObject({
      type: 'ProjectionDetached',
      projectionId: 'broken-preview',
    })
  })

  it('keeps a global timeline while allowing per-document filtering', () => {
    const store = loadStore()
    const otherId = createDocumentId('other-timeline')
    const otherPath = createDocumentPath('notes/other-timeline.md')
    const otherPathLocator = documentByPath(otherPath)
    store.load({ id: otherId, path: otherPath, markdown: 'other' })
    store.applyChange(otherPathLocator, {
      markdown: 'other!',
      origin: editOrigin,
    })

    expect(store.getTimeline()).toHaveLength(3)
    expect(store.getTimeline(idLocator)).toHaveLength(1)
    expect(store.getTimeline(otherPathLocator).map((event) => event.type)).toEqual([
      'DocumentLoaded',
      'DocumentChanged',
    ])
    expect(store.getTimeline().map((event) => event.sequence)).toEqual([
      1, 2, 3,
    ])
  })
})
