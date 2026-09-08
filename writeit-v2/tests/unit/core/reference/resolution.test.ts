import { describe, expect, it } from 'vitest'
import {
  collectWorkspaceFilePaths,
  DEFAULT_REFERENCE_EXTENSIONS,
  ReferenceResolutionValidationError,
  ReferenceWorkspaceConsistencyError,
  resolveReference,
  resolveReferencePath,
  WorkspaceReferenceResolver,
} from '../../../../src/core/reference'
import { parseReferenceAt } from '../../../../src/core/reference'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'

const files = [
  'A.md',
  'notes/Deep.md',
  'other/Deep.md',
  'plain.txt',
  'readme.markdown',
] as const

describe('reference path resolution', () => {
  it('uses exact workspace paths before extension and basename fallback', () => {
    expect(resolveReferencePath('A.md', files)).toMatchObject({
      status: 'resolved',
      strategy: 'exact',
      path: 'A.md',
      resolvedPath: 'A.md',
    })
    expect(resolveReferencePath('A', files)).toMatchObject({
      status: 'resolved',
      strategy: 'extension',
      path: 'A.md',
      attemptedPaths: ['A', 'A.md', 'A.markdown', 'A.txt'],
    })
    expect(resolveReferencePath('readme', files)).toMatchObject({
      status: 'resolved',
      strategy: 'extension',
      path: 'readme.markdown',
    })
    expect(resolveReferencePath('Deep', files)).toMatchObject({
      status: 'ambiguous',
      strategy: 'ambiguous',
      candidates: ['notes/Deep.md', 'other/Deep.md'],
      reason: 'ambiguous-basename',
    })
    expect(resolveReferencePath('plain', files)).toMatchObject({
      status: 'resolved',
      strategy: 'extension',
      path: 'plain.txt',
    })
  })

  it('reports missing paths and supports an explicit extension policy', () => {
    expect(DEFAULT_REFERENCE_EXTENSIONS).toEqual(['.md', '.markdown', '.txt'])
    expect(resolveReferencePath('missing', files)).toMatchObject({
      status: 'missing',
      strategy: 'missing',
      candidates: [],
      reason: 'not-found',
    })
    expect(
      resolveReferencePath('diagram', ['diagram.mmd'], {
        extensions: ['.mmd'],
      }),
    ).toMatchObject({
      status: 'resolved',
      strategy: 'extension',
      path: 'diagram.mmd',
    })
    expect(resolveReferencePath('Deep', files, { basenameSearch: false })).toMatchObject({
      status: 'missing',
      strategy: 'missing',
    })
  })

  it('resolves only explicit relative paths from the host and rejects traversal without a host', () => {
    expect(
      resolveReferencePath('../A', ['A.md', 'notes/A.md'], {
        hostPath: 'notes/host.md',
      }),
    ).toMatchObject({
      status: 'resolved',
      strategy: 'relative-extension',
      path: 'A.md',
    })
    expect(
      resolveReferencePath('./A', ['A.md', 'notes/A.md'], {
        hostPath: 'notes/host.md',
      }),
    ).toMatchObject({
      status: 'resolved',
      strategy: 'relative-extension',
      path: 'notes/A.md',
    })
    expect(resolveReferencePath('../A', ['A.md'])).toMatchObject({
      status: 'invalid',
      strategy: 'invalid',
      reason: 'invalid-path',
    })
    expect(
      resolveReferencePath('../../A', ['A.md'], { hostPath: 'notes/host.md' }),
    ).toMatchObject({
      status: 'invalid',
      reason: 'invalid-path',
    })
  })

  it('carries fragment, link/embed kind, and readonly mode through resolution', () => {
    const link = parseReferenceAt('[[A#Heading]]', 0)
    const embed = parseReferenceAt('![[A|ro]]', 0)
    expect(link).toBeDefined()
    expect(embed).toBeDefined()

    expect(resolveReference(link!, ['A.md'])).toMatchObject({
      status: 'resolved',
      path: 'A.md',
      kind: 'link',
      fragment: 'Heading',
      readonly: false,
    })
    expect(resolveReference(embed!, ['A.md'])).toMatchObject({
      status: 'resolved',
      path: 'A.md',
      kind: 'embed',
      fragment: null,
      readonly: true,
    })
  })

  it('rejects malformed resolver inputs instead of guessing', () => {
    expect(() => resolveReferencePath('', files)).toThrow(
      ReferenceResolutionValidationError,
    )
    expect(() => resolveReferencePath('A', ['../outside.md'])).toThrow(
      ReferenceResolutionValidationError,
    )
    expect(() =>
      resolveReferencePath('A', files, { extensions: ['md'] }),
    ).toThrow(ReferenceResolutionValidationError)
  })
})

describe('workspace-backed reference resolution', () => {
  it('collects recursive files from the workspace port and resolves source tokens', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'notes/Deep.md': '# Deep\n',
        'home.md': 'See [[Deep#Heading]] and ![[notes/Deep.md|ro]]',
      },
      directories: ['empty'],
    })

    expect(await collectWorkspaceFilePaths(fileSystem)).toEqual([
      'home.md',
      'notes/Deep.md',
    ])

    const resolver = new WorkspaceReferenceResolver(fileSystem)
    const resolutions = await resolver.resolveMarkdown(
      'See [[Deep#Heading]] and ![[notes/Deep.md|ro]]',
    )
    expect(resolutions).toHaveLength(2)
    expect(resolutions.map((resolution) => [
      resolution.kind,
      resolution.path,
      resolution.fragment,
      resolution.readonly,
      resolution.strategy,
    ])).toEqual([
      ['link', 'notes/Deep.md', 'Heading', false, 'basename'],
      ['embed', 'notes/Deep.md', null, true, 'exact'],
    ])
  })

  it('fails closed when a catalog violates its direct-child contract', async () => {
    const catalog = {
      listDirectory: async () => [
        {
          kind: 'file' as const,
          path: 'not-a-child.md' as never,
          name: 'wrong-name.md',
        },
      ],
    }
    await expect(collectWorkspaceFilePaths(catalog)).rejects.toBeInstanceOf(
      ReferenceWorkspaceConsistencyError,
    )
  })
})
