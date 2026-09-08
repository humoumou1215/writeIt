/**
 * Source-backed suggestion contracts used by reference entity completion.
 *
 * This is deliberately an application-level, editor-independent seam. A
 * future template catalog can provide static `objects` and/or a dynamic
 * `objectsFor(ctx)` factory without making CM6 or a template runtime part of
 * the reference completion adapter.
 */
import { createWorkspacePath } from '../../core/workspace'
import type { WorkspacePath } from '../../core/workspace'

export interface SuggestContext {
  /** First paragraph matching `re`, or null when there is no match. */
  findText(re: RegExp): string[] | null
  /** Heading text at an exact level matching `re`, or null. */
  headingText(level: number, re: RegExp): string | null
  /** First paragraph after a matching heading, or null. */
  paragraphAfterHeading(level: number, re: RegExp): string | null
  /** Number of matching task items, or null when there are none. */
  taskCount(re?: RegExp): string | null
  /** Completion progress for matching task items, or null when there are none. */
  taskProgress(re?: RegExp): string | null
  /** First matching task item, or null when there is no match. */
  firstTask(re?: RegExp): string | null
  /** First table cell at the requested row/column, or null. */
  firstTableCell(rowIdx: number, colIdx: number, re?: RegExp): string | null
  /** Rows of the first table after a matching heading, including its header. */
  tableAfterHeading(heading: string | RegExp): string[][] | null
  /** Paragraph text joined with newlines. */
  allText(): string
}

/** A source entity that can be addressed as `[[path#id]]`. */
export interface SuggestObject {
  readonly id: string
  readonly label: string
  /** Optional heading anchor used for navigation and reference insertion. */
  readonly fragment?: string | null
  /** Optional resolver used later by template-aware projections. */
  readonly resolve?: (context: SuggestContext) => string | null
}

/** The familiar static/dynamic shape of a template suggestion module. */
export interface SuggestModule {
  readonly objects?: readonly SuggestObject[]
  readonly objectsFor?: (
    context: SuggestContext,
  ) => readonly SuggestObject[] | Promise<readonly SuggestObject[]>
}

export interface SuggestionDocumentContext {
  readonly path: WorkspacePath
  readonly source: string
  readonly context: SuggestContext
}

export type SuggestionProviderResult =
  | readonly SuggestObject[]
  | SuggestModule
  | null
  | undefined

export type SuggestionProviderFunction = (
  document: SuggestionDocumentContext,
) => SuggestionProviderResult | Promise<SuggestionProviderResult>

/**
 * Provider contract accepted by P4 and intentionally broad enough for the P8
 * template catalog. A plain SuggestModule is valid for static objects; a
 * provider method can select a module from the target document path/doctype.
 */
export interface SuggestionProvider extends SuggestModule {
  readonly provide?: SuggestionProviderFunction
  /** Template-service naming alias for a path-aware suggestion lookup. */
  readonly resolve?: SuggestionProviderFunction
  readonly getSuggestions?: SuggestionProviderFunction
  readonly getObjects?: SuggestionProviderFunction
}

export type SuggestionProviderLike =
  | SuggestionProvider
  | SuggestionProviderFunction

/** P8-facing name for the same static/dynamic suggestion seam. */
export type TemplateSuggestionProvider = SuggestionProviderLike

export class SuggestionValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'SuggestionValidationError'
  }
}

export interface HeadingSuggestionEntity {
  readonly kind: 'heading'
  readonly id: string
  readonly label: string
  readonly fragment: string
  readonly level: number
}

interface HeadingFact {
  readonly level: number
  readonly text: string
  readonly from: number
  readonly end: number
}

interface TaskFact {
  readonly text: string
  readonly done: boolean
}

interface TableFact {
  readonly from: number
  readonly rows: readonly (readonly string[])[]
}

interface SourceFacts {
  readonly paragraphs: readonly string[]
  readonly headings: readonly HeadingFact[]
  readonly afterHeading: readonly {
    readonly level: number
    readonly heading: string
    readonly next: string
  }[]
  readonly tasks: readonly TaskFact[]
  readonly tables: readonly TableFact[]
}

interface SourceLine {
  readonly text: string
  readonly from: number
}

function requireSource(source: string): string {
  if (typeof source !== 'string') {
    throw new TypeError('Suggestion source must be a string')
  }
  return source
}

