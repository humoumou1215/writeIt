import { describe, expect, it, vi } from 'vitest'
import {
  CommandConflictError,
  CommandNotFoundError,
  CommandRegistry,
  CommandUnavailableError,
  CommandValidationError,
} from '../../../../src/application/commands'

type Context = {
  readonly canEdit: boolean
  readonly log: string[]
}

describe('CommandRegistry', () => {
  it('registers an immutable command contract in registration order', () => {
    const registry = new CommandRegistry<Context>()
    const command = {
      id: 'editor.bold',
      label: 'Bold',
      group: 'formatting',
      keywords: [' strong ', 'emphasis'],
      availability: () => true,
      execute: (context: Context) => {
        context.log.push('bold')
      },
    }

    const unregister = registry.register(command)
    const registered = registry.get('editor.bold')

    expect(registry.has('editor.bold')).toBe(true)
    expect(registry.list()).toEqual([
      {
        id: 'editor.bold',
        label: 'Bold',
        group: 'formatting',
        keywords: ['strong', 'emphasis'],
        availability: expect.any(Function),
        execute: expect.any(Function),
      },
    ])
    expect(registered?.keywords).toEqual(['strong', 'emphasis'])
    expect(Object.isFrozen(registered)).toBe(true)
    expect(Object.isFrozen(registered?.keywords)).toBe(true)
    expect((registered as Record<string, unknown> | undefined)?.keybinding).toBe(
      undefined,
    )

    unregister()
    unregister()
    expect(registry.has('editor.bold')).toBe(false)
  })

  it('rejects duplicate ids and allows a removed id to be registered again', () => {
    const registry = new CommandRegistry<Context>()
    const command = {
      id: 'file.save',
      label: 'Save',
      group: 'file',
      keywords: [],
      availability: () => true,
      execute: () => undefined,
    }

    const unregisterFirst = registry.register(command)
    expect(() => registry.register(command)).toThrowError(
      new CommandConflictError('file.save'),
    )

    unregisterFirst()
    const unregisterSecond = registry.register(command)
    expect(registry.has('file.save')).toBe(true)
    unregisterSecond()
    expect(registry.has('file.save')).toBe(false)
  })

  it('does not execute unavailable commands and supports async availability', async () => {
    const registry = new CommandRegistry<Context>()
    const execute = vi.fn((context: Context) => context.log.push('publish'))
    registry.register({
      id: 'file.publish',
      label: 'Publish',
      group: 'file',
      keywords: ['release'],
      availability: async (context) => context.canEdit,
      execute,
    })

    const unavailable = { canEdit: false, log: [] }
    expect(await registry.isAvailable('file.publish', unavailable)).toBe(false)
    await expect(registry.execute('file.publish', unavailable)).rejects.toEqual(
      new CommandUnavailableError('file.publish'),
    )
    expect(execute).not.toHaveBeenCalled()

    const available = { canEdit: true, log: [] }
    expect(await registry.isAvailable('file.publish', available)).toBe(true)
    await registry.execute('file.publish', available)
    expect(execute).toHaveBeenCalledWith(available)
    expect(available.log).toEqual(['publish'])
  })

  it('reports unknown commands and validates the public contract', async () => {
    const registry = new CommandRegistry<Context>()

    expect(() => registry.get('')).toThrow(CommandValidationError)
    expect(() => registry.has('')).toThrow(
      new CommandValidationError('Command id must be a non-empty string'),
    )
    await expect(registry.execute('missing', { canEdit: true, log: [] })).rejects.toEqual(
      new CommandNotFoundError('missing'),
    )

    const base = {
      id: 'invalid',
      label: 'Invalid',
      group: 'test',
      keywords: [],
      availability: () => true,
      execute: () => undefined,
    }
    expect(() => registry.register({ ...base, label: ' ' })).toThrow(
      CommandValidationError,
    )
    expect(() =>
      registry.register({ ...base, keywords: [''] }),
    ).toThrow(CommandValidationError)
    expect(() =>
      registry.register({ ...base, availability: undefined as never }),
    ).toThrow(CommandValidationError)
    expect(() =>
      registry.register({ ...base, execute: undefined as never }),
    ).toThrow(CommandValidationError)
  })
})
