import {
  DEFAULT_REFERENCE_EXTENSIONS,
  stringifyReference,
} from '../../core/reference'
import type { ReferenceWorkspaceCatalog } from '../../core/reference'
import {
  createWorkspacePath,
  workspaceName,
  workspaceParent,
} from '../../core/workspace'
import type {
  WorkspaceEntry,
  WorkspacePath,
} from '../../core/workspace'
import {
  createSuggestionDocumentContext,
  extractHeadingEntities,
  resolveSuggestionObjects,
} from './suggestion'
import type {
  HeadingSuggestionEntity,
  SuggestionProviderLike,
  SuggestObject,
} from './suggestion'
import type {
  CompletionContext,
  CompletionInitialMode,
  CompletionItem,
  CompletionMode,
  CompletionModeId,
  CompletionProvider,
  CompletionTriggerKind,
} from './completion'

/**
 * Reference completion deliberately hides dot-prefixed directories and all of
 * their descendants. Dot-prefixed files in a visible directory remain
 * referenceable when they use a supported document extension, matching the
 * legacy workspace-tree policy.
 */
export const REFERENCE_COMPLETION_HIDDEN_DIRECTORY_POLICY =
  'exclude-dot-prefixed-directories-recursively' as const

export const REFERENCE_COMPLETION_PROVIDER_ID = 'workspace-references'

export const REFERENCE_COMPLETION_MODES: readonly CompletionMode[] = Object.freeze([
  Object.freeze({
    id: 'link',
    label: 'Link',
    description: 'Insert a normal reference link',
  }),
  Object.freeze({
    id: 'embed',
    label: 'Editable embed',
    description: 'Insert an editable reference embed',
  }),
  Object.freeze({
    id: 'embed-readonly',
    label: 'Readonly embed',
    description: 'Insert a readonly reference embed',
  }),
])

export type ReferenceCompletionEntryKind = 'file' | 'directory'

export interface ReferenceCompletionEntry {
  readonly kind: ReferenceCompletionEntryKind
  readonly path: WorkspacePath
  readonly name: string
}

/**
 * The provider only needs the workspace catalog capability. A
 * WorkspaceFileSystemPort is structurally compatible, but keeping this
 * boundary narrow also makes provider tests and future remote catalogs simple.
 */
export type ReferenceCompletionWorkspace = ReferenceWorkspaceCatalog

export type ReferenceCompletionMaybePromise<Value> = Value | PromiseLike<Value>

/** Narrow content capability used only when a file enters entity completion. */
export interface ReferenceCompletionContentReader {
  readFile(path: string): ReferenceCompletionMaybePromise<string>
}

/** P8 can provide a module, static objects, or path-aware dynamic objects. */
export type ReferenceCompletionSuggestionProvider = SuggestionProviderLike

export interface ReferenceCompletionCollectionOptions {
  readonly rootPath?: WorkspacePath | string
  /** Case-insensitive suffixes of referenceable document files. */
  readonly extensions?: readonly string[]
}

export interface ReferenceCompletionProviderOptions
  extends ReferenceCompletionCollectionOptions {
  /** Preferred name for the workspace catalog. */
  readonly workspace?: ReferenceCompletionWorkspace
  /** Alias for callers that model the capability as a catalog. */
  readonly catalog?: ReferenceCompletionWorkspace
  /** Alias for application composition with a filesystem adapter. */
  readonly fileSystem?: ReferenceCompletionWorkspace
  /** Optional reader; a workspace/fileSystem readFile method is auto-detected. */
  readonly contentReader?: ReferenceCompletionContentReader
  /** Alias used by application composition and tests. */
  readonly documentReader?: ReferenceCompletionContentReader
  /** Alias for a platform reader that is separate from directory listing. */
  readonly reader?: ReferenceCompletionContentReader
  /** Direct reader shorthand for small adapters and unit tests. */
  readonly readFile?: (
    path: string,
  ) => ReferenceCompletionMaybePromise<string>
  /** Static/dynamic template suggestion seam used for object entities. */
  readonly suggestionProvider?: ReferenceCompletionSuggestionProvider
  /** P8-oriented alias for the same provider seam. */
  readonly templateSuggestionProvider?: ReferenceCompletionSuggestionProvider
  /** Explicit entity-provider alias for callers that do not use templates. */
  readonly entityProvider?: ReferenceCompletionSuggestionProvider
  readonly id?: string
}