function sourceLines(source: string): readonly SourceLine[] {
  const lines: SourceLine[] = []
  let from = 0

  while (from <= source.length) {
    const lineFeed = source.indexOf('\n', from)
    const carriageReturn = source.indexOf('\r', from)
    let end = source.length
    let separatorLength = 0

    if (lineFeed >= 0 && carriageReturn >= 0) {
      end = Math.min(lineFeed, carriageReturn)
    } else if (lineFeed >= 0) {
      end = lineFeed
    } else if (carriageReturn >= 0) {
      end = carriageReturn
    }

    if (end < source.length) {
      separatorLength = source[end] === '\r' && source[end + 1] === '\n' ? 2 : 1
    }

    lines.push(Object.freeze({ text: source.slice(from, end), from }))
    if (end >= source.length) break
    from = end + separatorLength
  }

  return Object.freeze(lines)
}

function plainText(value: string): string {
  // Keep this intentionally conservative. Suggest providers should see the
  // visible reference target rather than its brackets, while unknown syntax
  // must not be rewritten or interpreted as a different document.
  return value
    .replace(/!\[\[([^\]]+)\]\]/gu, '$1')
    .replace(/\[\[([^\]]+)\]\]/gu, '$1')
    .trim()
}

function matches(re: RegExp, value: string): boolean {
  re.lastIndex = 0
  const result = re.test(value)
  re.lastIndex = 0
  return result
}

function headingAt(line: string): { readonly level: number; readonly text: string } | undefined {
  const match = /^( {0,3})(#{1,6})(?:[ \t]+|$)(.*?)\s*$/u.exec(line)
  if (!match) return undefined

  const text = match[3]
    .replace(/[ \t]+#+[ \t]*$/u, '')
    .trim()
  if (text.length === 0) return undefined
  return Object.freeze({ level: match[2].length, text: plainText(text) })
}

function taskAt(line: string): TaskFact | undefined {
  const match = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/u.exec(line)
  if (!match) return undefined
  return Object.freeze({
    text: plainText(match[2]),
    done: match[1].toLocaleLowerCase('en-US') === 'x',
  })
}

function isListItem(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+/u.test(line)
}

function splitTableCells(line: string): readonly string[] | undefined {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return undefined

  let body = trimmed
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1)

  const cells: string[] = []
  let cell = ''
  let escaped = false
  for (const character of body) {
    if (escaped) {
      cell += character
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (character === '|') {
      cells.push(plainText(cell))
      cell = ''
    } else {
      cell += character
    }
  }
  if (escaped) cell += '\\'
  cells.push(plainText(cell))

  return cells.length >= 2 ? Object.freeze(cells) : undefined
}

function isTableSeparator(cells: readonly string[]): boolean {
  return (
    cells.length >= 2 &&
    cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()))
  )
}

function isFenceMarker(line: string): {
  readonly character: '`' | '~'
  readonly length: number
  readonly rest: string
} | undefined {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/u.exec(line)
  if (!match) return undefined
  return Object.freeze({
    character: match[2][0] as '`' | '~',
    length: match[2].length,
    rest: match[3],
  })
}

function scanSource(source: string): SourceFacts {
  const paragraphs: string[] = []
  const headings: HeadingFact[] = []
  const afterHeading: Array<{
    readonly level: number
    readonly heading: string
    readonly next: string
  }> = []
  const tasks: TaskFact[] = []
  const tables: TableFact[] = []

  let fence: { readonly character: '`' | '~'; readonly length: number } | undefined
  let paragraphLines: string[] = []
  let tableLines: SourceLine[] = []
  let pendingHeading: { readonly level: number; readonly heading: string } | undefined

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) return
    const text = plainText(paragraphLines.join(' '))
    paragraphLines = []
    if (text.length === 0) return
    paragraphs.push(text)
    if (pendingHeading) {
      afterHeading.push({ ...pendingHeading, next: text })
      pendingHeading = undefined
    }
  }

  const flushTable = (): void => {
    if (tableLines.length === 0) return
    const parsedRows = tableLines
      .map((line) => splitTableCells(line.text))
      .filter((row): row is readonly string[] => row !== undefined)
      .filter((row) => !isTableSeparator(row))
    if (parsedRows.length > 0) {
      tables.push({
        from: tableLines[0]?.from ?? 0,
        rows: Object.freeze(parsedRows),
      })
    }
    tableLines = []
  }

  for (const line of sourceLines(source)) {
    const marker = isFenceMarker(line.text)
    if (fence) {
      flushParagraph()
      flushTable()
      if (
        marker &&
        marker.character === fence.character &&
        marker.length >= fence.length &&
        /^\s*$/u.test(marker.rest)
      ) {
        fence = undefined
      }
      continue
    }
    if (marker) {
      flushParagraph()
      flushTable()
      fence = { character: marker.character, length: marker.length }
      pendingHeading = undefined
      continue
    }

    const heading = headingAt(line.text)
    if (heading) {
      flushParagraph()
      flushTable()
      headings.push({
        ...heading,
        from: line.from,
        end: line.from + line.text.length,
      })
      pendingHeading = {
        level: heading.level,
        heading: heading.text,
      }
      continue
    }

    const task = taskAt(line.text)
    if (task) {
      flushParagraph()
      flushTable()
      tasks.push(task)
      pendingHeading = undefined
      continue
    }

    const table = splitTableCells(line.text)
    if (table) {
      flushParagraph()
      tableLines.push(line)
      continue
    }

    flushTable()
    if (line.text.trim().length === 0) {
      flushParagraph()
      continue
    }

    if (isListItem(line.text)) {
      flushParagraph()
      pendingHeading = undefined
      continue
    }

    paragraphLines.push(line.text)
  }

  flushParagraph()
  flushTable()

  return Object.freeze({
    paragraphs: Object.freeze(paragraphs),
    headings: Object.freeze(headings),
    afterHeading: Object.freeze(afterHeading),
    tasks: Object.freeze(tasks),
    tables: Object.freeze(tables),
  })
}

