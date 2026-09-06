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
    store.markProjectionStale(idLocator, 'main-editor', 'render failed')
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
        revision: 1,
        reason: 'render failed',
      }),
    )
  })

  it('isolates a failed projection and continues healthy fan-out', () => {
    const failures: unknown[] = []
    const store = new DocumentStore({
      observerErrorSink: (context) => failures.push(context),
    })
    store.load({ id, path, markdown: 'initial' })
    const healthyRevisions: number[] = []
    store.attachProjection(idLocator, 'broken-preview')
    store.attachProjection(idLocator, 'healthy-editor')
    const unsubscribeBroken = store.subscribeProjection(
      idLocator,
      'broken-preview',
      () => {
        throw new Error('preview cannot render')
      },
    )
    const unsubscribeHealthy = store.subscribeProjection(
      idLocator,
      'healthy-editor',
      (event) => healthyRevisions.push(event.document.revision),
    )

    const result = store.applyChange(idLocator, {
      markdown: 'edited',
      origin: editOrigin,
    })

    expect(result.revision).toBe(1)
    expect(healthyRevisions).toEqual([1])
    expect(store.get(idLocator)?.markdown).toBe('edited')
    expect(failures).toContainEqual(
      expect.objectContaining({
        source: 'document-store',
        eventType: 'changed',
        documentId: id,
        projectionId: 'broken-preview',
      }),
    )
    expect(store.getTimeline(idLocator).map((event) => event.type)).toEqual([
      'DocumentLoaded',
      'ProjectionAttached',
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

    unsubscribeBroken()
    unsubscribeHealthy()
    store.detachProjection(idLocator, 'broken-preview')
    store.detachProjection(idLocator, 'healthy-editor')
    expect(store.getTimeline(idLocator).at(-2)).toMatchObject({
      type: 'ProjectionDetached',
      projectionId: 'broken-preview',
    })
  })

  it('isolates timeline listener failures and preserves later observers', () => {
    const failures: unknown[] = []
    const store = new DocumentStore({
      observerErrorSink: (context) => failures.push(context),
    })
    const seen: string[] = []
    store.subscribeTimeline(() => {
      throw new Error('diagnostics unavailable')
    })
    store.subscribeTimeline((event) => seen.push(event.type))

    store.load({ id, path, markdown: 'initial' })
    const changed = store.applyChange(idLocator, {
      markdown: 'edited',
      origin: editOrigin,
    })

    expect(changed.revision).toBe(1)
    expect(seen).toEqual(['DocumentLoaded', 'DocumentChanged'])
    expect(failures).toHaveLength(2)
    expect(failures).toContainEqual(
      expect.objectContaining({
        source: 'timeline',
        eventType: 'DocumentChanged',
        documentId: id,
      }),
    )
  })

  it('queues re-entrant source changes until the current fan-out completes', () => {
    const store = loadStore()
    const firstProjectionRevisions: number[] = []
    const secondProjectionRevisions: number[] = []
    let nested = false
    store.attachProjection(idLocator, 'first-projection')
    store.attachProjection(idLocator, 'second-projection')

    store.subscribeProjection(idLocator, 'first-projection', (event) => {
      firstProjectionRevisions.push(event.document.revision)
      if (event.type === 'changed' && event.document.revision === 1 && !nested) {
        nested = true
        expect(
          store.applyChange(idLocator, {
            markdown: 'second',
            origin: editOrigin,
          }).revision,
        ).toBe(2)
      }
    })
    store.subscribeProjection(idLocator, 'second-projection', (event) => {
      secondProjectionRevisions.push(event.document.revision)
    })

    expect(
      store.applyChange(idLocator, {
        markdown: 'first',
        origin: editOrigin,
      }).revision,
    ).toBe(1)

    expect(firstProjectionRevisions).toEqual([1, 2])
    expect(secondProjectionRevisions).toEqual([1, 2])
    expect(store.getRevision(idLocator)).toBe(2)
    expect(store.get(idLocator)?.markdown).toBe('second')
    expect(
      store
        .getTimeline(idLocator)
        .filter((event) => event.type === 'DocumentChanged')
        .map((event) => event.document.revision),
    ).toEqual([1, 2])
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
