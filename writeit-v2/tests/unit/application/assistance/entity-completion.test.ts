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
  it.each([
    ['link', '[[meeting.md]]', '[[meeting.md#Decisions]]'],
    ['embed', '![[meeting.md]]', '![[meeting.md#Decisions]]'],
    ['embed-readonly', '![[meeting.md|ro]]', '![[meeting.md#Decisions|ro]]'],
  ] as const)('uses one file-self/heading contract for %s mode', async (
    mode,
    fileInsert,
    headingInsert,
  ) => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'meeting.md': '# Meeting\n\n## Decisions\n\nKeep the source authoritative.\n',
      },
    })
    const provider = createReferenceCompletionProvider({ workspace: fileSystem })
    const file = await fileItem(provider, 'meeting')
    if (!file?.children) throw new Error('file entity expansion is missing')

    const completionContext = context('@meeting', '@', mode)
    const entities = await file.children(completionContext)
    expect(entities?.map((item) => [item.kind, item.label])).toEqual([
      ['file', 'meeting'],
      ['heading', 'Meeting'],
      ['heading', 'Decisions'],
    ])
    expect(entities?.[0]?.apply?.(completionContext)).toMatchObject({
      insert: fileInsert,
    })
    expect(entities?.[2]?.apply?.(completionContext)).toMatchObject({
      insert: headingInsert,
    })
  })

  it.each([
    ['link', '[[report.md#Fields]]'],
    ['embed', '![[report.md#Fields]]'],
    ['embed-readonly', '![[report.md#Fields|ro]]'],
  ] as const)('uses static and dynamic template objects in %s mode', async (
    mode,
    objectInsert,
  ) => {
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

    const completionContext = context('[[report', '[[', mode)
    const entities = await file.children(completionContext)
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
    expect(entities?.[2]?.apply?.(context('[[report', '[[', mode))).toMatchObject({
      insert: objectInsert,
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

  it.each([
    ['@', '@', 'link'],
    ['[[', '[[', 'link'],
    ['embed', '![[' , 'embed'],
  ] as const)('enters entity candidates for the %s trigger', async (
    _label,
    triggerKind,
    mode,
  ) => {
    const fileSystem = new MemoryFileSystem({ files: { 'note.md': '# Note\n' } })
    const provider = createReferenceCompletionProvider({ workspace: fileSystem })
    const source = triggerKind === '@' ? '@note' : `${triggerKind}note`
    const file = await fileItem(provider, 'note')
    if (!file?.children) throw new Error('file entity expansion is missing')

    const completionContext = context(source, triggerKind, mode)
    const entities = await file.children(completionContext)
    expect(entities?.map((item) => item.kind)).toEqual(['file', 'heading'])
    expect(file.apply?.(completionContext)).toMatchObject({
      insert: mode === 'link' ? '[[note.md]]' : '![[note.md]]',
    })
    expect(entities?.[1]?.apply?.(completionContext)).toMatchObject({
      insert: mode === 'link' ? '[[note.md#Note]]' : '![[note.md#Note]]',
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
