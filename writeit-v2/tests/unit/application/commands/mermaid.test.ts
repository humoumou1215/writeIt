import { describe, expect, it } from 'vitest'
import {
  createMermaidQuickInsertCommands,
  createBasicMarkdownCommandRegistry,
  registerMermaidQuickInsertCommands,
  type QuickInsertContext,
} from '../../../../src/application/commands'

describe('Mermaid quick-insert templates', () => {
  it('exposes flowchart, sequence, and state templates', () => {
    const commands = createMermaidQuickInsertCommands()
    expect(commands.map((command) => command.id)).toEqual([
      'mermaid.flowchart',
      'mermaid.sequence',
      'mermaid.state',
    ])
    expect(commands.every((command) => command.group === 'Mermaid')).toBe(true)
  })

  it('registers source templates with an in-template cursor', async () => {
    const registry = createBasicMarkdownCommandRegistry()
    registerMermaidQuickInsertCommands(registry)
    const replacements: unknown[] = []
    const context: QuickInsertContext = {
      source: '/mermaid',
      query: 'mermaid',
      range: { from: 0, to: 8 },
      replace: (replacement) => {
        replacements.push(replacement)
      },
    }
    await registry.execute('mermaid.flowchart', context)
    const replacement = replacements[0] as { text: string; cursorOffset: number }
    expect(replacement.text).toContain('```mermaid\nflowchart LR')
    expect(replacement.text[replacement.cursorOffset]).not.toBe('`')
  })
})
