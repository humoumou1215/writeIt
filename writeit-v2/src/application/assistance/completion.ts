export type CompletionTriggerKind = '@' | '[[' | '![['

export interface CompletionTrigger {
  readonly kind: CompletionTriggerKind
  /** Absolute source offset of the trigger opener. */
  readonly from: number
  /** Absolute source offset of the cursor at which the query ends. */
  readonly to: number
  readonly query: string
}

/** A provider-owned insertion presentation, not a trigger kind. */
export type CompletionModeId = string

export interface CompletionMode {
  /** Stable provider-defined identifier used by apply contracts. */
  readonly id: CompletionModeId
  /** Human-readable and accessible label for the mode selector. */
  readonly label: string
  readonly description?: string
}

export type CompletionInitialMode =
  | CompletionModeId
  | ((trigger: CompletionTrigger) => CompletionModeId)

/**
 * Chinese IMEs can emit these full-width punctuation characters while the
 * user is entering a reference. Detection uses this exact, one-code-unit
 * mapping so source offsets remain valid; callers must keep the original
 * Markdown source unchanged.
 */
const FULL_WIDTH_TRIGGER_MAP: Readonly<Record<string, string>> = Object.freeze({
  '＠': '@',
  '！': '!',
  '【': '[',
  '［': '[',
  '】': ']',
  '］': ']',
})

export function normalizeCompletionTriggers(source: string): string {
  if (typeof source !== 'string') {
    throw new TypeError('Completion trigger source must be a string')
  }

  let normalized = ''
  for (const character of source) {
    normalized += FULL_WIDTH_TRIGGER_MAP[character] ?? character
  }
  return normalized
}

/** Compatibility name for the trigger-core behavior documented by legacy. */
export const normalizeTriggers = normalizeCompletionTriggers

export interface CompletionContext {
  readonly source: string
  readonly cursor: number
  readonly trigger: CompletionTrigger
  /** The active provider-declared insertion mode, when one exists. */
  readonly mode?: CompletionMode
}

export interface CompletionEdit {
  /** Absolute source offset of the range to replace. */
  readonly from: number
  readonly to: number
  readonly insert: string
  /** Cursor offset from the beginning of `insert`. */
  readonly cursorOffset?: number
}

export type CompletionApplyResult = CompletionEdit | string

export type CompletionItemKind =
  | 'file'
  | 'directory'
  | 'object'
  | 'heading'

export type CompletionChildrenResult = readonly CompletionItem[] | null | undefined

/**
 * Opens a provider-owned second level without mutating Markdown. The editor
 * adapter keeps the original trigger active until a leaf item is applied.
 */
export type CompletionChildrenResolver = (
  context: CompletionContext,
) => CompletionChildrenResult | Promise<CompletionChildrenResult>

export interface CompletionItem {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly keywords?: readonly string[]
  /** Optional semantic kind used by source-backed workspace candidates. */
  readonly kind?: CompletionItemKind
  /** Used when the default trigger range is sufficient. */
  readonly insertText?: string
  /** Allows a provider to calculate a source-backed edit without knowing CM6. */
  readonly apply?: (
    context: CompletionContext,
  ) => CompletionApplyResult | Promise<CompletionApplyResult>
  /** Optional hierarchical candidates (for example file → heading/object). */
  readonly children?: CompletionChildrenResolver
}

export interface CompletionProvider {
  readonly id: string
  readonly triggers: readonly CompletionTriggerKind[]
  /**
   * Optional insertion modes. Trigger detection remains independent from this
   * list; the adapter can switch modes without querying the provider again.
   */
  readonly modes?: readonly CompletionMode[]
  readonly initialMode?: CompletionInitialMode
  readonly provide: (
    context: CompletionContext,
  ) => readonly CompletionItem[] | Promise<readonly CompletionItem[]>
}

export interface CompletionProviderError {
  readonly providerId: string
  readonly error: unknown
}

export interface CompletionQueryResult {
  readonly items: readonly CompletionItem[]
  readonly errors: readonly CompletionProviderError[]
  /** The session mode set contributed by the provider(s), if any. */
  readonly modes?: readonly CompletionMode[]
  /** Initial mode selected for the current trigger. */
  readonly initialModeId?: CompletionModeId
}

