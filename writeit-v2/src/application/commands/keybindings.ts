import type { CommandId } from './registry'

/** A keybinding is stored as a normalized, single-key stroke. */
export type Keybinding = string

/** `null` explicitly unbinds a command; `undefined` means “not specified”. */
export type KeybindingValue = string | null | undefined

/**
 * A platform-independent description of a key stroke.  `Mod` is kept
 * separate from `Ctrl`/`Meta`: CM6 uses it for the primary platform modifier,
 * while explicit physical modifiers remain available for future commands.
 */
export interface ParsedKeybinding {
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
  readonly mod: boolean
  readonly key: string
}

/** Input shape used by a future UI/DOM adapter when recording a shortcut. */
export interface KeybindingKeyInput {
  readonly key: string
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
  readonly shiftKey?: boolean
  readonly metaKey?: boolean
}

export interface KeybindingDefinition {
  readonly commandId: CommandId
  readonly defaultKeybinding?: KeybindingValue
}

export interface KeybindingAssignment {
  readonly commandId: CommandId
  readonly keybinding: KeybindingValue
}

export type KeybindingConfig = Readonly<
  Record<CommandId, KeybindingValue>
>

export interface KeybindingEntry {
  readonly commandId: CommandId
  readonly defaultKeybinding?: Keybinding
  readonly keybinding?: Keybinding
  readonly customized: boolean
}

export interface KeybindingConflict {
  readonly keybinding: Keybinding
  readonly commandIds: readonly CommandId[]
}

export class KeybindingValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'KeybindingValidationError'
  }
}

export class KeybindingCommandConflictError extends Error {
  readonly commandId: CommandId

  constructor(commandId: CommandId) {
    super(`Keybinding command is already registered: ${commandId}`)
    this.name = 'KeybindingCommandConflictError'
    this.commandId = commandId
  }
}

export class KeybindingCommandNotFoundError extends Error {
  readonly commandId: CommandId

  constructor(commandId: CommandId) {
    super(`Keybinding command is not registered: ${commandId}`)
    this.name = 'KeybindingCommandNotFoundError'
    this.commandId = commandId
  }
}

export class KeybindingConflictError extends Error {
  readonly commandId: CommandId
  readonly keybinding: Keybinding
  readonly conflictingCommandIds: readonly CommandId[]

  constructor(
    commandId: CommandId,
    keybinding: Keybinding,
    conflictingCommandIds: readonly CommandId[],
  ) {
    super(
      `Keybinding ${keybinding} for ${commandId} conflicts with ${conflictingCommandIds.join(', ')}`,
    )
    this.name = 'KeybindingConflictError'
    this.commandId = commandId
    this.keybinding = keybinding
    this.conflictingCommandIds = Object.freeze([...conflictingCommandIds])
  }
}

function requireCommandId(value: unknown): CommandId {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new KeybindingValidationError(
      'Keybinding command id must be a non-empty string',
    )
  }
  return value.trim()
}

function modifierName(value: string): keyof Omit<ParsedKeybinding, 'key'> | undefined {
  const normalized = value.trim().toLocaleLowerCase()
  if (normalized === 'ctrl' || normalized === 'control') return 'ctrl'
  if (normalized === 'alt' || normalized === 'option') return 'alt'
  if (normalized === 'shift') return 'shift'
  if (
    normalized === 'meta' ||
    normalized === 'cmd' ||
    normalized === 'command' ||
    normalized === 'win' ||
    normalized === 'super'
  ) {
    return 'meta'
  }
  if (normalized === 'mod' || normalized === 'primary') return 'mod'
  return undefined
}

const KEY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ' ': 'Space',
  space: 'Space',
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  bksp: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  ins: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pgup: 'PageUp',
  pagedown: 'PageDown',
  pgdn: 'PageDown',
  left: 'ArrowLeft',
  arrowleft: 'ArrowLeft',
  right: 'ArrowRight',
  arrowright: 'ArrowRight',
  up: 'ArrowUp',
  arrowup: 'ArrowUp',
  down: 'ArrowDown',
  arrowdown: 'ArrowDown',
  comma: ',',
  period: '.',
  dot: '.',
  semicolon: ';',
  colon: ':',
  slash: '/',
  backslash: '\\',
  quote: "'",
  apostrophe: "'",
  backquote: '`',
  grave: '`',
  minus: '-',
  hyphen: '-',
  equal: '=',
  equals: '=',
  '+': 'Plus',
  plus: 'Plus',
  bracketleft: '[',
  bracketright: ']',
})

