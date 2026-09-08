import {
  createWorkspacePath,
  isWorkspacePathWithin,
  workspaceName,
  workspaceParent,
} from '../workspace'
import type {
  WorkspaceEntry,
  WorkspacePath,
} from '../workspace'
import { parseReferences } from './syntax'
import type { ParsedReference } from './syntax'

/**
 * The narrow workspace capability needed to resolve a reference. The port is
 * declared here so Core does not depend on a concrete filesystem adapter;
 * `WorkspaceFileSystemPort` is structurally compatible with it.
 */
export interface ReferenceWorkspaceCatalog {
  listDirectory(path: WorkspacePath): Promise<readonly WorkspaceEntry[]>
}

export const DEFAULT_REFERENCE_EXTENSIONS: readonly string[] = Object.freeze([
  '.md',
  '.markdown',
  '.txt',
])

export type ReferenceResolutionStatus =
  | 'resolved'
  | 'missing'
  | 'ambiguous'
  | 'invalid'

export type ReferenceResolutionStrategy =
  | 'exact'
  | 'extension'
  | 'relative-exact'
  | 'relative-extension'
  | 'basename'
  | 'missing'
  | 'ambiguous'
  | 'invalid'

export interface ReferenceResolutionOptions {
  /** Extensions tried after the exact path, in priority order. */
  readonly extensions?: readonly string[]
  /** Whether a path without a directory may search workspace basenames. */
  readonly basenameSearch?: boolean
  /** Host document for explicit `./` and `../` reference paths. */
  readonly hostPath?: WorkspacePath | string | null
}

export interface ReferencePathResolution {
  readonly requestedPath: string
  readonly status: ReferenceResolutionStatus
  readonly strategy: ReferenceResolutionStrategy
  /** Existing matching files when resolution is ambiguous or successful. */
  readonly candidates: readonly WorkspacePath[]
  /** Paths checked by the direct/extension phase, in search order. */
  readonly attemptedPaths: readonly string[]
  /** Canonical target path when `status === 'resolved'`. */
  readonly resolvedPath?: WorkspacePath
  /** Short alias for callers that use `path` for the resolved target. */
  readonly path?: WorkspacePath
  readonly reason?:
    | 'not-found'
    | 'ambiguous-basename'
    | 'invalid-path'
    | 'invalid-host-path'
}

export interface ReferenceResolution extends ReferencePathResolution {
  readonly reference: ParsedReference
  readonly kind: ParsedReference['kind']
  readonly fragment: string | null
  readonly readonly: boolean
}

export class ReferenceResolutionValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceResolutionValidationError'
  }
}

export class ReferenceWorkspaceConsistencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceWorkspaceConsistencyError'
  }
}

function requireRequestedPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ReferenceResolutionValidationError(
      'Reference requested path must be a non-empty string',
    )
  }
  return value
}

function normalizeExtensions(
  extensions: readonly string[] | undefined,
): readonly string[] {
  const values = extensions ?? DEFAULT_REFERENCE_EXTENSIONS
  if (!Array.isArray(values) || values.length === 0) {
    throw new ReferenceResolutionValidationError(
      'Reference extensions must be a non-empty array',
    )
  }

  const normalized: string[] = []
  const seen = new Set<string>()
  for (const extension of values) {
    if (
      typeof extension !== 'string' ||
      !/^\.[^./\\\r\n]+$/u.test(extension)
    ) {
      throw new ReferenceResolutionValidationError(
        'Reference extensions must be file suffixes such as .md',
      )
    }
    if (seen.has(extension)) continue
    seen.add(extension)
    normalized.push(extension)
  }
  return Object.freeze(normalized)
}

