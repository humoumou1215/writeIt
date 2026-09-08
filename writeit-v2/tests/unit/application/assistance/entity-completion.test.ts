import { describe, expect, it, vi } from 'vitest'
import {
  createReferenceCompletionProvider,
  loadReferenceCompletionEntities,
  type CompletionProvider,
} from '../../../../src/application/assistance'
import type { CompletionContext } from '../../../../src/application/assistance'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'

function context(
  source: string,
  kind: '@' | '[[' | '![[' = '@',
  mode?: 'link' | 'embed' | 'embed-readonly',
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
    ...(mode === undefined ? {} : { mode: { id: mode, label: mode } }),
  }
}

async function fileItem(provider: CompletionProvider, name: string) {
  const items = await Promise.resolve(provider.provide(context(`@${name}`)))
  return items.find((item) => item.id === `reference:file:${name}.md`)
}

describe('reference entity completion', () => {
  it('opens file-self and heading candidates as a second level', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'meeting.md': '# Meeting\n\n## Decisions\n\nKeep the source authoritative.\n',
      },
    })
    const provider = createReferenceCompletionProvider({ workspace: fileSystem })
    const file = await fileItem(provider, 'meeting')
    if (!file?.children) throw new Error('file entity expansion is missing')

    const entities = await file.children(context('@meeting'))
    expect(entities?.map((item) => [item.kind, item.label])).toEqual([
      ['file', 'meeting'],
      ['heading', 'Meeting'],
      ['heading', 'Decisions'],
    ])
    expect(entities?.[0]?.apply?.(context('@meeting'))).toMatchObject({
      insert: '[[meeting.md]]',
    })
    expect(entities?.[2]?.apply?.(context('@meeting'))).toMatchObject({
      insert: '[[meeting.md#Decisions]]',
    })
  })

  it('uses static and dynamic template objects before heading fallback', async () => {
    const dynamic = vi.fn((suggestContext: { allText(): string }) => [
      { id: 'field', label: 'Field', fragment: 'Fields' },
      { id: 'static', label: 'Dynamic collision should lose' },
      {
        id: 'progress',
        label: `Progress ${suggestContext.allText()}`,
      },
    ])
    const fileSystem = new MemoryFileSystem({
      files: { 'report.md': '# Report\n\nBody text\n' },
    })
    const provider = createReferenceCompletionProvider({
      workspace: fileSystem,
      suggestionProvider: {
        objects: [{ id: 'static', label: 'Static object' }],
        objectsFor: dynamic,
      },
    })
    const file = await fileItem(provider, 'report')
    if (!file?.children) throw new Error('file entity expansion is missing')

    const entities = await file.children(context('[[report'))
    expect(dynamic).toHaveBeenCalledTimes(1)
    expect(entities?.map((item) => item.kind)).toEqual([
      'file',
      'object',
      'object',
      'object',
    ])
    expect(entities?.map((item) => item.label)).toEqual([
      'report',
      'Static object',
      'Field',
      expect.stringContaining('Progress Body text'),
    ])
    expect(entities?.[2]?.apply?.(context('[[report'))).toMatchObject({
      insert: '[[report.md#Fields]]',
    })
  })

  it('falls back to ordinary file insertion when no entities are available', async () => {
    const fileSystem = new MemoryFileSystem({ files: { 'plain.md': 'No headings.\n' } })
    const provider = createReferenceCompletionProvider({ workspace: fileSystem })
    const file = await fileItem(provider, 'plain')
    if (!file) throw new Error('file completion is missing')

    expect(await file.children?.(context('@plain'))).toBeUndefined()
    expect(file.apply?.(context('@plain'))).toMatchObject({
      insert: '[[plain.md]]',
    })
  })

  it('does not enter entity mode for embed insertion', async () => {
    const fileSystem = new MemoryFileSystem({ files: { 'note.md': '# Note\n' } })
    const provider = createReferenceCompletionProvider({ workspace: fileSystem })
    const file = await fileItem(provider, 'note')
    if (!file?.children) throw new Error('file entity expansion is missing')

    expect(await file.children(context('![[note', '![[' , 'embed'))).toBeUndefined()
    expect(file.apply?.(context('![[note', '![[' , 'embed'))).toMatchObject({
      insert: '![[note.md]]',
    })
  })

  it('ignores headings inside fenced code and degrades on content read failures', async () => {
    const reader = {
      readFile: vi.fn(async () => '```md\n# Not a heading\n```\n\n# Real heading\n'),
    }
    const entities = await loadReferenceCompletionEntities('doc.md', {
      contentReader: reader,
    })
    expect(entities?.map((item) => item.label)).toEqual(['doc', 'Real heading'])

    const failed = await loadReferenceCompletionEntities('missing.md', {
      contentReader: {
        readFile: vi.fn(async () => {
          throw new Error('gone')
        }),
      },
    })
    expect(failed).toBeUndefined()
  })
})