function normalizeHeadingQuery(value: string): string {
  return value.replace(/^\s*#{1,6}\s*/u, '').trim()
}

/** Builds the editor-independent context passed to dynamic object factories. */
export function createSuggestContext(source: string): SuggestContext {
  const facts = scanSource(requireSource(source))

  return Object.freeze({
    findText(re: RegExp): string[] | null {
      const hit = facts.paragraphs.find((paragraph) => matches(re, paragraph))
      return hit === undefined ? null : [hit]
    },
    headingText(level: number, re: RegExp): string | null {
      const hit = facts.headings.find(
        (heading) => heading.level === level && matches(re, heading.text),
      )
      return hit?.text ?? null
    },
    paragraphAfterHeading(level: number, re: RegExp): string | null {
      const hit = facts.afterHeading.find(
        (heading) =>
          heading.level === level && matches(re, heading.heading),
      )
      return hit?.next ?? null
    },
    taskCount(re?: RegExp): string | null {
      const filtered = re
        ? facts.tasks.filter((task) => matches(re, task.text))
        : facts.tasks
      return filtered.length === 0 ? null : String(filtered.length)
    },
    taskProgress(re?: RegExp): string | null {
      const filtered = re
        ? facts.tasks.filter((task) => matches(re, task.text))
        : facts.tasks
      if (filtered.length === 0) return null
      const done = filtered.filter((task) => task.done).length
      return `${done}/${filtered.length}`
    },
    firstTask(re?: RegExp): string | null {
      const hit = re
        ? facts.tasks.find((task) => matches(re, task.text))
        : facts.tasks[0]
      return hit?.text ?? null
    },
    firstTableCell(rowIdx: number, colIdx: number, re?: RegExp): string | null {
      if (!Number.isSafeInteger(rowIdx) || !Number.isSafeInteger(colIdx)) {
        return null
      }
      const cell = facts.tables[0]?.rows[rowIdx]?.[colIdx]
      if (cell === undefined) return null
      return re && !matches(re, cell) ? null : cell
    },
    tableAfterHeading(heading: string | RegExp): string[][] | null {
      const target = facts.headings.find((candidate) => {
        if (typeof heading === 'string') {
          return candidate.text === normalizeHeadingQuery(heading)
        }
        return matches(heading, candidate.text)
      })
      if (!target) return null
      const table = facts.tables.find((candidate) => candidate.from > target.end)
      return table
        ? table.rows.map((row) => [...row])
        : null
    },
    allText(): string {
      return facts.paragraphs.join('\n')
    },
  })
}

/** Returns Markdown headings that can be used as fallback reference entities. */
export function extractHeadingEntities(source: string): readonly HeadingSuggestionEntity[] {
  const facts = scanSource(requireSource(source))
  return Object.freeze(
    facts.headings.map((heading) =>
      Object.freeze({
        kind: 'heading' as const,
        id: heading.text,
        label: heading.text,
        fragment: heading.text,
        level: heading.level,
      }),
    ),
  )
}

function requireProviderObject(value: unknown): SuggestionProvider {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SuggestionValidationError('Suggestion provider must be an object or function')
  }
  return value as SuggestionProvider
}

function normalizeObject(
  value: unknown,
  index: number,
): SuggestObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SuggestionValidationError(`Suggestion object ${index} must be an object`)
  }
  const object = value as {
    readonly id?: unknown
    readonly label?: unknown
    readonly fragment?: unknown
    readonly resolve?: unknown
  }
  if (typeof object.id !== 'string' || object.id.trim().length === 0) {
    throw new SuggestionValidationError(`Suggestion object ${index} id must be non-empty`)
  }
  if (typeof object.label !== 'string' || object.label.trim().length === 0) {
    throw new SuggestionValidationError(`Suggestion object ${index} label must be non-empty`)
  }
  if (
    object.fragment !== undefined &&
    object.fragment !== null &&
    (typeof object.fragment !== 'string' || object.fragment.trim().length === 0)
  ) {
    throw new SuggestionValidationError(
      `Suggestion object ${object.id} fragment must be a non-empty string when provided`,
    )
  }
  if (object.resolve !== undefined && typeof object.resolve !== 'function') {
    throw new SuggestionValidationError(
      `Suggestion object ${object.id} resolve must be a function when provided`,
    )
  }

  return Object.freeze({
    id: object.id.trim(),
    label: object.label.trim(),
    ...(object.fragment === undefined || object.fragment === null
      ? {}
      : { fragment: object.fragment.trim() }),
    ...(object.resolve === undefined ? {} : { resolve: object.resolve as SuggestObject['resolve'] }),
  })
}