function normalizeAvailablePaths(
  availablePaths: readonly (WorkspacePath | string)[],
): readonly WorkspacePath[] {
  if (!Array.isArray(availablePaths)) {
    throw new ReferenceResolutionValidationError(
      'Available workspace paths must be an array',
    )
  }

  const unique = new Set<WorkspacePath>()
  for (const path of availablePaths) {
    if (typeof path !== 'string') {
      throw new ReferenceResolutionValidationError(
        'Available workspace paths must be strings',
      )
    }
    let normalized: WorkspacePath
    try {
      normalized = createWorkspacePath(path)
    } catch (error) {
      throw new ReferenceResolutionValidationError(
        `Invalid available workspace path: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    if (normalized === '') {
      throw new ReferenceResolutionValidationError(
        'Available workspace paths must identify files',
      )
    }
    unique.add(normalized)
  }

  return Object.freeze(
    [...unique].sort((left, right) => {
      const leftLower = left.toLocaleLowerCase('en-US')
      const rightLower = right.toLocaleLowerCase('en-US')
      return (
        leftLower.localeCompare(rightLower, 'en-US') ||
        left.localeCompare(right, 'en-US')
      )
    }),
  )
}

function hasFileExtension(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0
}

function candidateNames(
  path: string,
  extensions: readonly string[],
): readonly string[] {
  if (hasFileExtension(path)) return Object.freeze([path])
  return Object.freeze([path, ...extensions.map((extension) => `${path}${extension}`)])
}

function isExplicitRelativePath(path: string): boolean {
  return (
    path === '.' ||
    path === '..' ||
    path.startsWith('./') ||
    path.startsWith('../')
  )
}

function resolveAgainstHost(
  requestedPath: string,
  hostPath: WorkspacePath | string | null | undefined,
): { readonly path?: WorkspacePath; readonly reason?: 'invalid-path' | 'invalid-host-path' } {
  if (hostPath === null || hostPath === undefined || hostPath === '') {
    return { reason: 'invalid-path' }
  }

  let host: WorkspacePath
  try {
    host = createWorkspacePath(hostPath)
  } catch {
    return { reason: 'invalid-host-path' }
  }

  const segments = workspaceParent(host).split('/').filter(Boolean)
  for (const segment of requestedPath.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return { reason: 'invalid-path' }
      segments.pop()
      continue
    }
    if (segment.includes('\\') || segment === '.') {
      return { reason: 'invalid-path' }
    }
    segments.push(segment)
  }

  try {
    return { path: createWorkspacePath(segments.join('/')) }
  } catch {
    return { reason: 'invalid-path' }
  }
}

interface NormalizedRequest {
  readonly basePath?: WorkspacePath
  readonly explicitRelative: boolean
  readonly reason?: 'invalid-path' | 'invalid-host-path'
}

function normalizeRequest(
  requestedPath: string,
  hostPath: WorkspacePath | string | null | undefined,
): NormalizedRequest {
  const normalized = requestedPath.replaceAll('\\', '/')
  if (isExplicitRelativePath(normalized)) {
    const relative = resolveAgainstHost(normalized, hostPath)
    return {
      basePath: relative.path,
      explicitRelative: true,
      ...(relative.reason === undefined ? {} : { reason: relative.reason }),
    }
  }

  try {
    return {
      basePath: createWorkspacePath(normalized),
      explicitRelative: false,
    }
  } catch {
    return { explicitRelative: false, reason: 'invalid-path' }
  }
}

function freezeResolution(
  input: Omit<ReferencePathResolution, 'candidates' | 'attemptedPaths'> & {
    readonly candidates?: readonly WorkspacePath[]
    readonly attemptedPaths?: readonly string[]
  },
): ReferencePathResolution {
  const candidates = Object.freeze([...(input.candidates ?? [])])
  const attemptedPaths = Object.freeze([...(input.attemptedPaths ?? [])])
  return Object.freeze({
    ...input,
    candidates,
    attemptedPaths,
  })
}

function resolvedPathResult(
  requestedPath: string,
  strategy: ReferenceResolutionStrategy,
  path: WorkspacePath,
  attemptedPaths: readonly string[],
): ReferencePathResolution {
  return freezeResolution({
    requestedPath,
    status: 'resolved',
    strategy,
    candidates: [path],
    attemptedPaths,
    resolvedPath: path,
    path,
  })
}

function ambiguousResult(
  requestedPath: string,
  attemptedPaths: readonly string[],
  candidates: readonly WorkspacePath[],
): ReferencePathResolution {
  return freezeResolution({
    requestedPath,
    status: 'ambiguous',
    strategy: 'ambiguous',
    candidates,
    attemptedPaths,
    reason: 'ambiguous-basename',
  })
}

function missingResult(
  requestedPath: string,
  attemptedPaths: readonly string[],
): ReferencePathResolution {
  return freezeResolution({
    requestedPath,
    status: 'missing',
    strategy: 'missing',
    candidates: [],
    attemptedPaths,
    reason: 'not-found',
  })
}

function invalidResult(
  requestedPath: string,
  reason: 'invalid-path' | 'invalid-host-path',
): ReferencePathResolution {
  return freezeResolution({
    requestedPath,
    status: 'invalid',
    strategy: 'invalid',
    candidates: [],
    attemptedPaths: [],
    reason,
  })
}

function firstDirectMatch(
  basePath: WorkspacePath,
  available: ReadonlySet<WorkspacePath>,
  extensions: readonly string[],
  explicitRelative: boolean,
): ReferencePathResolution | undefined {
  const names = candidateNames(basePath, extensions)
  const attemptedPaths = [...names]
  const exact = names[0] as WorkspacePath
  if (available.has(exact)) {
    return resolvedPathResult(
      basePath,
      explicitRelative ? 'relative-exact' : 'exact',
      exact,
      attemptedPaths,
    )
  }

  for (const candidate of names.slice(1)) {
    const candidatePath = candidate as WorkspacePath
    if (available.has(candidatePath)) {
      return resolvedPathResult(
        basePath,
        explicitRelative ? 'relative-extension' : 'extension',
        candidatePath,
        attemptedPaths,
      )
    }
  }
  return undefined
}

function firstBasenameMatch(
  requestedPath: string,
  basePath: WorkspacePath,
  availablePaths: readonly WorkspacePath[],
  extensions: readonly string[],
  attemptedPaths: readonly string[],
): ReferencePathResolution | undefined {
  const base = workspaceName(basePath)
  const names = candidateNames(base, extensions)

  for (const name of names) {
    const matches = availablePaths.filter(
      (candidate) => workspaceName(candidate) === name,
    )
    if (matches.length === 0) continue
    if (matches.length > 1) {
      return ambiguousResult(requestedPath, attemptedPaths, matches)
    }
    return resolvedPathResult(requestedPath, 'basename', matches[0], attemptedPaths)
  }
  return undefined
}

/**
 * Resolves a reference path against a known workspace file list.
 *
 * Search order is explicit and deterministic:
 * 1. exact workspace-relative path;
 * 2. the configured suffixes (`.md`, `.markdown`, `.txt` by default) when the
 *    request has no extension;
 * 3. for a request without a directory, an exact matching workspace basename
 *    followed by the same suffix order. Multiple basename matches are
 *    reported as ambiguous instead of guessing.
 *
 * Workspace paths are case-sensitive and root-relative. Explicit `./` and
 * `../` requests are resolved from the host document when `hostPath` is
 * supplied; traversal outside the workspace is invalid.
 */
export function resolveReferencePath(
  requestedPath: string,
  availablePaths: readonly (WorkspacePath | string)[],
  options: ReferenceResolutionOptions = {},
): ReferencePathResolution {
  const requested = requireRequestedPath(requestedPath)
  if (options === null || typeof options !== 'object') {
    throw new ReferenceResolutionValidationError(
      'Reference resolution options must be an object',
    )
  }
  const extensions = normalizeExtensions(options.extensions)
  const available = normalizeAvailablePaths(availablePaths)
  const availableSet = new Set(available)
  const normalized = normalizeRequest(requested, options.hostPath)

  if (normalized.reason !== undefined || normalized.basePath === undefined) {
    return invalidResult(requested, normalized.reason ?? 'invalid-path')
  }

  const direct = firstDirectMatch(
    normalized.basePath,
    availableSet,
    extensions,
    normalized.explicitRelative,
  )
  if (direct) {
    // The helper uses the canonical base path in its diagnostic field for
    // direct lookup; the public request remains the source spelling.
    return freezeResolution({ ...direct, requestedPath: requested })
  }

  const attemptedPaths = candidateNames(normalized.basePath, extensions)
  const canSearchBasename =
    options.basenameSearch !== false &&
    !normalized.explicitRelative &&
    !normalized.basePath.includes('/')
  if (canSearchBasename) {
    const basename = firstBasenameMatch(
      requested,
      normalized.basePath,
      available,
      extensions,
      attemptedPaths,
    )
    if (basename) return basename
  }

  return missingResult(requested, attemptedPaths)
}

function validateParsedReference(reference: ParsedReference): void {
  if (reference === null || typeof reference !== 'object') {
    throw new ReferenceResolutionValidationError('Parsed reference is required')
  }
  if (reference.kind !== 'link' && reference.kind !== 'embed') {
    throw new ReferenceResolutionValidationError('Parsed reference kind is invalid')
  }
  if (typeof reference.path !== 'string' || reference.path.length === 0) {
    throw new ReferenceResolutionValidationError('Parsed reference path is invalid')
  }
  if (
    reference.fragment !== null &&
    (typeof reference.fragment !== 'string' || reference.fragment.length === 0)
  ) {
    throw new ReferenceResolutionValidationError(
      'Parsed reference fragment is invalid',
    )
  }
  if (typeof reference.readonly !== 'boolean') {
    throw new ReferenceResolutionValidationError(
      'Parsed reference readonly flag is invalid',
    )
  }
  if (reference.kind === 'link' && reference.readonly) {
    throw new ReferenceResolutionValidationError(
      'Only an embed reference can be readonly',
    )
  }
}

/** Resolves a parsed source token while preserving its fragment and mode. */
export function resolveReference(
  reference: ParsedReference,
  availablePaths: readonly (WorkspacePath | string)[],
  options: ReferenceResolutionOptions = {},
): ReferenceResolution {
  validateParsedReference(reference)
  const pathResolution = resolveReferencePath(
    reference.path,
    availablePaths,
    options,
  )
  return Object.freeze({
    ...pathResolution,
    reference,
    kind: reference.kind,
    fragment: reference.fragment,
    readonly: reference.readonly,
  })
}

function validateCatalog(catalog: ReferenceWorkspaceCatalog): void {
  if (
    catalog === null ||
    typeof catalog !== 'object' ||
    typeof catalog.listDirectory !== 'function'
  ) {
    throw new ReferenceResolutionValidationError(
      'Reference workspace catalog must expose listDirectory',
    )
  }
}

function validateWorkspaceEntry(
  parentPath: WorkspacePath,
  entry: WorkspaceEntry,
): WorkspaceEntry {
  if (entry === null || typeof entry !== 'object') {
    throw new ReferenceWorkspaceConsistencyError(
      `Workspace catalog returned an invalid entry under ${parentPath || '.'}`,
    )
  }
  if (entry.kind !== 'file' && entry.kind !== 'directory') {
    throw new ReferenceWorkspaceConsistencyError(
      `Workspace catalog returned an invalid entry kind under ${parentPath || '.'}`,
    )
  }

  let path: WorkspacePath
  try {
    path = createWorkspacePath(entry.path)
  } catch {
    throw new ReferenceWorkspaceConsistencyError(
      `Workspace catalog returned an invalid path under ${parentPath || '.'}`,
    )
  }
  if (
    path === '' ||
    !isWorkspacePathWithin(path, parentPath) ||
    workspaceParent(path) !== parentPath
  ) {
    throw new ReferenceWorkspaceConsistencyError(
      `Workspace catalog entry ${path || '.'} is not a direct child of ${parentPath || '.'}`,
    )
  }
  if (typeof entry.name !== 'string' || entry.name.length === 0) {
    throw new ReferenceWorkspaceConsistencyError(
      `Workspace catalog entry ${path} has an invalid name`,
    )
  }
  if (entry.name !== workspaceName(path)) {
    throw new ReferenceWorkspaceConsistencyError(
      `Workspace catalog entry ${path} has a name that does not match its path`,
    )
  }
  return Object.freeze({ kind: entry.kind, path, name: entry.name })
}

/** Recursively obtains the current file paths without reading document data. */
export async function collectWorkspaceFilePaths(
  catalog: ReferenceWorkspaceCatalog,
  rootPath: WorkspacePath | string = '' as WorkspacePath,
): Promise<readonly WorkspacePath[]> {
  validateCatalog(catalog)
  let root: WorkspacePath
  try {
    root = createWorkspacePath(rootPath)
  } catch (error) {
    throw new ReferenceResolutionValidationError(
      `Invalid reference workspace root: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  const files: WorkspacePath[] = []
  const seenEntries = new Set<WorkspacePath>()
  const visitedDirectories = new Set<WorkspacePath>()

  const visit = async (directory: WorkspacePath): Promise<void> => {
    if (visitedDirectories.has(directory)) {
      throw new ReferenceWorkspaceConsistencyError(
        `Workspace catalog revisited directory ${directory || '.'}`,
      )
    }
    visitedDirectories.add(directory)

    const entries = await catalog.listDirectory(directory)
    if (!Array.isArray(entries)) {
      throw new ReferenceWorkspaceConsistencyError(
        `Workspace catalog did not return an entry array for ${directory || '.'}`,
      )
    }

    for (const rawEntry of entries) {
      const entry = validateWorkspaceEntry(directory, rawEntry)
      if (seenEntries.has(entry.path)) {
        throw new ReferenceWorkspaceConsistencyError(
          `Workspace catalog returned duplicate entry ${entry.path}`,
        )
      }
      seenEntries.add(entry.path)
      if (entry.kind === 'directory') {
        await visit(entry.path)
      } else {
        files.push(entry.path)
      }
    }
  }

  await visit(root)
  return normalizeAvailablePaths(files)
}

export async function resolveReferenceInWorkspace(
  reference: ParsedReference,
  catalog: ReferenceWorkspaceCatalog,
  options: ReferenceResolutionOptions = {},
): Promise<ReferenceResolution> {
  const files = await collectWorkspaceFilePaths(catalog)
  return resolveReference(reference, files, options)
}

export async function resolveMarkdownReferences(
  source: string,
  catalog: ReferenceWorkspaceCatalog,
  options: ReferenceResolutionOptions = {},
): Promise<readonly ReferenceResolution[]> {
  const references = parseReferences(source)
  const files = await collectWorkspaceFilePaths(catalog)
  return Object.freeze(
    references.map((reference) => resolveReference(reference, files, options)),
  )
}

/** Resolves a source token against a catalog through an explicit service. */
export class WorkspaceReferenceResolver {
  private readonly catalog: ReferenceWorkspaceCatalog

  private readonly defaults: ReferenceResolutionOptions

  constructor(
    catalog: ReferenceWorkspaceCatalog,
    defaults: ReferenceResolutionOptions = {},
  ) {
    validateCatalog(catalog)
    if (defaults === null || typeof defaults !== 'object') {
      throw new ReferenceResolutionValidationError(
        'Reference resolver defaults must be an object',
      )
    }
    // Validate now so a bad adapter configuration cannot fail only after a
    // user opens a reference.
    normalizeExtensions(defaults.extensions)
    this.catalog = catalog
    this.defaults = Object.freeze({ ...defaults })
  }

  async listFiles(
    rootPath: WorkspacePath | string = '' as WorkspacePath,
  ): Promise<readonly WorkspacePath[]> {
    return collectWorkspaceFilePaths(this.catalog, rootPath)
  }

  async resolve(
    reference: ParsedReference,
    options: ReferenceResolutionOptions = {},
  ): Promise<ReferenceResolution> {
    const files = await this.listFiles()
    return resolveReference(reference, files, {
      ...this.defaults,
      ...options,
    })
  }

  async resolveMarkdown(
    source: string,
    options: ReferenceResolutionOptions = {},
  ): Promise<readonly ReferenceResolution[]> {
    const references = parseReferences(source)
    const files = await this.listFiles()
    return Object.freeze(
      references.map((reference) =>
        resolveReference(reference, files, {
          ...this.defaults,
          ...options,
        }),
      ),
    )
  }
}

/** Concise alias for application code that names the service by its job. */
export { WorkspaceReferenceResolver as ReferenceResolver }
