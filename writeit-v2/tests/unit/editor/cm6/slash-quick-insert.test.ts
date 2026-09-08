import { describe, expect, it } from 'vitest'
import {
  filterSlashQuickInsertCommands,
  groupSlashQuickInsertCommands,
  type SlashQuickInsertCommand,
} from '../../../../src/editor/cm6/extensions/slash-quick-insert'

const commands: readonly SlashQuickInsertCommand[] = [
  { id: 'heading.one', label: 'Heading 1', group: 'Structure', keywords: ['title'] },
  { id: 'list.bullet', label: 'Bullet list', group: 'Lists', keywords: ['unordered'] },
  { id: 'heading.two', label: 'Heading 2', group: 'Structure', keywords: ['title'] },
  { id: 'block.quote', label: 'Quote', group: 'Blocks', keywords: ['callout'] },
]

describe('slash quick-insert grouping', () => {
  it('preserves first-seen group order and registration order within groups', () => {
    expect(
      groupSlashQuickInsertCommands(commands).map((group) => ({
        group: group.group,
        commands: group.commands.map((command) => command.id),
      })),
    ).toEqual([
      { group: 'Structure', commands: ['heading.one', 'heading.two'] },
      { group: 'Lists', commands: ['list.bullet'] },
      { group: 'Blocks', commands: ['block.quote'] },
    ])
  })

  it('filters globally before deriving non-empty groups', () => {
    const filtered = filterSlashQuickInsertCommands(commands, 'title')
    expect(filtered.map((command) => command.id)).toEqual([
      'heading.one',
      'heading.two',
    ])
    expect(groupSlashQuickInsertCommands(filtered).map((group) => group.group)).toEqual([
      'Structure',
    ])
  })
})
