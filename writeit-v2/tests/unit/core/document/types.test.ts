import { describe, expect, it } from 'vitest'
import {
  INITIAL_REVISION,
  createDocumentId,
  createDocumentPath,
  createDocumentSnapshot,
  createDocumentState,
  createRevision,
  documentById,
  documentByPath,
  isDocumentDirty,
  isDocumentLocator,
  nextRevision,
  toDocumentSnapshot,
} from '../../../../src/core/document'

describe('document types', () => {
  const id = createDocumentId('doc-1')
  const path = createDocumentPath('notes/readme.md')

  it('creates distinct document identity and path values without normalizing source text', () => {
    expect(id).toBe('doc-1')
    expect(path).toBe('notes/readme.md')
    expect(createDocumentPath('  notes/readme.md  ')).toBe('  notes/readme.md  ')
  })

  it('rejects empty identity and path values', () => {
    expect(() => createDocumentId('')).toThrow(TypeError)
    expect(() => createDocumentPath('   ')).toThrow(TypeError)
  })

  it('creates immutable runtime-discriminated document locators', () => {
    const idLocator = documentById(id)
    const pathLocator = documentByPath(path)

    expect(idLocator).toEqual({ kind: 'id', id })
    expect(pathLocator).toEqual({ kind: 'path', path })
    expect(Object.isFrozen(idLocator)).toBe(true)
    expect(Object.isFrozen(pathLocator)).toBe(true)
    expect(isDocumentLocator(idLocator)).toBe(true)
    expect(isDocumentLocator(pathLocator)).toBe(true)
    expect(isDocumentLocator(id)).toBe(false)
    expect(isDocumentLocator({ kind: 'id', id: '' })).toBe(false)
    expect(isDocumentLocator({ kind: 'path', path: '' })).toBe(false)
    expect(() => documentById('' as never)).toThrow(TypeError)
    expect(() => documentByPath('' as never)).toThrow(TypeError)
  })

  it('keeps revisions non-negative and monotonic', () => {
    expect(INITIAL_REVISION).toBe(0)
    expect(nextRevision(INITIAL_REVISION)).toBe(1)
    expect(nextRevision(createRevision(41))).toBe(42)
    expect(() => createRevision(-1)).toThrow(RangeError)
    expect(() => createRevision(1.5)).toThrow(RangeError)
  })

  it('derives dirty state from authoritative and persisted revisions', () => {
    expect(
      isDocumentDirty({ revision: createRevision(2), persistedRevision: createRevision(1) }),
    ).toBe(true)
    expect(
      isDocumentDirty({ revision: createRevision(2), persistedRevision: createRevision(2) }),
    ).toBe(false)

    const state = createDocumentState({
      id,
      path,
      markdown: '# unchanged source\n:::unknown\n',
      revision: createRevision(2),
      persistedRevision: createRevision(1),
    })

    expect(state.dirty).toBe(true)
    expect(state.markdown).toContain(':::unknown')
  })

  it('creates immutable snapshots and preserves their revision metadata', () => {
    const state = createDocumentState({
      id,
      path,
      markdown: '# title\n',
      revision: createRevision(3),
      persistedRevision: createRevision(3),
    })
    const snapshot = toDocumentSnapshot(state)

    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(snapshot).toEqual({
      id,
      path,
      markdown: '# title\n',
      revision: 3,
      persistedRevision: 3,
    })
    expect(createDocumentSnapshot(state)).not.toBe(snapshot)
  })

  it('rejects an impossible persisted revision', () => {
    expect(() =>
      createDocumentSnapshot({
        id,
        path,
        markdown: '',
        revision: createRevision(1),
        persistedRevision: createRevision(2),
      }),
    ).toThrow(RangeError)
  })
})
