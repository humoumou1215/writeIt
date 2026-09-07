export type CompletionTriggerKind = '@' | '[[' | '![['

export interface CompletionTrigger {
  readonly kind: CompletionTriggerKind
  /** Absolute source offset of the trigger opener. */
  readonly from: number
  /** Absolute source offset of the cursor at which the query ends. */
  readonly to: number
  readonly query: string
}

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

export interface CompletionItem {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly keywords?: readonly string[]
  /** Used when the default trigger range is sufficient. */
  readonly insertText?: string
  /** Allows a provider to calculate a source-backed edit without knowing CM6. */
  readonly apply?: (
    context: CompletionContext,
  ) => CompletionApplyResult | Promise<CompletionApplyResult>
}

export interface CompletionProvider {
  readonly id: string
  readonly triggers: readonly CompletionTriggerKind[]
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
  if (item.insertText === undefined && item.apply === undefined) {
    throw new CompletionValidationError(
      `Completion item ${id} must provide insertText or apply`,
    )
  }

  return Object.freeze({
    id,
    label,
    ...(item.detail === undefined ? {} : { detail: item.detail }),
    keywords: Object.freeze(keywords),
    ...(item.insertText === undefined ? {} : { insertText: item.insertText }),
    ...(item.apply === undefined ? {} : { apply: item.apply }),
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

  return Object.freeze({
    id,
    triggers: Object.freeze(triggers),
    provide: provider.provide,
  })
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

    for (const provider of providers) {
      try {
        const provided = await provider.provide(context)
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
    })
  }
}

export interface StaticCompletionProviderOptions {
  readonly id: string
  readonly triggers: readonly CompletionTriggerKind[]
  readonly items: readonly CompletionItem[]
}

export function createStaticCompletionProvider(
  options: StaticCompletionProviderOptions,
): CompletionProvider {
  return Object.freeze({
    id: options.id,
    triggers: Object.freeze([...options.triggers]),
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