function normalizeObjects(value: unknown): readonly SuggestObject[] {
  if (!Array.isArray(value)) {
    throw new SuggestionValidationError('Suggestion objects must be an array')
  }
  const result: SuggestObject[] = []
  const seen = new Set<string>()
  value.forEach((object, index) => {
    const normalized = normalizeObject(object, index)
    // Static objects win over dynamic objects with the same id. The caller
    // combines sources in that order; this also makes one source deterministic.
    if (seen.has(normalized.id)) return
    seen.add(normalized.id)
    result.push(normalized)
  })
  return Object.freeze(result)
}

function moduleShape(value: unknown): value is SuggestModule {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function resolveResult(
  value: SuggestionProviderResult,
  document: SuggestionDocumentContext,
): Promise<readonly SuggestObject[]> {
  if (value === null || value === undefined) return Object.freeze([])
  if (Array.isArray(value)) return normalizeObjects(value)
  if (!moduleShape(value)) {
    throw new SuggestionValidationError('Suggestion provider result is invalid')
  }

  const staticObjects = value.objects === undefined
    ? Object.freeze([])
    : normalizeObjects(value.objects)
  let dynamicObjects: readonly SuggestObject[] = Object.freeze([])
  if (value.objectsFor !== undefined) {
    try {
      dynamicObjects = normalizeObjects(await value.objectsFor(document.context))
    } catch {
      // A dynamic template query is derived data. Keep valid static objects
      // available when only the context-dependent factory fails.
      dynamicObjects = Object.freeze([])
    }
  }

  const result: SuggestObject[] = []
  const seen = new Set<string>()
  for (const object of [...staticObjects, ...dynamicObjects]) {
    if (seen.has(object.id)) continue
    seen.add(object.id)
    result.push(object)
  }
  return Object.freeze(result)
}

/**
 * Resolves static and dynamic suggestion objects for one source document.
 * Static objects are kept before dynamic objects, so an id collision is
 * deterministic and follows the legacy template contract.
 */
export async function resolveSuggestionObjects(
  provider: SuggestionProviderLike | undefined,
  document: SuggestionDocumentContext,
): Promise<readonly SuggestObject[]> {
  if (provider === undefined) return Object.freeze([])
  if (typeof provider === 'function') {
    return resolveResult(await provider(document), document)
  }

  const object = requireProviderObject(provider)
  const result: SuggestObject[] = []
  const seen = new Set<string>()
  const add = (objects: readonly SuggestObject[]): void => {
    for (const suggestion of objects) {
      if (seen.has(suggestion.id)) continue
      seen.add(suggestion.id)
      result.push(suggestion)
    }
  }

  if (object.objects !== undefined) add(normalizeObjects(object.objects))
  if (object.objectsFor !== undefined) {
    try {
      add(normalizeObjects(await object.objectsFor(document.context)))
    } catch {
      // Preserve static suggestions if a dynamic factory is unavailable.
    }
  }

  const method =
    object.provide ??
    object.resolve ??
    object.getSuggestions ??
    object.getObjects
  if (method !== undefined) {
    if (typeof method !== 'function') {
      throw new SuggestionValidationError('Suggestion provider method must be a function')
    }
    try {
      add(await resolveResult(await method(document), document))
    } catch {
      // Keep already validated static/factory results if the path-aware
      // catalog lookup fails.
    }
  }

  return Object.freeze(result)
}

/** Compatibility alias for template-oriented callers. */
export const resolveTemplateSuggestions = resolveSuggestionObjects

/** Ensures an externally supplied target path is canonical before invocation. */
export function createSuggestionDocumentContext(
  path: WorkspacePath | string,
  source: string,
): SuggestionDocumentContext {
  const normalizedPath = createWorkspacePath(path)
  if (normalizedPath === '') {
    throw new SuggestionValidationError('Suggestion document path must identify a file')
  }
  const normalizedSource = requireSource(source)
  return Object.freeze({
    path: normalizedPath,
    source: normalizedSource,
    context: createSuggestContext(normalizedSource),
  })
}
