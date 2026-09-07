import { describe, expect, it } from 'vitest'
import {
  createKeybindingRegistry,
  findKeybindingConflicts,
  formatKeybindingInput,
  normalizeKeybinding,
  parseKeybinding,
  KeybindingCommandNotFoundError,
  KeybindingConflictError,
  KeybindingValidationError,
} from '../../../../src/application/commands'

describe('keybinding normalization', () => {
  it('normalizes user-facing and CodeMirror key stroke spellings', () => {
    expect(normalizeKeybinding(' ctrl + shift + p ')).toBe('Ctrl+Shift+P')
    expect(normalizeKeybinding('Mod-Shift-e')).toBe('Mod+Shift+E')
    expect(normalizeKeybinding('Option+ArrowUp')).toBe('Alt+ArrowUp')
    expect(normalizeKeybinding('cmd+,')).toBe('Meta+,')
    expect(parseKeybinding('Ctrl+Shift+P')).toEqual({
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
      mod: false,
      key: 'P',
    })
  })

  it('rejects malformed strokes and ignores modifier-only recorder input', () => {
    expect(parseKeybinding('Ctrl+')).toBeUndefined()
    expect(parseKeybinding('Control+Shift')).toBeUndefined()
    expect(() => normalizeKeybinding('Ctrl+')).toThrow(
      KeybindingValidationError,
    )
    expect(formatKeybindingInput({ key: 'Control', ctrlKey: true })).toBeUndefined()
    expect(
      formatKeybindingInput({ key: 's', ctrlKey: true, shiftKey: true }),
    ).toBe('Ctrl+Shift+S')
  })
})

describe('keybinding conflict detection', () => {
  it('groups equivalent normalized assignments without depending on UI state', () => {
    expect(
      findKeybindingConflicts({
        'file.save': 'Ctrl+S',
        'editor.save': 'ctrl+s',
        'file.open': 'Mod+O',
        'file.disabled': null,
      }),
    ).toEqual([
      {
        keybinding: 'Ctrl+S',
        commandIds: ['file.save', 'editor.save'],
      },
    ])
  })
})

describe('KeybindingRegistry', () => {
  it('keeps defaults and configurable overrides separate', () => {
    const registry = createKeybindingRegistry([
      { commandId: 'file.save', defaultKeybinding: 'Mod+S' },
      { commandId: 'file.open', defaultKeybinding: 'Mod+O' },
      { commandId: 'editor.add-row' },
    ])

    expect(registry.get('file.save')).toBe('Mod+S')
    expect(registry.getDefault('file.save')).toBe('Mod+S')
    expect(registry.get('editor.add-row')).toBeUndefined()

    registry.set('file.save', 'Ctrl+Shift+S')
    expect(registry.get('file.save')).toBe('Ctrl+Shift+S')
    expect(registry.getDefault('file.save')).toBe('Mod+S')
    expect(registry.getEntry('file.save')).toMatchObject({
      commandId: 'file.save',
      customized: true,
    })
    expect(registry.toOverrides()).toEqual({
      'file.save': 'Ctrl+Shift+S',
    })

    registry.reset('file.save')
    expect(registry.get('file.save')).toBe('Mod+S')
    expect(registry.getEntry('file.save').customized).toBe(false)
  })

  it('rejects conflicts atomically and resolves only active bindings', () => {
    const registry = createKeybindingRegistry([
      { commandId: 'file.save', defaultKeybinding: 'Mod+S' },
      { commandId: 'file.open', defaultKeybinding: 'Mod+O' },
    ])

    expect(() => registry.set('file.open', 'mod+s')).toThrow(
      KeybindingConflictError,
    )
    expect(registry.get('file.open')).toBe('Mod+O')
    expect(registry.resolve('MOD+O')).toBe('file.open')
    expect(registry.resolve('Mod+P')).toBeUndefined()
    expect(registry.conflicts()).toEqual([])

    expect(() => registry.set('missing', 'Mod+M')).toThrow(
      KeybindingCommandNotFoundError,
    )
  })

  it('applies override patches atomically and supports unbinding/resetting', () => {
    const registry = createKeybindingRegistry([
      { commandId: 'file.save', defaultKeybinding: 'Mod+S' },
      { commandId: 'file.open', defaultKeybinding: 'Mod+O' },
    ])

    registry.setOverrides({
      'file.save': null,
      'file.open': 'Mod+P',
    })
    expect(registry.toConfig()).toEqual({
      'file.save': null,
      'file.open': 'Mod+P',
    })

    expect(() =>
      registry.setOverrides({
        'file.save': 'Mod+P',
        'file.open': 'Mod+P',
      }),
    ).toThrow(KeybindingConflictError)
    expect(registry.toConfig()).toEqual({
      'file.save': null,
      'file.open': 'Mod+P',
    })

    registry.resetAll()
    expect(registry.toConfig()).toEqual({
      'file.save': 'Mod+S',
      'file.open': 'Mod+O',
    })
  })
})