export class CompletionValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'CompletionValidationError'
  }
}

export class CompletionProviderConflictError extends Error {
  readonly providerId: string

  constructor(providerId: string) {
    super(`Completion provider is already registered: ${providerId}`)
    this.name = 'CompletionProviderConflictError'
    this.providerId = providerId
  }
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CompletionValidationError(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function requireSource(source: string): void {
  if (typeof source !== 'string') {
    throw new TypeError('Completion source must be a string')
  }
}

function requireCursor(source: string, cursor: number): number {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > source.length) {
    throw new RangeError('Completion cursor must be inside the source')
  }
  return cursor
}

function normalizeTriggerKind(value: unknown): CompletionTriggerKind {
  // Keep this check explicit rather than relying on a string cast at provider
  // registration boundaries. Detection normalizes IME punctuation before this
  // provider-facing kind reaches the registry.
  if (value === '@' || value === '[[' || value === '![[') return value
  throw new CompletionValidationError(`Unknown completion trigger: ${String(value)}`)
}

function incompleteBracketTrigger(
  source: string,
  cursor: number,
  opener: '[[' | '![[',
  kind: CompletionTriggerKind,
): CompletionTrigger | undefined {
  let searchEnd = cursor - opener.length

  while (searchEnd >= 0) {
    const from = source.lastIndexOf(opener, searchEnd)
    if (from < 0) return undefined

    // A bare `[[` inside `![[]` must not steal the embed trigger. The longer
    // opener owns the replacement range and preserves the leading `!`.
    if (kind === '[[' && source[from - 1] === '!') {
      searchEnd = from - 1
      continue
    }

    const query = source.slice(from + opener.length, cursor)
    if (!/[\r\n]/u.test(query) && !query.includes(']]')) {
      return Object.freeze({
        kind,
        from,
        to: cursor,
        query,
      })
    }

    // This opener is complete or spans a line. An earlier opener may still be
    // the active incomplete trigger in malformed/partially edited Markdown.
    searchEnd = from - 1
  }

  return undefined
}

/**
 * Finds the active completion trigger immediately before a collapsed cursor.
 * Full-width trigger punctuation is normalized only in a detection copy. The
 * returned offsets refer to the original source and the CompletionContext
 * still carries the original Markdown, so opening the menu is source-safe.
 */
export function findCompletionTrigger(
  source: string,
  cursor: number,
): CompletionTrigger | undefined {
  requireSource(source)
  const position = requireCursor(source, cursor)
  const normalizedSource = normalizeCompletionTriggers(source)
  const candidates: CompletionTrigger[] = []

  const embed = incompleteBracketTrigger(normalizedSource, position, '![[', '![[')
  if (embed) candidates.push(embed)

  const link = incompleteBracketTrigger(normalizedSource, position, '[[', '[[')
  if (link) candidates.push(link)

  const lineStart = normalizedSource.lastIndexOf('\n', position - 1) + 1
  const beforeCursor = normalizedSource.slice(lineStart, position)
  const atMatch = /(^|[\s])@([^\s]*)$/u.exec(beforeCursor)
  if (atMatch) {
    const atOffset = atMatch.index + atMatch[0].indexOf('@')
    candidates.push(
      Object.freeze({
        kind: '@',
        from: lineStart + atOffset,
        to: position,
        query: atMatch[2],
      }),
    )
  }

  candidates.sort(
    (left, right) =>
      right.from - left.from ||
      right.kind.length - left.kind.length,
  )
  return candidates[0]
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

export function completionSearchText(item: CompletionItem): string {
  return normalizeSearchText(
    [item.id, item.label, item.detail ?? '', ...(item.keywords ?? [])].join(' '),
  )
}

export function matchesCompletionQuery(
  item: CompletionItem,
  query: string,
): boolean {
  if (typeof query !== 'string') return false
  const normalizedQuery = normalizeSearchText(query.trim())
  if (normalizedQuery.length === 0) return true
  return completionSearchText(item).includes(normalizedQuery)
}

export function filterCompletionItems(
  items: readonly CompletionItem[],
  query: string,
): readonly CompletionItem[] {
  return Object.freeze(items.filter((item) => matchesCompletionQuery(item, query)))
}

function normalizeCompletionItem(
  item: CompletionItem,
  providerId: string,
  index: number,
): CompletionItem {
  if (item === null || typeof item !== 'object') {
    throw new CompletionValidationError(
      `Completion provider ${providerId} item ${index} must be an object`,
    )
  }
  const id = requireText(item.id, `Completion provider ${providerId} item ${index} id`)
  const label = requireText(
    item.label,
    `Completion provider ${providerId} item ${index} label`,
  )
  if (item.detail !== undefined && typeof item.detail !== 'string') {
    throw new CompletionValidationError(
      `Completion item ${id} detail must be a string when provided`,
    )
  }
  if (
    item.kind !== undefined &&
    item.kind !== 'file' &&
    item.kind !== 'directory' &&
    item.kind !== 'object' &&
    item.kind !== 'heading'
  ) {
    throw new CompletionValidationError(
      `Completion item ${id} kind must be file, directory, object, or heading when provided`,
    )
  }
  if (item.keywords !== undefined && !Array.isArray(item.keywords)) {
    throw new CompletionValidationError(
      `Completion item ${id} keywords must be an array when provided`,
    )
  }
  const keywords = (item.keywords ?? []).map((keyword, keywordIndex) =>
    requireText(keyword, `Completion item ${id} keyword ${keywordIndex}`),
  )
  if (item.insertText !== undefined && typeof item.insertText !== 'string') {
    throw new CompletionValidationError(
      `Completion item ${id} insertText must be a string when provided`,
    )
  }
  if (item.apply !== undefined && typeof item.apply !== 'function') {
    throw new CompletionValidationError(
      `Completion item ${id} apply must be a function when provided`,
    )
  }
  if (item.children !== undefined && typeof item.children !== 'function') {
    throw new CompletionValidationError(
      `Completion item ${id} children must be a function when provided`,
    )
  }
  if (
    item.insertText === undefined &&
    item.apply === undefined &&
    item.children === undefined
  ) {
    throw new CompletionValidationError(
      `Completion item ${id} must provide insertText, apply, or children`,
    )
  }

  return Object.freeze({
    id,
    label,
    ...(item.detail === undefined ? {} : { detail: item.detail }),
    ...(item.kind === undefined ? {} : { kind: item.kind }),
    keywords: Object.freeze(keywords),
    ...(item.insertText === undefined ? {} : { insertText: item.insertText }),
    ...(item.apply === undefined ? {} : { apply: item.apply }),
    ...(item.children === undefined ? {} : { children: item.children }),
  })
}

function normalizeCompletionMode(
  mode: CompletionMode,
  providerId: string,
  index: number,
): CompletionMode {
  if (mode === null || typeof mode !== 'object') {
    throw new CompletionValidationError(
      `Completion provider ${providerId} mode ${index} must be an object`,
    )
  }
  const id = requireText(
    mode.id,
    `Completion provider ${providerId} mode ${index} id`,
  )
  const label = requireText(
    mode.label,
    `Completion provider ${providerId} mode ${index} label`,
  )
  if (mode.description !== undefined && typeof mode.description !== 'string') {
    throw new CompletionValidationError(
      `Completion mode ${id} description must be a string when provided`,
    )
  }
  return Object.freeze({
    id,
    label,
    ...(mode.description === undefined ? {} : { description: mode.description }),
  })
}

function normalizeProvider(provider: CompletionProvider): CompletionProvider {
  if (provider === null || typeof provider !== 'object') {
    throw new CompletionValidationError('Completion provider must be an object')
  }
  const id = requireText(provider.id, 'Completion provider id')
  if (!Array.isArray(provider.triggers) || provider.triggers.length === 0) {
    throw new CompletionValidationError(
      `Completion provider ${id} must declare at least one trigger`,
    )
  }
  if (typeof provider.provide !== 'function') {
    throw new CompletionValidationError(
      `Completion provider ${id} provide must be a function`,
    )
  }
  const triggers = provider.triggers.map((trigger) => normalizeTriggerKind(trigger))
  if (new Set(triggers).size !== triggers.length) {
    throw new CompletionValidationError(
      `Completion provider ${id} declares a duplicate trigger`,
    )
  }

  let modes: readonly CompletionMode[] | undefined
  if (provider.modes !== undefined) {
    if (!Array.isArray(provider.modes) || provider.modes.length === 0) {
      throw new CompletionValidationError(
        `Completion provider ${id} must declare at least one mode`,
      )
    }
    const normalizedModes = provider.modes.map((mode, index) =>
      normalizeCompletionMode(mode, id, index),
    )
    if (new Set(normalizedModes.map((mode) => mode.id)).size !== normalizedModes.length) {
      throw new CompletionValidationError(
        `Completion provider ${id} declares duplicate completion modes`,
      )
    }
    modes = Object.freeze(normalizedModes)
  }

  let initialMode: CompletionInitialMode | undefined
  if (provider.initialMode !== undefined) {
    if (modes === undefined) {
      throw new CompletionValidationError(
        `Completion provider ${id} initialMode requires declared modes`,
      )
    }
    if (
      typeof provider.initialMode !== 'string' &&
      typeof provider.initialMode !== 'function'
    ) {
      throw new CompletionValidationError(
        `Completion provider ${id} initialMode must be a mode id or function`,
      )
    }
    initialMode =
      typeof provider.initialMode === 'string'
        ? requireText(provider.initialMode, `Completion provider ${id} initialMode`)
        : provider.initialMode
    if (
      typeof initialMode === 'string' &&
      !modes.some((mode) => mode.id === initialMode)
    ) {
      throw new CompletionValidationError(
        `Completion provider ${id} initial mode ${initialMode} is not declared`,
      )
    }
  }

  return Object.freeze({
    id,
    triggers: Object.freeze(triggers),
    ...(modes === undefined ? {} : { modes }),
    ...(initialMode === undefined ? {} : { initialMode }),
    provide: provider.provide,
  })
}

function resolveProviderMode(
  provider: CompletionProvider,
  trigger: CompletionTrigger,
): CompletionMode | undefined {
  if (!provider.modes) return undefined
  const requested =
    typeof provider.initialMode === 'function'
      ? provider.initialMode(trigger)
      : provider.initialMode
  const modeId = requested ?? provider.modes[0]?.id
  const mode = provider.modes.find((candidate) => candidate.id === modeId)
  if (!mode) {
    throw new CompletionValidationError(
      `Completion provider ${provider.id} initial mode ${String(modeId)} is not declared`,
    )
  }
  return mode
}

function sameCompletionModes(
  first: readonly CompletionMode[],
  second: readonly CompletionMode[],
): boolean {
  return (
    first.length === second.length &&
    first.every(
      (mode, index) =>
        mode.id === second[index]?.id &&
        mode.label === second[index]?.label &&
        mode.description === second[index]?.description,
    )
  )
}

export type UnregisterCompletionProvider = () => void

/**
 * DOM/CM6-independent provider registry and query engine. Provider failures
 * are returned as diagnostics for the adapter instead of preventing other
 * providers from contributing suggestions.
 */
export class CompletionProviderRegistry {
  private readonly providers = new Map<string, CompletionProvider>()

  register(provider: CompletionProvider): UnregisterCompletionProvider {
    const normalized = normalizeProvider(provider)
    if (this.providers.has(normalized.id)) {
      throw new CompletionProviderConflictError(normalized.id)
    }
    this.providers.set(normalized.id, normalized)
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      if (this.providers.get(normalized.id) === normalized) {
        this.providers.delete(normalized.id)
      }
    }
  }

  list(): readonly CompletionProvider[] {
    return Object.freeze([...this.providers.values()])
  }

  providersFor(trigger: CompletionTriggerKind): readonly CompletionProvider[] {
    const normalizedTrigger = normalizeTriggerKind(trigger)
    return Object.freeze(
      [...this.providers.values()].filter((provider) =>
        provider.triggers.includes(normalizedTrigger),
      ),
    )
  }

  async complete(context: CompletionContext): Promise<CompletionQueryResult> {
    const providers = this.providersFor(context.trigger.kind)
    const items: CompletionItem[] = []
    const errors: CompletionProviderError[] = []
    let sessionModes: readonly CompletionMode[] | undefined
    let initialModeId: CompletionModeId | undefined

    for (const provider of providers) {
      try {
        const providerMode = resolveProviderMode(provider, context.trigger)
        if (provider.modes) {
          if (sessionModes === undefined) {
            sessionModes = provider.modes
            initialModeId = providerMode?.id
          } else if (!sameCompletionModes(sessionModes, provider.modes)) {
            throw new CompletionValidationError(
              `Completion provider ${provider.id} declares modes incompatible with the completion session`,
            )
          }
        }

        const providerContext = providerMode
          ? { ...context, mode: providerMode }
          : context
        const provided = await provider.provide(providerContext)
        if (!Array.isArray(provided)) {
          throw new CompletionValidationError(
            `Completion provider ${provider.id} must return an array`,
          )
        }
        provided.forEach((item, index) => {
          items.push(normalizeCompletionItem(item, provider.id, index))
        })
      } catch (error) {
        errors.push(Object.freeze({ providerId: provider.id, error }))
      }
    }

    return Object.freeze({
      items: filterCompletionItems(items, context.trigger.query),
      errors: Object.freeze(errors),
      modes: sessionModes,
      ...(initialModeId === undefined ? {} : { initialModeId }),
    })
  }
}

export interface StaticCompletionProviderOptions {
  readonly id: string
  readonly triggers: readonly CompletionTriggerKind[]
  readonly items: readonly CompletionItem[]
  readonly modes?: readonly CompletionMode[]
  readonly initialMode?: CompletionInitialMode
}

export function createStaticCompletionProvider(
  options: StaticCompletionProviderOptions,
): CompletionProvider {
  return Object.freeze({
    id: options.id,
    triggers: Object.freeze([...options.triggers]),
    ...(options.modes === undefined ? {} : { modes: options.modes }),
    ...(options.initialMode === undefined
      ? {}
      : { initialMode: options.initialMode }),
    provide: () => options.items,
  })
}

function normalizeCompletionEdit(
  edit: CompletionEdit,
  source: string,
): CompletionEdit {
  if (edit === null || typeof edit !== 'object') {
    throw new CompletionValidationError('Completion apply result must be an edit')
  }
  if (
    !Number.isSafeInteger(edit.from) ||
    !Number.isSafeInteger(edit.to) ||
    edit.from < 0 ||
    edit.to < edit.from ||
    edit.to > source.length
  ) {
    throw new CompletionValidationError(
      'Completion edit range must be inside the source',
    )
  }
  if (typeof edit.insert !== 'string') {
    throw new CompletionValidationError('Completion edit insert must be a string')
  }
  if (
    edit.cursorOffset !== undefined &&
    (!Number.isSafeInteger(edit.cursorOffset) ||
      edit.cursorOffset < 0 ||
      edit.cursorOffset > edit.insert.length)
  ) {
    throw new CompletionValidationError(
      'Completion edit cursorOffset must be inside the inserted text',
    )
  }
  return Object.freeze({
    from: edit.from,
    to: edit.to,
    insert: edit.insert,
    ...(edit.cursorOffset === undefined
      ? {}
      : { cursorOffset: edit.cursorOffset }),
  })
}

/** Resolves a candidate into an absolute source edit without any editor API. */
export async function resolveCompletionEdit(
  item: CompletionItem,
  context: CompletionContext,
): Promise<CompletionEdit> {
  if (!item.apply && item.insertText === undefined) {
    throw new CompletionValidationError(
      `Completion item ${item.id} does not provide an insertion edit`,
    )
  }
  const result = item.apply
    ? await item.apply(context)
    : {
        from: context.trigger.from,
        to: context.trigger.to,
        insert: item.insertText as string,
      }

  return normalizeCompletionEdit(
    typeof result === 'string'
      ? {
          from: context.trigger.from,
          to: context.trigger.to,
          insert: result,
        }
      : result,
    context.source,
  )
}
