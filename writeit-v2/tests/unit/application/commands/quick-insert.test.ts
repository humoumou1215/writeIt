import { describe, expect, it } from 'vitest'
import {
  createBasicMarkdownCommandRegistry,
  createBasicMarkdownCommands,
  filterQuickInsertCommands,
  type QuickInsertContext,
} from '../../../../src/application/commands'

describe('basic Markdown quick-insert commands', () => {
  it('provides source-oriented Markdown commands and filters by metadata', () => {
    const commands = createBasicMarkdownCommands()

    expect(commands.map((command) => command.label)).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bullet list',
      'Numbered list',
      'Task list',
      'Quote',
      'Code block',
      'Divider',
    ])
    expect([...new Set(commands.map((command) => command.group))]).toEqual([
      'Headings',
      'Lists',
      'Blocks',
    ])
    expect(filterQuickInsertCommands(commands, 'head').map((command) => command.id)).toEqual([
      'markdown.heading-1',
      'markdown.heading-2',
      'markdown.heading-3',
    ])
    expect(filterQuickInsertCommands(commands, 'todo').map((command) => command.id)).toEqual([
      'markdown.task-list',
    ])
    expect(filterQuickInsertCommands(commands, '').length).toBe(commands.length)
  })

  it('lets commands apply a replacement through the supplied mutation bridge', async () => {
    const registry = createBasicMarkdownCommandRegistry()
    const replacements: unknown[] = []
    const context: QuickInsertContext = {
      source: '/head',
      query: 'head',
      range: { from: 0, to: 5 },
      replace: (replacement) => {
        replacements.push(replacement)
      },
    }

    await registry.execute('markdown.heading-1', context)
    await registry.execute('markdown.code-block', context)

    expect(replacements).toEqual([
      { text: '# ' },
      { text: '```\n\n```', cursorOffset: 4 },
    ])
  })
})
