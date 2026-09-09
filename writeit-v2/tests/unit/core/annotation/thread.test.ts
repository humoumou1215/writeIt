import { describe, expect, it } from 'vitest'
import { createAnnotation, createRangeAnchor, replyToAnnotation, setAnnotationResolved } from '../../../../src/core/annotation'

const source = 'Review this sentence.'

describe('annotation threads', () => {
  it('creates, replies, resolves, and unresolves immutable sidecar state', () => {
    const annotation = createAnnotation({
      id: 'a1', documentPath: 'notes.md', anchor: createRangeAnchor(source, 'notes.md', 0, 6),
      comment: { id: 'c1', author: 'Ada', body: 'Please clarify.', createdAt: '2026-09-09T01:00:00Z' }, createdAt: '2026-09-09T01:00:00Z',
    })
    const replied = replyToAnnotation(annotation, { id: 'c2', author: 'Lin', body: 'Done.', createdAt: '2026-09-09T01:01:00Z' })
    expect(annotation.thread.comments).toHaveLength(1)
    expect(replied.thread.comments).toHaveLength(2)
    expect(setAnnotationResolved(replied, 'resolved', '2026-09-09T01:02:00Z').thread.resolved).toBe('resolved')
    expect(setAnnotationResolved(replied, 'resolved', '2026-09-09T01:02:00Z').thread).not.toBe(replied.thread)
  })

  it('rejects duplicate comments and empty content', () => {
    const annotation = createAnnotation({
      id: 'a1', documentPath: 'notes.md', anchor: createRangeAnchor(source, 'notes.md', 0, 6),
      comment: { id: 'c1', author: 'Ada', body: 'Please clarify.', createdAt: 'now' }, createdAt: 'now',
    })
    expect(() => replyToAnnotation(annotation, { id: 'c1', author: 'Lin', body: 'dup', createdAt: 'later' })).toThrow(/already exists/u)
    expect(() => createAnnotation({ ...annotation, comment: { id: 'c2', author: ' ', body: 'x', createdAt: 'now' } })).toThrow(/author/u)
  })
})