function normalizeKeyToken(value: string): string | undefined {
  // A literal single space is KeyboardEvent.key for Space. Preserve it long
  // enough for the alias lookup; trimming it would make recorder input look
  // like an empty/unbound value.
  const normalized = value.normalize('NFKC')
  const token = normalized === ' ' ? normalized : normalized.trim()
  if (token.length === 0 || modifierName(token)) return undefined

  const alias = KEY_ALIASES[token.toLocaleLowerCase()]
  if (alias !== undefined) return alias

  if (/^f(?:[1-9]|1[0-2])$/iu.test(token)) {
    return token.toLocaleUpperCase()
  }

  if (token.length === 1) return token.toLocaleUpperCase()
  if (/\s/iu.test(token)) return undefined

  // Keep uncommon KeyboardEvent keys usable without making the application
  // layer depend on DOM types. Known names are handled above; this fallback
  // gives values such as “Dead” and “Compose” a deterministic spelling.
  return token[0].toLocaleUpperCase() + token.slice(1)
}

function splitKeybinding(value: string): readonly string[] {
  // `+` is both the stroke delimiter and KeyboardEvent.key for the plus key.
  // Treat a bare plus as a key; recorded combinations use the unambiguous
  // `Plus` token instead of relying on an escaped delimiter.
  if (value === '+') return [value]
  if (value.includes('+')) return value.split('+')

  // CodeMirror uses `Mod-e`; accept that spelling in addition to the
  // user-facing `Mod+E` form. A bare hyphen remains a valid key only when it
  // is written as the final token in the plus form (`Minus` is recommended).
  if (/(?:^|-)(?:ctrl|control|alt|option|shift|meta|cmd|command|win|super|mod|primary)(?:-|$)/iu.test(value)) {
    return value.split('-')
  }
  return [value]
}

/**
 * Parses a single key stroke without touching the DOM. Invalid input returns
 * `undefined`; callers that accept persisted settings should use
 * `normalizeKeybinding`, which reports a typed validation error instead.
 */
export function parseKeybinding(
  value: unknown,
): ParsedKeybinding | undefined {
  if (typeof value !== 'string') return undefined

  // Keep a literal Space key as the final token. The normal trim path remains
  // intentionally permissive for human-entered whitespace around modifiers.
  const raw =
    value === ' '
      ? value
      : /[+-] $/.test(value)
        ? value.trimStart()
        : value.trim()
  if (raw.length === 0) return undefined

  const parts = splitKeybinding(raw)
  if (
    parts.length === 0 ||
    parts.slice(0, -1).some((part) => part.trim().length === 0)
  ) {
    return undefined
  }

  const key = normalizeKeyToken(parts[parts.length - 1])
  if (!key) return undefined

  const result = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    mod: false,
    key,
  }

  for (const part of parts.slice(0, -1)) {
    const modifier = modifierName(part)
    if (!modifier || result[modifier]) return undefined
    result[modifier] = true
  }

  return Object.freeze(result)
}

/** Serializes parsed input into the canonical comparison/display spelling. */
export function formatParsedKeybinding(
  parsed: ParsedKeybinding,
): Keybinding {
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof parsed.key !== 'string' ||
    parsed.key.length === 0
  ) {
    throw new KeybindingValidationError('Parsed keybinding is invalid')
  }

  const modifiers: string[] = []
  if (parsed.mod) modifiers.push('Mod')
  if (parsed.ctrl) modifiers.push('Ctrl')
  if (parsed.meta) modifiers.push('Meta')
  if (parsed.alt) modifiers.push('Alt')
  if (parsed.shift) modifiers.push('Shift')
  return [...modifiers, normalizeKeyToken(parsed.key) ?? parsed.key].join('+')
}

/**
 * Returns a canonical keybinding string. The canonical form is independent
 * of case and accepts both `Ctrl+Shift+P` and CM6's `Mod-Shift-p` spelling.
 */
export function normalizeKeybinding(value: string): Keybinding {
  const parsed = parseKeybinding(value)
  if (!parsed) {
    throw new KeybindingValidationError(
      `Invalid keybinding: ${String(value)}`,
    )
  }
  return formatParsedKeybinding(parsed)
}

/** Returns an unbound value for empty/null settings, otherwise normalizes it. */
function normalizeOptionalKeybinding(
  value: KeybindingValue,
  name: string,
): Keybinding | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new KeybindingValidationError(`${name} must be a string or null`)
  }
  if (value.trim().length === 0 && value !== ' ') return undefined
  try {
    return normalizeKeybinding(value)
  } catch (error) {
    if (error instanceof KeybindingValidationError) {
      throw new KeybindingValidationError(`${name}: ${error.message}`)
    }
    throw error
  }
}

