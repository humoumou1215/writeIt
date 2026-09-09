import type { SettingsStoragePort } from '../../platform/settings'
import type { CommandId } from './registry'
import {
  KeybindingRegistry,
  type Keybinding,
  type KeybindingConfig,
  type KeybindingDefinition,
  type KeybindingEntry,
  type KeybindingValue,
} from './keybindings'

/** Metadata shown by the Shortcut Settings surface. */
export interface ShortcutCommandDefinition extends KeybindingDefinition {
  readonly label: string
  readonly group: string
  readonly keywords: readonly string[]
  readonly description?: string
}

export type ShortcutSettingsEntry = ShortcutCommandDefinition & KeybindingEntry

export const DEFAULT_SHORTCUT_COMMANDS: readonly ShortcutCommandDefinition[] =
  Object.freeze([
    {
      commandId: 'document.save',
      label: '保存文档',
      group: '文件',
      keywords: ['保存', 'save', 'write', 'persist'],
      description: '保存当前 Markdown 文档。',
      defaultKeybinding: 'Mod+S',
    },
    {
      commandId: 'editor.toggle-preview',
      label: '切换实时预览',
      group: '编辑器',
      keywords: ['源码', '预览', 'source', 'preview', 'presentation'],
      description: '在源码模式与实时预览之间切换当前编辑器。',
      defaultKeybinding: 'Mod+E',
    },
    {
      commandId: 'workspace.next-tab',
      label: '下一个标签页',
      group: '工作区',
      keywords: ['标签页', '文档', '下一个', 'tab', 'document', 'forward'],
      description: '激活下一个打开的文档标签页。',
      defaultKeybinding: 'Mod+Alt+ArrowRight',
    },
    {
      commandId: 'workspace.previous-tab',
      label: '上一个标签页',
      group: '工作区',
      keywords: ['标签页', '文档', '上一个', 'tab', 'document', 'back'],
      description: '激活上一个打开的文档标签页。',
      defaultKeybinding: 'Mod+Alt+ArrowLeft',
    },
    {
      commandId: 'editor.table.add-row-after',
      label: '在后方添加表格行',
      group: '表格',
      keywords: ['表格', '行', '添加', 'table', 'row', 'insert'],
      description: '在当前单元格所在 Markdown 表格的后方添加一行。',
      defaultKeybinding: 'Shift+Enter',
    },
  ])

export const KEYBINDING_SETTINGS_STORAGE_KEY =
  'writeit-v2.keybinding-settings'

export interface KeybindingSettingsStoreOptions {
  readonly storageKey?: string
}

export type KeybindingSettingsSnapshot = Readonly<
  Record<CommandId, Keybinding | null>
>

export type KeybindingSettingsListener = (
  snapshot: KeybindingSettingsSnapshot,
) => void

export type KeybindingSettingsUnsubscribe = () => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function freezeSnapshot(
  overrides: Readonly<Record<CommandId, KeybindingValue>>,
): KeybindingSettingsSnapshot {
  const snapshot: Record<CommandId, Keybinding | null> = {}
  for (const [commandId, keybinding] of Object.entries(overrides)) {
    snapshot[commandId] = keybinding ?? null
  }
  return Object.freeze(snapshot)
}

function decodeOverrides(raw: string | null): KeybindingConfig {
  if (raw === null) return {}

  try {
    const decoded: unknown = JSON.parse(raw)
    if (
      !isRecord(decoded) ||
      decoded.version !== 1 ||
      !isRecord(decoded.overrides)
    ) {
      return {}
    }

    const overrides: Record<CommandId, KeybindingValue> = {}
    for (const [commandId, keybinding] of Object.entries(decoded.overrides)) {
      if (keybinding === null || typeof keybinding === 'string') {
        overrides[commandId] = keybinding
      }
    }
    return overrides
  } catch {
    // Shortcut preferences are disposable UI state; corrupt data must not
    // prevent the editor from opening with its registered defaults.
    return {}
  }
}

function encodeOverrides(snapshot: KeybindingSettingsSnapshot): string {
  return JSON.stringify({ version: 1, overrides: snapshot })
}

