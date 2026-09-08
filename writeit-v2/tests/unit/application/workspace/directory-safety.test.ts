import { describe, expect, it } from 'vitest'
import {
  directoryMoveTarget,
  directoryRenameTarget,
  findOpenDocumentsWithinDirectory,
  findRecoveryPathsWithinDirectory,
} from '../../../../src/application/workspace'

const bindings = [
  {
    documentId: 'nested-dirty',
    path: 'notes/deep/draft.md',
    dirty: true,
  },
  {
    documentId: 'nested-clean',
    path: 'notes/other/clean.md',
    dirty: false,
  },
  {
    documentId: 'sibling',
    path: 'notes-archive/readme.md',
    dirty: false,
  },
] as const

describe('directory path safety', () => {
  it('matches descendants at any depth without confusing sibling prefixes', () => {
    expect(findOpenDocumentsWithinDirectory('notes', bindings)).toEqual([
      {
        documentId: 'nested-dirty',
        path: 'notes/deep/draft.md',
        dirty: true,
      },
      {
        documentId: 'nested-clean',
        path: 'notes/other/clean.md',
        dirty: false,
      },
    ])
    expect(findOpenDocumentsWithinDirectory('notes/deep', bindings)).toEqual([
      {
        documentId: 'nested-dirty',
        path: 'notes/deep/draft.md',
        dirty: true,
      },
    ])
    expect(findOpenDocumentsWithinDirectory('notes-archive', bindings)).toEqual([
      {
        documentId: 'sibling',
        path: 'notes-archive/readme.md',
        dirty: false,
      },
    ])
  })

  it('deduplicates recovery bindings and computes canonical targets', () => {
    expect(findRecoveryPathsWithinDirectory('notes', [
      'notes/deep/draft.md',
      'notes/deep/draft.md',
      'notes-archive/readme.md',
    ])).toEqual(['notes/deep/draft.md'])
    expect(directoryRenameTarget('notes/deep', 'renamed')).toBe('notes/renamed')
    expect(directoryMoveTarget('notes/deep', 'archive')).toBe('archive/deep')
  })

  it('fails closed for malformed runtime bindings', () => {
    expect(() =>
      findOpenDocumentsWithinDirectory('notes', [
        {
          documentId: 'invalid',
          path: '../outside.md',
          dirty: false,
        },
      ]),
    ).toThrow(/invalid/u)
    expect(() =>
      findOpenDocumentsWithinDirectory('notes', [
        {
          documentId: 'invalid',
          path: 'notes/file.md',
          dirty: 'dirty' as never,
        },
      ]),
    ).toThrow(/dirty state/u)
  })
})