export class ReferenceCompletionValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceCompletionValidationError'
  }
}

export class ReferenceCompletionWorkspaceConsistencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceCompletionWorkspaceConsistencyError'
  }
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReferenceCompletionValidationError(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function normalizeExtensions(
  extensions: readonly string[] | undefined,
): readonly string[] {
  const values = extensions ?? DEFAULT_REFERENCE_EXTENSIONS
  if (!Array.isArray(values) || values.length === 0) {
    throw new ReferenceCompletionValidationError(
      'Reference completion extensions must be a non-empty array',
    )
  }

  const normalized: string[] = []
  const seen = new Set<string>()
  for (const extension of values) {
    if (
      typeof extension !== 'string' ||
      !/^\.[^./\\\r\n]+$/u.test(extension)
    ) {
      throw new ReferenceCompletionValidationError(
        'Reference completion extensions must be file suffixes such as .md',
      )
    }
    const lower = extension.toLocaleLowerCase('en-US')
    if (seen.has(lower)) continue
    seen.add(lower)
    normalized.push(lower)
  }
  return Object.freeze(normalized)
}

function normalizeRootPath(value: unknown): WorkspacePath {
  if (value === undefined) return '' as WorkspacePath
  if (typeof value !== 'string') {
    throw new ReferenceCompletionValidationError(
      'Reference completion rootPath must be a workspace path',
    )
  }
  try {
    return createWorkspacePath(value)
  } catch (error) {
    throw new ReferenceCompletionValidationError(
      `Reference completion rootPath is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

function normalizeWorkspace(
  options: ReferenceCompletionProviderOptions,
): ReferenceCompletionWorkspace {
  const record = requireRecord(options, 'Reference completion options')
  const candidates = [record.workspace, record.catalog, record.fileSystem].filter(
    (candidate): candidate is ReferenceCompletionWorkspace =>
      candidate !== undefined,
  )
  const workspace = candidates[0]
  if (
    workspace === null ||
    workspace === undefined ||
    typeof workspace !== 'object' ||
    typeof workspace.listDirectory !== 'function'
  ) {
    throw new ReferenceCompletionValidationError(
      'Reference completion workspace must expose listDirectory',
    )
  }
  for (const candidate of candidates.slice(1)) {
    if (candidate !== workspace) {
      throw new ReferenceCompletionValidationError(
        'Reference completion workspace aliases must refer to one catalog',
      )
    }
  }
  return workspace
}

function normalizeEntry(
  parentPath: WorkspacePath,
  entry: WorkspaceEntry,
): ReferenceCompletionEntry {
  if (entry === null || typeof entry !== 'object') {
    throw new ReferenceCompletionWorkspaceConsistencyError(
      `Workspace catalog returned an invalid entry under ${parentPath || '.'}`,
    )
  }
  if (entry.kind !== 'file' && entry.kind !== 'directory') {
    throw new ReferenceCompletionWorkspaceConsistencyError(
      `Workspace catalog returned an invalid entry kind under ${parentPath || '.'}`,
    )
  }

  let path: WorkspacePath
  try {
    path = createWorkspacePath(entry.path)
  } catch {
    throw new ReferenceCompletionWorkspaceConsistencyError(
      `Workspace catalog returned an invalid path under ${parentPath || '.'}`,
    )
  }
  if (typeof entry.name !== 'string' || entry.name.length === 0) {
    throw new ReferenceCompletionWorkspaceConsistencyError(
      `Workspace catalog entry ${path} has an invalid name`,
    )
  }
  if (
    path === '' ||
    workspaceParent(path) !== parentPath ||
    workspaceName(path) !== entry.name
  ) {
    throw new ReferenceCompletionWorkspaceConsistencyError(
      `Workspace catalog entry ${path || '.'} is not a valid direct child of ${parentPath || '.'}`,
    )
  }

  return Object.freeze({
    kind: entry.kind,
    path,
    name: entry.name,
  })
}

function compareEntries(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
  const leftName = left.name.toLocaleLowerCase('en-US')
  const rightName = right.name.toLocaleLowerCase('en-US')
  return (
    leftName.localeCompare(rightName, 'en-US') ||
    left.name.localeCompare(right.name, 'en-US')
  )
}

function isReferenceableFile(
  entry: ReferenceCompletionEntry,
  extensions: readonly string[],
): boolean {
  if (entry.kind !== 'file') return false
  const lowerName = entry.name.toLocaleLowerCase('en-US')
  return extensions.some((extension) => lowerName.endsWith(extension))
}

/**
 * Some filesystem names are legal workspace paths but cannot be represented
 * by the supported `[[path]]` grammar. They are omitted rather than producing
 * a completion that would fail only after selection.
 */
function isRepresentableReferencePath(path: WorkspacePath): boolean {
  return !/[\r\n\[\]|#]/u.test(path)
}

function isHiddenDirectory(entry: ReferenceCompletionEntry): boolean {
  return entry.kind === 'directory' && entry.name.startsWith('.')
}

function normalizeCollectionOptions(
  options: ReferenceCompletionCollectionOptions,
): { readonly rootPath: WorkspacePath; readonly extensions: readonly string[] } {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    throw new ReferenceCompletionValidationError(
      'Reference completion collection options must be an object',
    )
  }
  return Object.freeze({
    rootPath: normalizeRootPath(options.rootPath),
    extensions: normalizeExtensions(options.extensions),
  })
}

function normalizeContentReader(
  options: ReferenceCompletionProviderOptions,
  workspace: ReferenceCompletionWorkspace,
): ReferenceCompletionContentReader | undefined {
  const record = requireRecord(options, 'Reference completion options')
  const aliases = [
    record.contentReader,
    record.documentReader,
    record.reader,
  ].filter((candidate): candidate is ReferenceCompletionContentReader =>
    candidate !== undefined,
  )

  for (const candidate of aliases) {
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      typeof candidate.readFile !== 'function'
    ) {
      throw new ReferenceCompletionValidationError(
        'Reference completion content reader must expose readFile',
      )
    }
  }
  if (aliases.length > 1 && aliases.some((candidate) => candidate !== aliases[0])) {
    throw new ReferenceCompletionValidationError(
      'Reference completion reader aliases must refer to one reader',
    )
  }

  const directReader = record.readFile
  if (directReader !== undefined && typeof directReader !== 'function') {
    throw new ReferenceCompletionValidationError(
      'Reference completion readFile must be a function when provided',
    )
  }
  if (directReader !== undefined && aliases.length > 0) {
    throw new ReferenceCompletionValidationError(
      'Reference completion readFile cannot be combined with a reader alias',
    )
  }

  const reader = aliases[0]
  if (reader) {
    return Object.freeze({
      readFile: (path: string) => Promise.resolve(reader.readFile(path)),
    })
  }
  if (directReader) {
    return Object.freeze({
      readFile: (path: string) =>
        Promise.resolve(
          (directReader as (path: string) => ReferenceCompletionMaybePromise<string>)(path),
        ),
    })
  }

  // The normal WorkspaceFileSystemPort already has readFile. Keep the public
  // catalog contract narrow, but use the capability when the injected object
  // provides it so P4-03 callers gain entity completion automatically.
  const workspaceReader = (workspace as unknown as { readonly readFile?: unknown }).readFile
  if (typeof workspaceReader !== 'function') return undefined
  return Object.freeze({
    readFile: (path: string) =>
      Promise.resolve(
        (workspaceReader as (path: string) => ReferenceCompletionMaybePromise<string>).call(
          workspace,
          path,
        ),
      ),
  })
}

function normalizeSuggestionProvider(
  options: ReferenceCompletionProviderOptions,
): ReferenceCompletionSuggestionProvider | undefined {
  const record = requireRecord(options, 'Reference completion options')
  const aliases = [
    record.suggestionProvider,
    record.templateSuggestionProvider,
    record.entityProvider,
  ].filter(
    (candidate): candidate is ReferenceCompletionSuggestionProvider =>
      candidate !== undefined,
  )
  for (const candidate of aliases) {
    if (
      candidate === null ||
      (typeof candidate !== 'object' && typeof candidate !== 'function')
    ) {
      throw new ReferenceCompletionValidationError(
        'Reference completion suggestion provider must be an object or function',
      )
    }
  }
  if (aliases.length > 1 && aliases.some((candidate) => candidate !== aliases[0])) {
    throw new ReferenceCompletionValidationError(
      'Reference completion suggestion aliases must refer to one provider',
    )
  }
  return aliases[0]
}

/**
 * Enumerates reference candidates from a workspace without reading document
 * contents. The returned list contains visible directories (for path
 * continuation) and referenceable Markdown/text files. Traversal is a fresh
 * catalog read for each call, so a tree refresh or rename cannot leave a
 * long-lived completion cache behind.
 */
export async function collectReferenceCompletionEntries(
  workspace: ReferenceCompletionWorkspace,
  options: ReferenceCompletionCollectionOptions = {},
): Promise<readonly ReferenceCompletionEntry[]> {
  if (
    workspace === null ||
    typeof workspace !== 'object' ||
    typeof workspace.listDirectory !== 'function'
  ) {
    throw new ReferenceCompletionValidationError(
      'Reference completion workspace must expose listDirectory',
    )
  }
  const normalized = normalizeCollectionOptions(options)
  if (
    normalized.rootPath !== '' &&
    workspaceName(normalized.rootPath).startsWith('.')
  ) {
    // A configured hidden root is itself subject to the same policy as any
    // hidden child directory. Do not ask the adapter to traverse it.
    return Object.freeze([])
  }

  const entries: ReferenceCompletionEntry[] = []
  const seenEntries = new Set<WorkspacePath>()
  const visitedDirectories = new Set<WorkspacePath>()

  const visit = async (directory: WorkspacePath): Promise<void> => {
    if (visitedDirectories.has(directory)) {
      throw new ReferenceCompletionWorkspaceConsistencyError(
        `Workspace catalog revisited directory ${directory || '.'}`,
      )
    }
    visitedDirectories.add(directory)

    const listed = await workspace.listDirectory(directory)
    if (!Array.isArray(listed)) {
      throw new ReferenceCompletionWorkspaceConsistencyError(
        `Workspace catalog did not return an entry array for ${directory || '.'}`,
      )
    }

    const normalizedEntries = listed
      .map((entry) => normalizeEntry(directory, entry))
      .sort(compareEntries)

    for (const entry of normalizedEntries) {
      if (seenEntries.has(entry.path)) {
        throw new ReferenceCompletionWorkspaceConsistencyError(
          `Workspace catalog returned duplicate entry ${entry.path}`,
        )
      }
      seenEntries.add(entry.path)

      if (isHiddenDirectory(entry)) continue
      if (!isRepresentableReferencePath(entry.path)) continue

      if (entry.kind === 'directory') {
        entries.push(entry)
        await visit(entry.path)
      } else if (isReferenceableFile(entry, normalized.extensions)) {
        entries.push(entry)
      }
    }
  }

  await visit(normalized.rootPath)
  return Object.freeze(entries)
}

function modeIdForContext(context: CompletionContext): CompletionModeId {
  const requested = context.mode?.id
  if (
    requested === 'link' ||
    requested === 'embed' ||
    requested === 'embed-readonly'
  ) {
    return requested
  }
  if (requested !== undefined) {
    throw new ReferenceCompletionValidationError(
      `Unknown reference completion mode: ${requested}`,
    )
  }
  return context.trigger.kind === '![[' ? 'embed' : 'link'
}

function insertionForEntry(
  entry: ReferenceCompletionEntry,
  context: CompletionContext,
): string {
  const mode = modeIdForContext(context)
  if (entry.kind === 'directory') {
    const opener = mode === 'link' ? '[[' : '![['
    return `${opener}${entry.path}/`
  }

  return stringifyReference({
    kind: mode === 'link' ? 'link' : 'embed',
    path: entry.path,
    readonly: mode === 'embed-readonly',
  })
}

export type ReferenceCompletionEntityKind = 'file' | 'object' | 'heading'

export interface ReferenceCompletionEntityOptions {
  readonly contentReader?: ReferenceCompletionContentReader
  readonly suggestionProvider?: ReferenceCompletionSuggestionProvider
}

function fileSelfLabel(path: WorkspacePath): string {
  return workspaceName(path).replace(/\.(?:md|markdown|txt)$/iu, '')
}

function isRepresentableEntityFragment(value: string): boolean {
  return value.length > 0 && !/[\r\n\[\]|]/u.test(value)
}

function insertionForEntity(
  path: WorkspacePath,
  fragment: string | null,
  context: CompletionContext,
): string {
  const mode = modeIdForContext(context)
  return stringifyReference({
    kind: mode === 'link' ? 'link' : 'embed',
    path,
    fragment,
    readonly: mode === 'embed-readonly',
  })
}

function itemForEntity(
  path: WorkspacePath,
  kind: ReferenceCompletionEntityKind,
  label: string,
  fragment: string | null,
  detail: string,
  keywords: readonly string[],
): CompletionItem {
  return Object.freeze({
    id: `reference:${kind}:${kind === 'file' ? path : `${path}#${fragment ?? label}`}`,
    label,
    detail,
    keywords: Object.freeze([...keywords]),
    kind,
    apply: (context: CompletionContext) => ({
      from: context.trigger.from,
      to: context.trigger.to,
      insert: insertionForEntity(path, fragment, context),
    }),
  })
}

function fileSelfItem(path: WorkspacePath): CompletionItem {
  return itemForEntity(
    path,
    'file',
    fileSelfLabel(path),
    null,
    path,
    [path, workspaceName(path), 'file document'],
  )
}

function objectEntityItem(
  path: WorkspacePath,
  object: SuggestObject,
): CompletionItem {
  const fragment = object.fragment ?? object.id
  return itemForEntity(
    path,
    'object',
    object.label,
    fragment,
    `${path}#${fragment}`,
    [path, object.id, object.label, 'object'],
  )
}

function headingEntityItem(
  path: WorkspacePath,
  heading: HeadingSuggestionEntity,
): CompletionItem {
  return itemForEntity(
    path,
    'heading',
    heading.label,
    heading.fragment,
    `${path}#${heading.fragment}`,
    [path, heading.label, `heading h${heading.level}`],
  )
}

function hasOnlyStaticSuggestions(
  provider: ReferenceCompletionSuggestionProvider | undefined,
): boolean {
  if (provider === undefined || typeof provider === 'function') return false
  const object = provider as {
    readonly objects?: unknown
    readonly objectsFor?: unknown
    readonly provide?: unknown
    readonly resolve?: unknown
    readonly getSuggestions?: unknown
    readonly getObjects?: unknown
  }
  return (
    Array.isArray(object.objects) &&
    object.objectsFor === undefined &&
    object.provide === undefined &&
    object.resolve === undefined &&
    object.getSuggestions === undefined &&
    object.getObjects === undefined
  )
}

/**
 * Loads the second-level candidates for one file. Read failures and broken
 * suggestion modules deliberately return `undefined`, allowing the caller to
 * apply the file itself without changing the source or losing the reference.
 */
export async function loadReferenceCompletionEntities(
  path: WorkspacePath | string,
  options: ReferenceCompletionEntityOptions = {},
): Promise<readonly CompletionItem[] | undefined> {
  let normalizedPath: WorkspacePath
  try {
    normalizedPath = createWorkspacePath(path)
  } catch (error) {
    throw new ReferenceCompletionValidationError(
      `Reference completion entity path is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  if (normalizedPath === '') {
    throw new ReferenceCompletionValidationError(
      'Reference completion entity path must identify a file',
    )
  }
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ReferenceCompletionValidationError(
      'Reference completion entity options must be an object',
    )
  }
  if (
    options.contentReader !== undefined &&
    (options.contentReader === null ||
      typeof options.contentReader !== 'object' ||
      typeof options.contentReader.readFile !== 'function')
  ) {
    throw new ReferenceCompletionValidationError(
      'Reference completion entity content reader must expose readFile',
    )
  }
  if (
    options.suggestionProvider !== undefined &&
    options.suggestionProvider !== null &&
    typeof options.suggestionProvider !== 'object' &&
    typeof options.suggestionProvider !== 'function'
  ) {
    throw new ReferenceCompletionValidationError(
      'Reference completion entity suggestion provider must be an object or function',
    )
  }

  let source: string
  if (options.contentReader) {
    try {
      source = await options.contentReader.readFile(normalizedPath)
      if (typeof source !== 'string') return undefined
    } catch {
      return undefined
    }
  } else if (options.suggestionProvider && hasOnlyStaticSuggestions(options.suggestionProvider)) {
    // Static template objects do not need document bytes. Dynamic factories do;
    // without a reader they are intentionally not invoked with a fake source.
    source = ''
  } else {
    return undefined
  }

  let objects: readonly SuggestObject[] = Object.freeze([])
  if (options.suggestionProvider) {
    try {
      const document = createSuggestionDocumentContext(normalizedPath, source)
      objects = await resolveSuggestionObjects(options.suggestionProvider, document)
    } catch {
      // A template/suggest failure is a derived-data failure. Fall through to
      // heading fallback rather than hiding the file or mutating its Markdown.
      objects = Object.freeze([])
    }
  }

  const file = fileSelfItem(normalizedPath)
  const usableObjects = objects.filter((object) =>
    isRepresentableEntityFragment(object.fragment ?? object.id),
  )
  if (usableObjects.length > 0) {
    return Object.freeze([
      file,
      ...usableObjects.map((object) => objectEntityItem(normalizedPath, object)),
    ])
  }

  if (!options.contentReader) return undefined
  const headings = extractHeadingEntities(source).filter((heading) =>
    isRepresentableEntityFragment(heading.fragment),
  )
  if (headings.length === 0) return undefined
  return Object.freeze([
    file,
    ...headings.map((heading) => headingEntityItem(normalizedPath, heading)),
  ])
}

/** Compatibility alias for callers that name the operation “collect”. */
export const collectReferenceCompletionEntities = loadReferenceCompletionEntities

interface EntityItemOptions {
  readonly contentReader?: ReferenceCompletionContentReader
  readonly suggestionProvider?: ReferenceCompletionSuggestionProvider
}

function itemForEntry(
  entry: ReferenceCompletionEntry,
  entityOptions: EntityItemOptions,
): CompletionItem {
  const item = {
    id: `reference:${entry.kind}:${entry.path}`,
    label: entry.kind === 'directory' ? `${entry.name}/` : entry.name,
    detail: entry.kind === 'directory' ? `${entry.path}/` : entry.path,
    keywords: Object.freeze([
      entry.path,
      entry.name,
      entry.kind === 'directory' ? 'directory folder' : 'file document',
    ]),
    kind: entry.kind,
    apply: (context: CompletionContext) => ({
      from: context.trigger.from,
      to: context.trigger.to,
      insert: insertionForEntry(entry, context),
    }),
    ...(entry.kind === 'file'
      ? {
          // Entity availability is mode-independent; each leaf applies the
          // current provider mode through its normal CompletionContext.
          children: async (_context: CompletionContext) =>
            loadReferenceCompletionEntities(entry.path, entityOptions),
        }
      : {}),
  } satisfies CompletionItem
  return Object.freeze(item)
}

/** Workspace-backed provider for all three reference trigger forms. */
export class ReferenceCompletionProvider implements CompletionProvider {
  readonly id: string

  readonly triggers: readonly CompletionTriggerKind[] = Object.freeze([
    '@',
    '[[',
    '![[',
  ])

  readonly modes: readonly CompletionMode[] = REFERENCE_COMPLETION_MODES

  readonly initialMode: CompletionInitialMode = (trigger) =>
    trigger.kind === '![[' ? 'embed' : 'link'

  private readonly workspace: ReferenceCompletionWorkspace

  private readonly collectionOptions: ReferenceCompletionCollectionOptions

  private readonly entityOptions: ReferenceCompletionEntityOptions

  constructor(options: ReferenceCompletionProviderOptions) {
    requireRecord(options, 'Reference completion options')
    this.workspace = normalizeWorkspace(options)
    this.entityOptions = Object.freeze({
      contentReader: normalizeContentReader(options, this.workspace),
      suggestionProvider: normalizeSuggestionProvider(options),
    })
    this.id =
      options.id === undefined
        ? REFERENCE_COMPLETION_PROVIDER_ID
        : typeof options.id === 'string' && options.id.trim().length > 0
          ? options.id.trim()
          : (() => {
              throw new ReferenceCompletionValidationError(
                'Reference completion provider id must be non-empty',
              )
            })()
    this.collectionOptions = Object.freeze({
      rootPath: normalizeRootPath(options.rootPath),
      extensions: normalizeExtensions(options.extensions),
    })
  }

  readonly provide = async (
    _context: CompletionContext,
  ): Promise<readonly CompletionItem[]> => {
    const entries = await collectReferenceCompletionEntries(
      this.workspace,
      this.collectionOptions,
    )
    return Object.freeze(
      entries.map((entry) => itemForEntry(entry, this.entityOptions)),
    )
  }
}

export function createReferenceCompletionProvider(
  options: ReferenceCompletionProviderOptions,
): CompletionProvider {
  return new ReferenceCompletionProvider(options)
}