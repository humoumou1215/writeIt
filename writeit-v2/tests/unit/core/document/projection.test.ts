import { describe, expect, it } from 'vitest'
import {
  DocumentStore,
  ProjectionRevisionRegressionError,
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  createRevision,
  documentById,
} from '../../../../src/core/document'

const id = createDocumentId('doc-projection')
const path = createDocumentPath('notes/projection.md')
const locator = documentById(id)
const editOrigin = createDocumentOrigin('user', 'projection-test')

function makeStore(): DocumentStore {
  const store = new DocumentStore()
  store.load({ id, path, markdown: 'initial' })
  return store
}

describe('DocumentStore projection protocol', () => {
  it('keeps generic subscriptions separate from projection lifecycle', () => {
    const store = makeStore()
    const revisions: number[] = []

    store.subscribe(locator, (event) => {
      revisions.push(event.document.revision)
    })
    store.applyChange(locator, { markdown: 'edited', origin: editOrigin })

    expect(revisions).toEqual([1])
    expect(store.getProjections(locator)).toEqual([])
    expect(store.getTimeline(locator).map((event) => event.type)).toEqual([
      'DocumentLoaded',
      'DocumentChanged',
    ])
  })

  it('detaches projection subscriptions with the projection lifecycle', () => {
    const store = makeStore()
    const revisions: number[] = []
    store.attachProjection(locator, 'editor', createRevision(0))
    store.subscribeProjection(locator, 'editor', (event) => {
      revisions.push(event.document.revision)
    })

    store.detachProjection(locator, 'editor')
    store.applyChange(locator, { markdown: 'edited', origin: editOrigin })

    expect(revisions).toEqual([])
    expect(store.getProjections(locator)).toEqual([])
  })

  it('records projection progress only after an explicit apply acknowledgement', () => {
    const store = makeStore()
    store.attachProjection(locator, 'editor', createRevision(0))
    const received: number[] = []

    store.subscribeProjection(locator, 'editor', (event) => {
      received.push(event.document.revision)
      if (event.type === 'changed') {
        store.acknowledgeProjection(locator, 'editor', event.document.revision)
      }
    })
    store.applyChange(locator, { markdown: 'edited', origin: editOrigin })

    expect(received).toEqual([1])
    expect(store.getProjection(locator, 'editor')).toMatchObject({
      projectionId: 'editor',
      revision: 1,
      stale: false,
      degraded: false,
    })
    expect(store.getTimeline(locator).map((event) => event.type)).toEqual([
      'DocumentLoaded',
      'ProjectionAttached',
      'DocumentChanged',
      'ProjectionUpdated',
    ])
  })

  it('derives lag as stale and rejects acknowledgement regression', () => {
    const store = makeStore()
    store.attachProjection(locator, 'preview', createRevision(0))
    store.subscribeProjection(locator, 'preview', () => undefined)

    store.applyChange(locator, { markdown: 'edited', origin: editOrigin })

    expect(store.getProjection(locator, 'preview')).toMatchObject({
      revision: 0,
      stale: true,
      degraded: false,
    })
    expect(() =>
      store.acknowledgeProjection(locator, 'preview', createRevision(1)),
    ).not.toThrow()
    expect(() =>
      store.acknowledgeProjection(locator, 'preview', createRevision(0)),
    ).toThrow(ProjectionRevisionRegressionError)
    expect(store.getProjection(locator, 'preview')).toMatchObject({
      revision: 1,
      stale: false,
    })
  })

  it('keeps apply failure degradation separate from revision lag', () => {
    const store = makeStore()
    store.attachProjection(locator, 'mermaid', createRevision(0))
    store.subscribeProjection(locator, 'mermaid', () => {
      throw new Error('renderer failed')
    })

    store.applyChange(locator, { markdown: 'edited', origin: editOrigin })

    expect(store.getProjection(locator, 'mermaid')).toMatchObject({
      revision: 0,
      stale: true,
      degraded: true,
      degradedReason: 'Error: renderer failed',
    })
    expect(store.getTimeline(locator)).toContainEqual(
      expect.objectContaining({
        type: 'ProjectionStale',
        projectionId: 'mermaid',
        revision: 0,
        degradedReason: 'Error: renderer failed',
      }),
    )

    store.acknowledgeProjection(locator, 'mermaid', createRevision(1))
    expect(store.getProjection(locator, 'mermaid')).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })
  })

  it('acknowledges a current source fallback without hiding render degradation', () => {
    const store = makeStore()
    store.attachProjection(locator, 'preview', createRevision(0))
    store.applyChange(locator, { markdown: 'edited', origin: editOrigin })

    store.acknowledgeProjection(locator, 'preview', createRevision(1), {
      degradedReason: 'rich renderer failed',
    })

    expect(store.getProjection(locator, 'preview')).toMatchObject({
      revision: 1,
      stale: false,
      degraded: true,
      degradedReason: 'rich renderer failed',
    })
    expect(store.getTimeline(locator)).toContainEqual(
      expect.objectContaining({
        type: 'ProjectionUpdated',
        projectionId: 'preview',
        revision: 1,
        degradedReason: 'rich renderer failed',
      }),
    )

    store.acknowledgeProjection(locator, 'preview', createRevision(1))
    expect(store.getProjection(locator, 'preview')).toMatchObject({
      revision: 1,
      stale: false,
      degraded: false,
    })
  })

  it('can mark an enhancement degraded while its source remains fresh', () => {
    const store = makeStore()
    store.attachProjection(locator, 'preview', createRevision(0))

    store.markProjectionDegraded(locator, 'preview', 'syntax renderer failed')

    expect(store.getProjection(locator, 'preview')).toMatchObject({
      revision: 0,
      stale: false,
      degraded: true,
      degradedReason: 'syntax renderer failed',
    })
    expect(store.getTimeline(locator)).toContainEqual(
      expect.objectContaining({
        type: 'ProjectionDegraded',
        projectionId: 'preview',
        revision: 0,
        reason: 'syntax renderer failed',
      }),
    )
  })
})