function isModifierKey(value: string): boolean {
  return modifierName(value) !== undefined
}

/**
 * Formats a key recorder's plain data. Modifier-only keydown events are
 * intentionally ignored, so a future Settings UI can record one complete
 * stroke without importing this module into DOM code.
 */
export function formatKeybindingInput(
  input: KeybindingKeyInput,
): Keybinding | undefined {
  if (input === null || typeof input !== 'object') return undefined
  if (typeof input.key !== 'string' || isModifierKey(input.key)) {
    return undefined
  }

  // Normalize the key before adding modifiers. In particular, appending the
  // literal `+` to a modifier list would create ambiguous `Ctrl++` text, and
  // appending a literal Space would be trimmed as if the input were empty.
  const key = normalizeKeyToken(input.key)
  if (!key) return undefined

  return formatParsedKeybinding({
    ctrl: Boolean(input.ctrlKey),
    alt: Boolean(input.altKey),
    shift: Boolean(input.shiftKey),
    meta: Boolean(input.metaKey),
    mod: false,
    key,
  })
}

/** Alias emphasizing that the input can come from a non-DOM adapter. */
export const keybindingFromInput = formatKeybindingInput

function assignmentsFrom(
  input: KeybindingConfig | readonly KeybindingAssignment[],
): readonly KeybindingAssignment[] {
  if (Array.isArray(input)) return input
  if (input === null || typeof input !== 'object') {
    throw new KeybindingValidationError(
      'Keybinding assignments must be an array or object',
    )
  }
  return Object.freeze(
    Object.entries(input).map(([commandId, keybinding]) => ({
      commandId,
      keybinding,
    })),
  )
}

/**
 * `Mod` is the primary platform modifier. Treat it as equivalent to explicit
 * Ctrl/Meta assignments for conflict detection so a recorder cannot create a
 * shortcut that collides on the current platform.
 */
function keybindingConflictKey(keybinding: Keybinding): Keybinding {
  const parsed = parseKeybinding(keybinding)
  if (!parsed || (!parsed.mod && !parsed.ctrl && !parsed.meta)) {
    return keybinding
  }
  return formatParsedKeybinding({
    ...parsed,
    ctrl: false,
    meta: false,
    mod: true,
  })
}

/**
 * Finds all assignments that point at the same normalized stroke. This is
 * deliberately pure so P3 Settings can validate a draft before committing it.
 */
export function findKeybindingConflicts(
  input: KeybindingConfig | readonly KeybindingAssignment[],
): readonly KeybindingConflict[] {
  const byKey = new Map<
    Keybinding,
    { readonly keybinding: Keybinding; readonly commandIds: CommandId[] }
  >()

  for (const assignment of assignmentsFrom(input)) {
    if (assignment === null || typeof assignment !== 'object') {
      throw new KeybindingValidationError('Keybinding assignment must be an object')
    }
    const commandId = requireCommandId(assignment.commandId)
    const keybinding = normalizeOptionalKeybinding(
      assignment.keybinding,
      `Keybinding for ${commandId}`,
    )
    if (!keybinding) continue

    const comparisonKey = keybindingConflictKey(keybinding)
    const group = byKey.get(comparisonKey) ?? {
      keybinding,
      commandIds: [],
    }
    if (!group.commandIds.includes(commandId)) group.commandIds.push(commandId)
    byKey.set(comparisonKey, group)
  }

  return Object.freeze(
    [...byKey.values()]
      .filter((group) => group.commandIds.length > 1)
      .map((group) =>
        Object.freeze({
          keybinding: group.keybinding,
          commandIds: Object.freeze([...group.commandIds]),
        }),
      ),
  )
}

/** Compatibility name for callers that use “detect” rather than “find”. */
export const detectKeybindingConflicts = findKeybindingConflicts

export function hasKeybindingConflicts(
  input: KeybindingConfig | readonly KeybindingAssignment[],
): boolean {
  return findKeybindingConflicts(input).length > 0
}

interface MutableKeybindingEntry {
  readonly token: object
  readonly commandId: CommandId
  readonly defaultKeybinding?: Keybinding
  overrideSet: boolean
  override?: Keybinding
}

export type UnregisterKeybinding = () => void

