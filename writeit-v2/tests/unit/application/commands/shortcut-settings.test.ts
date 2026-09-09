import { describe, expect, it } from 'vitest'
import {
  createDefaultKeybindingRegistry,
  createShortcutSettingsEntries,
  DEFAULT_SHORTCUT_COMMANDS,
  KeybindingConflictError,
  KeybindingSettingsStore,
} from '../../../../src/application/commands'
import { MemorySettingsStorage } from '../../../../src/platform/settings'

describe('shortcut settings', () => {
  it('lists editor commands, including the table-specific command', () => {
    const registry = createDefaultKeybindingRegistry()
    const entries = createShortcutSettingsEntries(registry)

    expect(entries.map((entry) => entry.commandId)).toContain(
      'editor.table.add-row-after',
    )
    expect(entries.find((entry) => entry.commandId === 'editor.table.add-row-after')).toMatchObject({
      label: '在后方添加表格行',
      group: '表格',
      defaultKeybinding: 'Shift+Enter',
      keybinding: 'Shift+Enter',
      customized: false,
    })
    expect(entries.find((entry) => entry.commandId === 'workspace.next-tab')).toMatchObject({
      label: '下一个标签页',
      group: '工作区',
      defaultKeybinding: 'Mod+Alt+ArrowRight',
    })
    expect(entries.find((entry) => entry.commandId === 'workspace.previous-tab')).toMatchObject({
      label: '上一个标签页',
      group: '工作区',
      defaultKeybinding: 'Mod+Alt+ArrowLeft',
    })
    expect(entries.length).toBe(DEFAULT_SHORTCUT_COMMANDS.length)
  })

  it('persists custom bindings and restores or resets them through the store', () => {
    const storage = new MemorySettingsStorage()
    const first = new KeybindingSettingsStore(
      storage,
      createDefaultKeybindingRegistry(),
    )
    const seen: string[] = []
    first.subscribe((snapshot) => {
      seen.push(snapshot['document.save'] ?? 'unbound')
    })

    first.set('document.save', 'Ctrl+Shift+S')
    expect(seen).toEqual(['Ctrl+Shift+S'])

    const second = new KeybindingSettingsStore(
      storage,
      createDefaultKeybindingRegistry(),
    )
    expect(second.getSnapshot()['document.save']).toBe('Ctrl+Shift+S')

    second.reset('document.save')
    expect(second.getSnapshot()['document.save']).toBeUndefined()
    expect(
      createShortcutSettingsEntries(
        createDefaultKeybindingRegistry(),
      ).find((entry) => entry.commandId === 'document.save')?.defaultKeybinding,
    ).toBe('Mod+S')
  })

  it('rejects a conflict without changing the stored assignment', () => {
    const store = new KeybindingSettingsStore(
      new MemorySettingsStorage(),
      createDefaultKeybindingRegistry(),
    )

    expect(() => store.set('document.save', 'Ctrl+E')).toThrow(
      KeybindingConflictError,
    )
    expect(store.getSnapshot()['document.save']).toBeUndefined()
    expect(
      createShortcutSettingsEntries(createDefaultKeybindingRegistry()).find(
        (entry) => entry.commandId === 'document.save',
      )?.keybinding,
    ).toBe('Mod+S')
  })

  it('falls back to defaults for corrupt, unknown, or conflicting records', () => {
    const storage = new MemorySettingsStorage({
      'writeit-v2.keybinding-settings': JSON.stringify({
        version: 1,
        overrides: {
          'missing.command': 'Ctrl+M',
          'document.save': 'Mod+E',
        },
      }),
    })
    const registry = createDefaultKeybindingRegistry()
    const store = new KeybindingSettingsStore(storage, registry)

    expect(store.getSnapshot()).toEqual({})
    expect(registry.get('document.save')).toBe('Mod+S')
  })
})