/**
 * Application persistence for the keybinding registry.
 *
 * The registry remains the validation/atomicity authority. This store only
 * serializes successful overrides and publishes a small immutable snapshot for
 * the Settings UI; it never stores Markdown or editor state.
 */
export class KeybindingSettingsStore {
  private readonly storage: SettingsStoragePort
  private readonly storageKey: string
  private readonly registry: KeybindingRegistry
  private readonly listeners = new Set<KeybindingSettingsListener>()
  private snapshot: KeybindingSettingsSnapshot

  constructor(
    storage: SettingsStoragePort,
    registry: KeybindingRegistry,
    options: KeybindingSettingsStoreOptions = {},
  ) {
    if (storage === null || typeof storage !== 'object') {
      throw new TypeError('Keybinding settings storage is required')
    }
    if (registry === null || typeof registry !== 'object') {
      throw new TypeError('Keybinding registry is required')
    }

    this.storage = storage
    this.registry = registry
    this.storageKey = options.storageKey ?? KEYBINDING_SETTINGS_STORAGE_KEY
    if (
      typeof this.storageKey !== 'string' ||
      this.storageKey.trim().length === 0
    ) {
      throw new TypeError('Keybinding settings storage key must be non-empty')
    }

    const persisted = decodeOverrides(this.storage.read(this.storageKey))
    try {
      this.registry.setOverrides(persisted)
    } catch {
      // Unknown commands, malformed strokes, and persisted conflicts all
      // degrade to defaults. The invalid record is not re-applied or exposed.
      this.registry.resetAll()
    }
    this.snapshot = freezeSnapshot(this.registry.toOverrides())
  }

  getSnapshot(): KeybindingSettingsSnapshot {
    return this.snapshot
  }

  subscribe(
    listener: KeybindingSettingsListener,
  ): KeybindingSettingsUnsubscribe {
    if (typeof listener !== 'function') {
      throw new TypeError('Keybinding settings listener must be a function')
    }
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  set(commandId: CommandId, keybinding: string | null): KeybindingSettingsSnapshot {
    this.registry.set(commandId, keybinding)
    return this.commit()
  }

  replace(overrides: KeybindingConfig): KeybindingSettingsSnapshot {
    this.registry.setOverrides(overrides)
    return this.commit()
  }

  reset(commandId: CommandId): KeybindingSettingsSnapshot {
    this.registry.reset(commandId)
    return this.commit()
  }

  resetAll(): KeybindingSettingsSnapshot {
    this.registry.resetAll()
    return this.commit()
  }

  private commit(): KeybindingSettingsSnapshot {
    const next = freezeSnapshot(this.registry.toOverrides())
    if (sameSnapshot(next, this.snapshot)) return this.snapshot

    this.storage.write(this.storageKey, encodeOverrides(next))
    this.snapshot = next
    this.notify()
    return next
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.snapshot)
      } catch {
        // A UI observer cannot block another observer or alter the registry's
        // already-committed keybinding state.
      }
    }
  }
}

export const ShortcutSettingsStore = KeybindingSettingsStore

export function createDefaultKeybindingRegistry(
  overrides: KeybindingConfig = {},
): KeybindingRegistry {
  const definitions: readonly KeybindingDefinition[] =
    DEFAULT_SHORTCUT_COMMANDS.map(({ commandId, defaultKeybinding }) => ({
      commandId,
      defaultKeybinding,
    }))
  return new KeybindingRegistry(definitions, overrides)
}

export function createShortcutSettingsEntries(
  registry: KeybindingRegistry,
  definitions: readonly ShortcutCommandDefinition[] = DEFAULT_SHORTCUT_COMMANDS,
): readonly ShortcutSettingsEntry[] {
  return Object.freeze(
    definitions.map((definition) => {
      const entry = registry.getEntry(definition.commandId)
      return Object.freeze({
        commandId: definition.commandId,
        label: definition.label,
        group: definition.group,
        keywords: definition.keywords,
        description: definition.description,
        defaultKeybinding: entry.defaultKeybinding,
        keybinding: entry.keybinding,
        customized: entry.customized,
      })
    }),
  )
}

function sameSnapshot(
  left: KeybindingSettingsSnapshot,
  right: KeybindingSettingsSnapshot,
): boolean {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([commandId, keybinding]) => right[commandId] === keybinding,
    )
  )
}
