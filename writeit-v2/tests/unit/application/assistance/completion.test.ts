import { describe, expect, it } from 'vitest'
import {
  CompletionProviderRegistry,
  createStaticCompletionProvider,
  findCompletionTrigger,
  filterCompletionItems,
  normalizeCompletionTriggers,
  resolveCompletionEdit,
  type CompletionContext,
  type CompletionItem,
} from '../../../../src/application/assistance'

describe('completion trigger core', () => {
  it('detects @, link, and embed triggers at the cursor', () => {
    expect(findCompletionTrigger('@al', 3)).toEqual({
      kind: '@',
      from: 0,
      to: 3,
      query: 'al',
    })
    expect(findCompletionTrigger('before [[Doc', 12)).toEqual({
      kind: '[[',
      from: 7,
      to: 12,
      query: 'Doc',
    })
    expect(findCompletionTrigger('![[Doc', 6)).toEqual({
      kind: '![[',
      from: 0,
      to: 6,
      query: 'Doc',
    })
  })

  it('chooses the latest incomplete trigger and ignores completed/boundary text', () => {
    const source = '[[done]] text [[next'
    expect(findCompletionTrigger(source, source.length)).toMatchObject({
      kind: '[[',
      from: 14,
      query: 'next',
    })
    expect(findCompletionTrigger('email@example.com', 17)).toBeUndefined()
    expect(findCompletionTrigger('word@file', 9)).toBeUndefined()
    expect(findCompletionTrigger('[[done]]', 8)).toBeUndefined()
  })

  it('normalizes full-width trigger punctuation without changing source offsets', () => {
    const source = '前文 ＠alpha'
    const normalized = normalizeCompletionTriggers(source)
    expect(normalized).toBe('前文 @alpha')
    expect(normalized).toHaveLength(source.length)
    expect(findCompletionTrigger(source, source.length)).toEqual({
      kind: '@',
      from: 3,
      to: source.length,
      query: 'alpha',
    })

    expect(findCompletionTrigger('［［Doc', 5)).toMatchObject({
      kind: '[[',
      from: 0,
      query: 'Doc',
    })
    expect(findCompletionTrigger('！【【Doc', 6)).toMatchObject({
      kind: '![[',
      from: 0,
      to: 6,
      query: 'Doc',
    })
    expect(findCompletionTrigger('【【done】】', 8)).toBeUndefined()
  })
})

describe('completion provider registry', () => {
  const items: readonly CompletionItem[] = Object.freeze([
    {
      id: 'welcome',
      label: 'Welcome document',
      detail: 'Markdown file',
      keywords: ['intro'],
      insertText: '[[welcome.md]]',
    },
    {
      id: 'notes',
      label: 'Notes document',
      insertText: '[[notes.md]]',
    },
  ])

  it('filters provider results by the active query and trigger kind', async () => {
    const registry = new CompletionProviderRegistry()
    registry.register(
      createStaticCompletionProvider({
        id: 'files',
        triggers: ['@', '[[', '![['],
        items,
      }),
    )

    const context: CompletionContext = {
      source: '@intro',
      cursor: 6,
      trigger: { kind: '@', from: 0, to: 6, query: 'intro' },
    }
    await expect(registry.complete(context)).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'welcome' })],
      errors: [],
    })
  })

  it('isolates a failing provider without losing healthy suggestions', async () => {
    const registry = new CompletionProviderRegistry()
    registry.register(
      createStaticCompletionProvider({
        id: 'healthy',
        triggers: ['[['],
        items: [items[0]],
      }),
    )
    registry.register({
      id: 'broken',
      triggers: ['[['],
      provide: () => {
        throw new Error('provider unavailable')
      },
    })

    const result = await registry.complete({
      source: '[[',
      cursor: 2,
      trigger: { kind: '[[', from: 0, to: 2, query: '' },
    })
    expect(result.items).toHaveLength(1)
    expect(result.errors).toEqual([
      expect.objectContaining({ providerId: 'broken' }),
    ])
  })

  it('resolves a provider edit without requiring an editor runtime', async () => {
    const context: CompletionContext = {
      source: '[[note',
      cursor: 6,
      trigger: { kind: '[[', from: 0, to: 6, query: 'note' },
    }
    const item: CompletionItem = {
      id: 'note-heading',
      label: 'Note heading',
      apply: (current) => ({
        from: current.trigger.from,
        to: current.trigger.to,
        insert: '[[note#Heading]]',
        cursorOffset: 16,
      }),
    }

    await expect(resolveCompletionEdit(item, context)).resolves.toEqual({
      from: 0,
      to: 6,
      insert: '[[note#Heading]]',
      cursorOffset: 16,
    })
  })

  it('exposes stable provider modes and passes only the initial mode to providers', async () => {
    const providedModes: string[] = []
    const registry = new CompletionProviderRegistry()
    registry.register({
      id: 'references',
      triggers: ['@', '[[', '![['],
      modes: [
        { id: 'link', label: 'Link' },
        { id: 'embed', label: 'Editable embed' },
        { id: 'embed-readonly', label: 'Readonly embed' },
      ],
      initialMode: (trigger) => (trigger.kind === '![[' ? 'embed' : 'link'),
      provide: (context) => {
        providedModes.push(context.mode?.id ?? 'none')
        return [
          {
            id: 'note',
            label: 'Note',
            apply: (current) => ({
              from: current.trigger.from,
              to: current.trigger.to,
              insert:
                current.mode?.id === 'embed'
                  ? '![[note.md]]'
                  : current.mode?.id === 'embed-readonly'
                    ? '![[note.md|ro]]'
                    : '[[note.md]]',
            }),
          },
        ]
      },
    })

    const linkResult = await registry.complete({
      source: '@no',
      cursor: 3,
      trigger: { kind: '@', from: 0, to: 3, query: 'no' },
    })
    expect(linkResult.modes?.map((mode) => mode.id)).toEqual([
      'link',
      'embed',
      'embed-readonly',
    ])
    expect(linkResult.initialModeId).toBe('link')
    expect(providedModes).toEqual(['link'])

    const embedResult = await registry.complete({
      source: '![[no',
      cursor: 5,
      trigger: { kind: '![[' , from: 0, to: 5, query: 'no' },
    })
    expect(embedResult.initialModeId).toBe('embed')
    expect(providedModes).toEqual(['link', 'embed'])

    const readonlyContext: CompletionContext = {
      source: '@no',
      cursor: 3,
      trigger: { kind: '@', from: 0, to: 3, query: 'no' },
      mode: { id: 'embed-readonly', label: 'Readonly embed' },
    }
    await expect(
      resolveCompletionEdit(linkResult.items[0] as CompletionItem, readonlyContext),
    ).resolves.toMatchObject({ insert: '![[note.md|ro]]' })
  })
})


describe('completion query filtering', () => {
  it('uses searchable metadata and NFKC/case-insensitive matching', () => {
    const candidates: readonly CompletionItem[] = [
      {
        id: 'heading',
        label: '标题',
        keywords: ['Section'],
        insertText: '# ',
      },
    ]

    expect(filterCompletionItems(candidates, 'ｓｅｃｔｉｏｎ')).toHaveLength(1)
    expect(filterCompletionItems(candidates, 'missing')).toHaveLength(0)
  })
})
