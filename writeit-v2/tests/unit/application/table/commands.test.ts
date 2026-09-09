import { describe, expect, it, vi } from 'vitest'
import { createTableCommandRegistry, createTableCommands } from '../../../../src/application/table'
import { parseMarkdownTables, TABLE_COMMAND_IDS } from '../../../../src/core/table'

const source = '| A | B |\n| --- | ---: |\n| one | two |\n| three | four |\n'

describe('table application commands', () => {
  it('publishes stable unique ids through the shared CommandRegistry', () => {
    const commands = createTableCommands()
    expect(commands.map((command) => command.id)).toEqual(Object.values(TABLE_COMMAND_IDS))
    expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length)
    expect(commands.every((command) => command.group === 'Table')).toBe(true)
  })

  it('runs menu/shortcut invocations through the same pure command mapping', async () => {
    const registry = createTableCommandRegistry()
    const table = parseMarkdownTables(source)[0]
    const apply = vi.fn()
    const context = { table, target: { row: 1, column: 1 }, apply }
    await registry.execute(TABLE_COMMAND_IDS.moveColumnLeft, context)
    expect(apply).toHaveBeenCalledOnce()
    expect(apply.mock.calls[0][0].rows[0].map((cell: { value: string }) => cell.value)).toEqual(['B', 'A'])
  })

  it('makes protected structural commands unavailable', async () => {
    const registry = createTableCommandRegistry()
    const table = parseMarkdownTables('| A |\n| --- |\n| one |\n')[0]
    const context = { table, target: { row: 1, column: 0 }, apply: vi.fn() }
    expect(await registry.isAvailable(TABLE_COMMAND_IDS.deleteRow, context)).toBe(false)
    expect(await registry.isAvailable(TABLE_COMMAND_IDS.deleteColumn, context)).toBe(false)
  })
})