/**
 * Stores defaults and user overrides by opaque command id. Commands remain
 * independent of this registry: a command can be invoked from menus or other
 * providers even when it has no keybinding.
 *
 * `set` and `setOverrides` reject conflicts atomically. The standalone
 * `findKeybindingConflicts` function remains available for Settings drafts
 * that need to show all conflicts before applying anything.
 */
export class KeybindingRegistry {
  private readonly entries = new Map<CommandId, MutableKeybindingEntry>()

  constructor(
    definitions: readonly KeybindingDefinition[] = [],
    overrides: KeybindingConfig = {},
  ) {
    for (const definition of definitions) this.register(definition)
    this.setOverrides(overrides)
  }

  register(
    definition: KeybindingDefinition,
  ): UnregisterKeybinding {
    if (definition === null || typeof definition !== 'object') {
      throw new KeybindingValidationError('Keybinding definition must be an object')
    }
    const commandId = requireCommandId(definition.commandId)
    if (this.entries.has(commandId)) {
      throw new KeybindingCommandConflictError(commandId)
    }

    const defaultKeybinding = normalizeOptionalKeybinding(
      definition.defaultKeybinding,
      `Default keybinding for ${commandId}`,
    )
    const entry: MutableKeybindingEntry = {
      token: {},
      commandId,
      defaultKeybinding,
      overrideSet: false,
    }
    const candidate = this.assignmentsWith(entry)
    const conflicts = findKeybindingConflicts(candidate)
    if (conflicts.length > 0) {
      const conflict = conflicts[0]
      throw new KeybindingConflictError(
        commandId,
        conflict.keybinding,
        conflict.commandIds.filter((id) => id !== commandId),
      )
    }

    this.entries.set(commandId, entry)
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      if (this.entries.get(commandId) === entry) this.entries.delete(commandId)
    }
  }

  has(commandId: CommandId): boolean {
    return this.entries.has(requireCommandId(commandId))
  }

  get(commandId: CommandId): Keybinding | undefined {
    return this.effective(this.requireEntry(commandId))
  }

  getDefault(commandId: CommandId): Keybinding | undefined {
    return this.requireEntry(commandId).defaultKeybinding
  }

  getEntry(commandId: CommandId): KeybindingEntry {
    const entry = this.requireEntry(commandId)
    return Object.freeze({
      commandId: entry.commandId,
      defaultKeybinding: entry.defaultKeybinding,
      keybinding: this.effective(entry),
      customized: entry.overrideSet,
    })
  }

  list(): readonly KeybindingEntry[] {
    return Object.freeze([...this.entries.values()].map((entry) => this.getEntry(entry.commandId)))
  }

  /** Returns the command bound to a stroke, or undefined when it is unbound. */
  resolve(keybinding: string): CommandId | undefined {
    const normalized = normalizeKeybinding(keybinding)
    for (const entry of this.entries.values()) {
      if (this.effective(entry) === normalized) return entry.commandId
    }
    return undefined
  }

  /**
   * Resolves a recorder/KeyboardEvent-shaped stroke. `Mod` defaults are the
   * platform primary modifier, so Ctrl and Meta input both match a Mod entry;
   * explicit Ctrl/Meta assignments remain distinct.
   */
  resolveInput(input: KeybindingKeyInput): CommandId | undefined {
    const recorded = formatKeybindingInput(input)
    if (recorded === undefined) return undefined

    const direct = this.resolve(recorded)
    if (direct !== undefined) return direct

    const parsed = parseKeybinding(recorded)
    if (!parsed || (!parsed.ctrl && !parsed.meta)) return undefined
    return this.resolve(
      formatParsedKeybinding({
        ...parsed,
        ctrl: false,
        meta: false,
        mod: true,
      }),
    )
  }

  set(commandId: CommandId, keybinding: string | null): void {
    const entry = this.requireEntry(commandId)
    const normalized = normalizeOptionalKeybinding(
      keybinding,
      `Keybinding for ${entry.commandId}`,
    )
    this.assertNoConflict(entry.commandId, normalized)
    entry.overrideSet = true
    entry.override = normalized
  }

  /** Applies a patch atomically; null unbinds and undefined resets to default. */
  setOverrides(overrides: KeybindingConfig): void {
    if (overrides === null || typeof overrides !== 'object') {
      throw new KeybindingValidationError('Keybinding overrides must be an object')
    }

    const candidate = new Map<CommandId, Keybinding | undefined>()
    for (const entry of this.entries.values()) {
      candidate.set(entry.commandId, this.effective(entry))
    }

    for (const [rawCommandId, value] of Object.entries(overrides)) {
      const commandId = requireCommandId(rawCommandId)
      const entry = this.requireEntry(commandId)
      candidate.set(
        commandId,
        value === undefined
          ? entry.defaultKeybinding
          : normalizeOptionalKeybinding(value, `Keybinding for ${commandId}`),
      )
    }

    const conflicts = findKeybindingConflicts(
      [...candidate.entries()].map(([commandId, keybinding]) => ({
        commandId,
        keybinding,
      })),
    )
    if (conflicts.length > 0) {
      const conflict = conflicts[0]
      const commandId = conflict.commandIds[conflict.commandIds.length - 1]
      throw new KeybindingConflictError(
        commandId,
        conflict.keybinding,
        conflict.commandIds.filter((id) => id !== commandId),
      )
    }

    for (const [rawCommandId, value] of Object.entries(overrides)) {
      const commandId = requireCommandId(rawCommandId)
      const entry = this.requireEntry(commandId)
      if (value === undefined) {
        entry.overrideSet = false
        entry.override = undefined
      } else {
        entry.overrideSet = true
        entry.override = normalizeOptionalKeybinding(
          value,
          `Keybinding for ${commandId}`,
        )
      }
    }
  }

  reset(commandId: CommandId): void {
    const entry = this.requireEntry(commandId)
    this.assertNoConflict(entry.commandId, entry.defaultKeybinding)
    entry.overrideSet = false
    entry.override = undefined
  }

  resetAll(): void {
    const defaults = [...this.entries.values()].map((entry) => ({
      commandId: entry.commandId,
      keybinding: entry.defaultKeybinding,
    }))
    const conflicts = findKeybindingConflicts(defaults)
    if (conflicts.length > 0) {
      const conflict = conflicts[0]
      const commandId = conflict.commandIds[conflict.commandIds.length - 1]
      throw new KeybindingConflictError(
        commandId,
        conflict.keybinding,
        conflict.commandIds.filter((id) => id !== commandId),
      )
    }
    for (const entry of this.entries.values()) {
      entry.overrideSet = false
      entry.override = undefined
    }
  }

  /** Active conflicts should always be empty because writes are atomic. */
  conflicts(): readonly KeybindingConflict[] {
    return findKeybindingConflicts(this.assignments())
  }

  toConfig(): Readonly<Record<CommandId, Keybinding | null>> {
    const config: Record<CommandId, Keybinding | null> = {}
    for (const entry of this.entries.values()) {
      config[entry.commandId] = this.effective(entry) ?? null
    }
    return Object.freeze(config)
  }

  toOverrides(): Readonly<Record<CommandId, Keybinding | null>> {
    const overrides: Record<CommandId, Keybinding | null> = {}
    for (const entry of this.entries.values()) {
      if (!entry.overrideSet) continue
      overrides[entry.commandId] = entry.override ?? null
    }
    return Object.freeze(overrides)
  }

  private requireEntry(commandId: CommandId): MutableKeybindingEntry {
    const normalized = requireCommandId(commandId)
    const entry = this.entries.get(normalized)
    if (!entry) throw new KeybindingCommandNotFoundError(normalized)
    return entry
  }

  private effective(entry: MutableKeybindingEntry): Keybinding | undefined {
    return entry.overrideSet ? entry.override : entry.defaultKeybinding
  }

  private assignments(): readonly KeybindingAssignment[] {
    return [...this.entries.values()].map((entry) => ({
      commandId: entry.commandId,
      keybinding: this.effective(entry),
    }))
  }

  private assignmentsWith(
    additional: MutableKeybindingEntry,
  ): readonly KeybindingAssignment[] {
    return [
      ...this.assignments(),
      {
        commandId: additional.commandId,
        keybinding: this.effective(additional),
      },
    ]
  }

  private assertNoConflict(
    commandId: CommandId,
    keybinding: Keybinding | undefined,
  ): void {
    const assignments = this.assignments().map((assignment) =>
      assignment.commandId === commandId
        ? { ...assignment, keybinding }
        : assignment,
    )
    const conflicts = findKeybindingConflicts(assignments)
    if (conflicts.length === 0) return
    const conflict = conflicts[0]
    throw new KeybindingConflictError(
      commandId,
      conflict.keybinding,
      conflict.commandIds.filter((id) => id !== commandId),
    )
  }
}

export function createKeybindingRegistry(
  definitions: readonly KeybindingDefinition[] = [],
  overrides: KeybindingConfig = {},
): KeybindingRegistry {
  return new KeybindingRegistry(definitions, overrides)
}
