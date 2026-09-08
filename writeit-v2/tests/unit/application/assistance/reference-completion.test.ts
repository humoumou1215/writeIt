import { describe, expect, it, vi } from 'vitest'
import {
  CompletionProviderRegistry,
  createReferenceCompletionProvider,
  collectReferenceCompletionEntries,
  REFERENCE_COMPLETION_HIDDEN_DIRECTORY_POLICY,
  ReferenceCompletionProvider,
  ReferenceCompletionValidationError,
  ReferenceCompletionWorkspaceConsistencyError,
} from '../../../../src/application/assistance'
import type { CompletionContext } from '../../../../src/application/assistance'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'

function context(
  source: string,
  kind: '@' | '[[' | '![[' = '@',
): CompletionContext {
  const from = source.lastIndexOf(kind)
  return {
    source,
    cursor: source.length,
    trigger: {
      kind,
      from,
      to: source.length,
      query: source.slice(from + kind.length),
    },
  }
}

describe('workspace reference completion provider', () => {
  it('enumerates visible directories and supported document files recursively', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'welcome.md': '# Welcome\n',
        '.draft.md': '# Draft\n',
        'notes/architecture.md': '# Architecture\n',
        'notes/readme.MARKDOWN': '# Readme\n',
        'notes/data.txt': 'text\n',
        'notes/image.png': 'not a document',
        '.git/config': 'hidden',
        'notes/.private/secret.md': 'hidden',
      },
      directories: ['empty', '.template', 'notes/.private'],
    })

    expect(REFERENCE_COMPLETION_HIDDEN_DIRECTORY_POLICY).toBe(
      'exclude-dot-prefixed-directories-recursively',
    )
    await expect(collectReferenceCompletionEntries(fileSystem)).resolves.toEqual([
      { kind: 'directory', path: 'empty', name: 'empty' },
      { kind: 'directory', path: 'notes', name: 'notes' },
      { kind: 'file', path: 'notes/architecture.md', name: 'architecture.md' },
      { kind: 'file', path: 'notes/data.txt', name: 'data.txt' },
      { kind: 'file', path: 'notes/readme.MARKDOWN', name: 'readme.MARKDOWN' },
      { kind: 'file', path: '.draft.md', name: '.draft.md' },
      { kind: 'file', path: 'welcome.md', name: 'welcome.md' },
    ])
  })

  it('returns path-searchable file and directory items for all reference triggers', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'alpha.md': '# Alpha\n',
        'notes/beta.md': '# Beta\n',
      },
      directories: ['notes'],
    })
    const registry = new CompletionProviderRegistry()
    registry.register(createReferenceCompletionProvider({ fileSystem }))

    for (const [triggerKind, source, expected] of [
      ['@', '@alpha', '[[alpha.md]]'],
      ['[[', '[[alpha', '[[alpha.md]]'],
      ['![[', '![[alpha', '![[alpha.md]]'],
    ] as const) {
      const result = await registry.complete(context(source, triggerKind))
      expect(result.errors).toEqual([])
      expect(result.items.map((item) => item.id)).toContain(
        'reference:file:alpha.md',
      )
      const item = result.items.find(
        (candidate) => candidate.id === 'reference:file:alpha.md',
      )
      if (!item) throw new Error('alpha completion is missing')
      const edit = item.apply?.(context(source, triggerKind))
      expect(edit).toMatchObject({ insert: expected })
    }

    const nested = await registry.complete(context('[[notes/', '[['))
    expect(nested.items.map((item) => item.id)).toEqual([
      'reference:directory:notes',
      'reference:file:notes/beta.md',
    ])
    expect(nested.items[0]?.kind).toBe('directory')
  })

  it('uses provider modes for link, editable embed, and readonly embed insertion', async () => {
    const fileSystem = new MemoryFileSystem({ files: { 'note.md': '# Note\n' } })
    const provider = new ReferenceCompletionProvider({ workspace: fileSystem })
    const items = await provider.provide(context('@no'))
    const item = items.find((candidate) => candidate.id.endsWith('note.md'))
    if (!item) throw new Error('note completion is missing')

    expect(
      item.apply?.({
        ...context('@no'),
        mode: { id: 'link', label: 'Link' },
      }),
    ).toMatchObject({ insert: '[[note.md]]' })
    expect(
      item.apply?.({
        ...context('@no'),
        mode: { id: 'embed', label: 'Editable embed' },
      }),
    ).toMatchObject({ insert: '![[note.md]]' })
    expect(
      item.apply?.({
        ...context('@no'),
        mode: { id: 'embed-readonly', label: 'Readonly embed' },
      }),
    ).toMatchObject({ insert: '![[note.md|ro]]' })
  })

  it('turns a directory selection into an incomplete source-backed path', async () => {
    const fileSystem = new MemoryFileSystem({
      files: { 'notes/beta.md': '# Beta\n' },
      directories: ['notes'],
    })
    const provider = new ReferenceCompletionProvider({ workspace: fileSystem })
    const items = await provider.provide(context('[[no', '[['))
    const directory = items.find((item) => item.kind === 'directory')
    if (!directory) throw new Error('directory completion is missing')

    expect(directory.apply?.(context('[[no', '[['))).toMatchObject({
      from: 0,
      to: 4,
      insert: '[[notes/',
    })
  })

  it('re-reads the catalog for each query and isolates catalog failures in the registry', async () => {
    const listDirectory = vi
      .fn<() => Promise<never[]>>()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('workspace unavailable'))
    const workspace = { listDirectory }
    const provider = new ReferenceCompletionProvider({ workspace })
    expect(await provider.provide(context('@'))).toEqual([])
    expect(listDirectory).toHaveBeenCalledTimes(1)

    const registry = new CompletionProviderRegistry()
    registry.register(createReferenceCompletionProvider({ workspace }))
    const result = await registry.complete(context('@'))
    expect(result.items).toEqual([])
    expect(result.errors).toEqual([
      expect.objectContaining({ providerId: 'workspace-references' }),
    ])
    expect(listDirectory).toHaveBeenCalledTimes(2)
  })

  it('fails closed on malformed catalog entries and validates the seam', async () => {
    const malformed = {
      listDirectory: async () => [
        {
          kind: 'file' as const,
          path: 'wrong/name.md' as never,
          name: 'name.md',
        },
      ],
    }
    await expect(collectReferenceCompletionEntries(malformed)).rejects.toBeInstanceOf(
      ReferenceCompletionWorkspaceConsistencyError,
    )

    expect(() => new ReferenceCompletionProvider({})).toThrow(
      ReferenceCompletionValidationError,
    )
    expect(() => new ReferenceCompletionProvider({ workspace: null as never })).toThrow(
      ReferenceCompletionValidationError,
    )
    expect(() => new ReferenceCompletionProvider({
      workspace: { listDirectory: async () => [] },
      extensions: ['md'],
    })).toThrow(ReferenceCompletionValidationError)
  })
})
