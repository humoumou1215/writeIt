import type { DocumentId, DocumentPath, Revision } from '../document'
import {
  createWorkspacePath,
} from '../workspace'
import type { WorkspacePath } from '../workspace'
import {
  resolveReference,
  type ReferencePathResolution,
  type ReferenceResolutionOptions,
} from './resolution'
import {
  ReferenceGraph,
  type ReferenceGraphEdge,
} from './graph'
import { parseReferences } from './syntax'
import type { ParsedReference } from './syntax'
import {
  createReferenceObjectCandidate,
  resolveReferenceFragment,
} from './fragments'
import type {
  ReferenceFragmentCandidate,
  ReferenceFragmentResolutionStatus,
  ReferenceFragmentTarget,
} from './fragments'

/** The narrow read capability needed to inspect a resolved fragment target. */
export interface ReferenceContentReader {
  readFile(path: WorkspacePath): string | PromiseLike<string>
}

/** Compatibility shape for the existing Markdown FileSystemPort. */
export interface ReferenceDocumentContentReader {
  readFile(path: DocumentPath): string | PromiseLike<string>
}

/** Allows a health service to consume either core path branding or an adapter. */
export type ReferenceContentReaderLike =
  | ReferenceContentReader
  | ReferenceDocumentContentReader
  | {
      readFile(path: string): string | PromiseLike<string>
    }

export interface ReferenceObjectResolverContext {
  readonly path: WorkspacePath
  readonly source: string
}

/** Minimal provider shape accepted for static or dynamic object fragments. */
export interface ReferenceObjectFact {
  readonly id: string
  readonly label: string
  readonly fragment?: string | null
  readonly from?: number
  readonly to?: number
}

/**
 * An optional provider for template/object fragments. It is intentionally a
 * small core contract; the P8 template service can adapt its own suggestion
 * module without making Core depend on Application or an editor.
 */
export type ReferenceObjectResolver = (
  context: ReferenceObjectResolverContext,
) =>
  | readonly (ReferenceFragmentCandidate | ReferenceObjectFact)[]
  | PromiseLike<readonly (ReferenceFragmentCandidate | ReferenceObjectFact)[]>

export type ReferenceHealthStatus =
  | 'resolved'
  | 'missing'
  | 'ambiguous'
  | 'invalid'
  | 'missing-fragment'
  | 'ambiguous-fragment'
  | 'unreadable'
  | 'unknown'

export type ReferenceFragmentHealthStatus =
  | 'not-requested'
  | ReferenceFragmentResolutionStatus
  | 'unreadable'
  | 'unknown'

export interface ReferenceHealthFact {
  /** Stable for a source path and token range while the source is unchanged. */
  readonly id: string
  readonly sourcePath: WorkspacePath
  readonly sourceId?: DocumentId
  readonly sourceRevision?: Revision
  readonly reference: ParsedReference
  readonly raw: string
  readonly from: number
  readonly to: number
  /** Path resolution is kept separately from fragment health for diagnostics. */
  readonly pathStatus: ReferencePathResolution['status']
  readonly fragmentStatus: ReferenceFragmentHealthStatus
  readonly status: ReferenceHealthStatus
  /** `unknown` is not counted as broken: the adapter did not check it. */
  readonly broken: boolean
  readonly resolution: ReferencePathResolution & {
    readonly reference: ParsedReference
    readonly kind: ParsedReference['kind']
    readonly fragment: string | null
    readonly readonly: boolean
  }
  readonly targetPath?: WorkspacePath
  /** Alias used by navigation callers. */
  readonly target?: WorkspacePath
  readonly fragmentTarget?: ReferenceFragmentTarget
  readonly fragmentCandidates: readonly ReferenceFragmentCandidate[]
  readonly candidates: readonly WorkspacePath[]
  readonly message?: string
}

export interface ReferenceHealthDiagnostic {
  readonly id: string
  readonly kind: 'broken-reference'
  readonly severity: 'error'
  readonly sourcePath: WorkspacePath
  readonly from: number
  readonly to: number
  readonly raw: string
  readonly status: Exclude<ReferenceHealthStatus, 'resolved' | 'unknown'>
  readonly message: string
  readonly targetPath?: WorkspacePath
  readonly fragment?: string
  readonly candidates: readonly WorkspacePath[]
}

export interface ReferenceHealthSnapshot {
  readonly generation: number
  readonly graphGeneration: number
  readonly references: readonly ReferenceHealthFact[]
  readonly facts: readonly ReferenceHealthFact[]
  readonly broken: readonly ReferenceHealthFact[]
  readonly diagnostics: readonly ReferenceHealthDiagnostic[]
}

export type ReferenceHealthListener = (
  snapshot: ReferenceHealthSnapshot,
) => void

export interface ReferenceHealthEvaluationOptions
  extends Pick<ReferenceResolutionOptions, 'extensions' | 'basenameSearch'> {
  readonly sourcePath: WorkspacePath | string
  readonly sourceId?: DocumentId
  readonly sourceRevision?: Revision
  readonly availablePaths: readonly (WorkspacePath | string)[]
  readonly contentReader?: ReferenceContentReaderLike
  readonly objectResolver?: ReferenceObjectResolver
}

export interface ReferenceHealthServiceOptions {
  readonly graph: ReferenceGraph
  readonly contentReader?: ReferenceContentReaderLike
  readonly reader?: ReferenceContentReaderLike
  readonly objectResolver?: ReferenceObjectResolver
  readonly extensions?: readonly string[]
  readonly basenameSearch?: boolean
}

export class ReferenceHealthValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceHealthValidationError'
  }
}

function requireSourcePath(value: unknown): WorkspacePath {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ReferenceHealthValidationError(
      'Reference health source path must be a non-empty workspace path',
    )
  }
  try {
    const path = createWorkspacePath(value)
    if (path === '') {
      throw new ReferenceHealthValidationError(
        'Reference health source path must identify a file',
      )
    }
    return path
  } catch (error) {
    if (error instanceof ReferenceHealthValidationError) throw error
    throw new ReferenceHealthValidationError(
      `Reference health source path is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

function requireSource(source: unknown): string {
  if (typeof source !== 'string') {
    throw new ReferenceHealthValidationError(
      'Reference health source must be a string',
    )
  }
  return source
}

function referenceId(sourcePath: WorkspacePath, reference: ParsedReference): string {
  return `${sourcePath}:${reference.from}-${reference.to}`
}

function readReferenceContent(
  reader: ReferenceContentReaderLike,
  path: WorkspacePath,
): string | PromiseLike<string> {
  return (
    reader.readFile as (
      path: string,
    ) => string | PromiseLike<string>
  ).call(reader, path)
}

function formatError(error: unknown): string {
  try {
    const text = String(error)
    return text.length > 0 ? text : 'Reference target could not be read'
  } catch {
    return 'Reference target could not be read'
  }
}

function freezeCandidates<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values])
}

function isReferenceObject(value: unknown): value is {
  readonly id: string
  readonly label: string
  readonly fragment?: string | null
  readonly from?: number
  readonly to?: number
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const candidate = value as {
    readonly id?: unknown
    readonly label?: unknown
    readonly fragment?: unknown
    readonly from?: unknown
    readonly to?: unknown
  }
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    (candidate.fragment === undefined || candidate.fragment === null || typeof candidate.fragment === 'string') &&
    (candidate.from === undefined || Number.isSafeInteger(candidate.from)) &&
    (candidate.to === undefined || Number.isSafeInteger(candidate.to))
  )
}

async function resolveObjects(
  resolver: ReferenceObjectResolver | undefined,
  path: WorkspacePath,
  source: string,
): Promise<readonly ReferenceFragmentCandidate[]> {
  if (!resolver) return Object.freeze([])

  try {
    const result = await resolver({ path, source })
    if (!Array.isArray(result)) return Object.freeze([])
    const candidates: ReferenceFragmentCandidate[] = []
    for (const value of result) {
      if (!isReferenceObject(value)) continue
      try {
        candidates.push(
          createReferenceObjectCandidate({
            id: value.id,
            label: value.label,
            fragment: value.fragment,
            ...(value.from === undefined ? {} : { from: value.from }),
            ...(value.to === undefined ? {} : { to: value.to }),
          }),
        )
      } catch {
        // A malformed derived object must not make a valid heading target
        // appear broken. Ignore just that object and retain safe fallbacks.
      }
    }
    return freezeCandidates(candidates)
  } catch {
    // Suggestion/object providers are derived data. Heading resolution below
    // remains available even when a provider is unavailable.
    return Object.freeze([])
  }
}

function healthMessage(
  status: ReferenceHealthStatus,
  reference: ParsedReference,
  targetPath?: WorkspacePath,
  candidates: readonly WorkspacePath[] = [],
): string {
  if (status === 'missing') return `Reference target not found: ${reference.path}`
  if (status === 'ambiguous') {
    return candidates.length > 0
      ? `Reference target is ambiguous: ${reference.path} (${candidates.join(', ')})`
      : `Reference target is ambiguous: ${reference.path}`
  }
  if (status === 'invalid') return `Reference target path is invalid: ${reference.path}`
  if (status === 'unreadable') {
    return targetPath
      ? `Reference target could not be read: ${targetPath}`
      : `Reference target could not be read: ${reference.path}`
  }
  if (status === 'missing-fragment') {
    return `Reference fragment not found: ${targetPath ?? reference.path}#${reference.fragment ?? ''}`
  }
  if (status === 'ambiguous-fragment') {
    return `Reference fragment is ambiguous: ${targetPath ?? reference.path}#${reference.fragment ?? ''}`
  }
  if (status === 'unknown') return 'Reference health was not checked'
  return `Reference could not be resolved: ${reference.raw}`
}

function baseFact(
  sourcePath: WorkspacePath,
  reference: ParsedReference,
  resolution: ReferencePathResolution & {
    readonly reference: ParsedReference
    readonly kind: ParsedReference['kind']
    readonly fragment: string | null
    readonly readonly: boolean
  },
  sourceId?: DocumentId,
  sourceRevision?: Revision,
): Pick<ReferenceHealthFact, 'id' | 'sourcePath' | 'sourceId' | 'sourceRevision' | 'reference' | 'raw' | 'from' | 'to' | 'resolution' | 'pathStatus' | 'candidates'> {
  return {
    id: referenceId(sourcePath, reference),
    sourcePath,
    ...(sourceId === undefined ? {} : { sourceId }),
    ...(sourceRevision === undefined ? {} : { sourceRevision }),
    reference,
    raw: reference.raw,
    from: reference.from,
    to: reference.to,
    resolution,
    pathStatus: resolution.status,
    candidates: freezeCandidates(resolution.candidates),
  }
}

function freezeFact(input: ReferenceHealthFact): ReferenceHealthFact {
  return Object.freeze({
    ...input,
    fragmentCandidates: freezeCandidates(input.fragmentCandidates),
    candidates: freezeCandidates(input.candidates),
  })
}

/**
 * Evaluates one parsed reference without changing its source token. Path
 * resolution comes first; a fragment is checked only after a target is known.
 */
export async function evaluateReferenceHealth(
  reference: ParsedReference,
  options: ReferenceHealthEvaluationOptions,
): Promise<ReferenceHealthFact> {
  if (reference === null || typeof reference !== 'object') {
    throw new ReferenceHealthValidationError('Reference health reference is required')
  }
  const sourcePath = requireSourcePath(options.sourcePath)

  const resolution = resolveReference(reference, options.availablePaths, {
    extensions: options.extensions,
    basenameSearch: options.basenameSearch,
    hostPath: sourcePath,
  })
  const base = baseFact(
    sourcePath,
    reference,
    resolution,
    options.sourceId,
    options.sourceRevision,
  )

  if (resolution.status !== 'resolved') {
    const status = resolution.status
    return freezeFact({
      ...base,
      status,
      broken: true,
      fragmentStatus:
        reference.fragment === null ? 'not-requested' : 'unknown',
      fragmentCandidates: [],
      message: healthMessage(status, reference, undefined, resolution.candidates),
    })
  }

  const targetPath = resolution.resolvedPath
  if (!targetPath) {
    return freezeFact({
      ...base,
      status: 'invalid',
      broken: true,
      fragmentStatus: 'not-requested',
      fragmentCandidates: [],
      message: healthMessage('invalid', reference),
    })
  }

  if (reference.fragment === null) {
    return freezeFact({
      ...base,
      status: 'resolved',
      broken: false,
      fragmentStatus: 'not-requested',
      targetPath,
      target: targetPath,
      fragmentCandidates: [],
    })
  }

  let targetSource = ''
  let targetReadable = false
  if (options.contentReader) {
    try {
      targetSource = await readReferenceContent(options.contentReader, targetPath)
      if (typeof targetSource !== 'string') {
        throw new TypeError('Reference content reader must return a string')
      }
      targetReadable = true
    } catch (error) {
      return freezeFact({
        ...base,
        status: 'unreadable',
        broken: true,
        fragmentStatus: 'unreadable',
        targetPath,
        target: targetPath,
        fragmentCandidates: [],
        message: `${healthMessage('unreadable', reference, targetPath)}: ${formatError(error)}`,
      })
    }
  }

  // Static object providers can resolve an object fragment without reading
  // target bytes. Dynamic providers receive an empty source in this case and
  // simply fall back to the unreadable state when they cannot decide.
  const objects = await resolveObjects(
    options.objectResolver,
    targetPath,
    targetSource,
  )
  const fragment = resolveReferenceFragment(
    targetSource,
    reference.fragment,
    objects,
  )
  if (fragment.status === 'resolved' && fragment.target) {
    return freezeFact({
      ...base,
      status: 'resolved',
      broken: false,
      fragmentStatus: 'resolved',
      targetPath,
      target: targetPath,
      fragmentTarget: Object.freeze({
        ...fragment.target,
        path: targetPath,
      }),
      fragmentCandidates: fragment.candidates,
    })
  }

  if (!targetReadable) {
    return freezeFact({
      ...base,
      status: 'unreadable',
      broken: true,
      fragmentStatus: 'unreadable',
      targetPath,
      target: targetPath,
      fragmentCandidates: fragment.candidates,
      message: healthMessage('unreadable', reference, targetPath),
    })
  }

  const status: ReferenceHealthStatus =
    fragment.status === 'ambiguous'
      ? 'ambiguous-fragment'
      : fragment.status === 'invalid'
        ? 'invalid'
        : 'missing-fragment'
  return freezeFact({
    ...base,
    status,
    broken: true,
    fragmentStatus: fragment.status,
    targetPath,
    target: targetPath,
    fragmentCandidates: fragment.candidates,
    message: healthMessage(status, reference, targetPath),
  })
}

/** Evaluates every supported reference in a source snapshot. */
export async function evaluateMarkdownReferenceHealth(
  sourcePath: WorkspacePath | string,
  source: string,
  options: Omit<ReferenceHealthEvaluationOptions, 'sourcePath' | 'availablePaths'> & {
    readonly availablePaths: readonly (WorkspacePath | string)[]
  },
): Promise<readonly ReferenceHealthFact[]> {
  const normalizedSourcePath = requireSourcePath(sourcePath)
  const markdown = requireSource(source)
  const references = parseReferences(markdown)
  const facts = await Promise.all(
    references.map((reference) =>
      evaluateReferenceHealth(reference, {
        ...options,
        sourcePath: normalizedSourcePath,
        availablePaths: options.availablePaths,
      }),
    ),
  )
  return Object.freeze(facts)
}

/** A source-shaped alias for callers that use “check” terminology. */
export const checkReferenceHealth = evaluateMarkdownReferenceHealth
export const resolveReferenceHealth = evaluateReferenceHealth
export const resolveMarkdownReferenceHealth = evaluateMarkdownReferenceHealth

/** Creates non-authoritative facts for a surface that has no health adapter. */
export function createUnknownReferenceHealth(
  sourcePath: WorkspacePath | string,
  source: string,
  sourceId?: DocumentId,
  sourceRevision?: Revision,
): readonly ReferenceHealthFact[] {
  const path = requireSourcePath(sourcePath)
  const markdown = requireSource(source)
  return Object.freeze(
    parseReferences(markdown).map((reference) =>
      freezeFact({
        id: referenceId(path, reference),
        sourcePath: path,
        ...(sourceId === undefined ? {} : { sourceId }),
        ...(sourceRevision === undefined ? {} : { sourceRevision }),
        reference,
        raw: reference.raw,
        from: reference.from,
        to: reference.to,
        pathStatus: 'missing',
        fragmentStatus:
          reference.fragment === null ? 'not-requested' : 'unknown',
        status: 'unknown',
        broken: false,
        resolution: Object.freeze({
          requestedPath: reference.path,
          status: 'missing',
          strategy: 'missing',
          candidates: Object.freeze([]),
          attemptedPaths: Object.freeze([]),
          reference,
          kind: reference.kind,
          fragment: reference.fragment,
          readonly: reference.readonly,
        }),
        fragmentCandidates: [],
        candidates: [],
        message: 'Reference health was not checked',
      }),
    ),
  )
}

function diagnosticForFact(
  fact: ReferenceHealthFact,
): ReferenceHealthDiagnostic | undefined {
  if (!fact.broken || fact.status === 'resolved' || fact.status === 'unknown') {
    return undefined
  }
  return Object.freeze({
    id: fact.id,
    kind: 'broken-reference',
    severity: 'error',
    sourcePath: fact.sourcePath,
    from: fact.from,
    to: fact.to,
    raw: fact.raw,
    status: fact.status,
    message: fact.message ?? healthMessage(fact.status, fact.reference, fact.targetPath, fact.candidates),
    ...(fact.targetPath === undefined ? {} : { targetPath: fact.targetPath }),
    ...(fact.reference.fragment === null
      ? {}
      : { fragment: fact.reference.fragment }),
    candidates: fact.candidates,
  })
}

function snapshotForFacts(
  generation: number,
  graphGeneration: number,
  facts: readonly ReferenceHealthFact[],
): ReferenceHealthSnapshot {
  const broken = facts.filter((fact) => fact.broken)
  const diagnostics = broken
    .map(diagnosticForFact)
    .filter((diagnostic): diagnostic is ReferenceHealthDiagnostic => diagnostic !== undefined)
  const frozenFacts = freezeCandidates(facts)
  return Object.freeze({
    generation,
    graphGeneration,
    references: frozenFacts,
    facts: frozenFacts,
    broken: freezeCandidates(broken),
    diagnostics: freezeCandidates(diagnostics),
  })
}

/**
 * Graph-backed health service. It stores only derived reference facts and
 * diagnostics; document Markdown remains owned by DocumentStore/filesystem.
 */
export class ReferenceHealthService {
  private readonly graph: ReferenceGraph
  private readonly contentReader?: ReferenceContentReaderLike
  private readonly objectResolver?: ReferenceObjectResolver
  private readonly resolutionOptions: Pick<ReferenceResolutionOptions, 'extensions' | 'basenameSearch'>
  private readonly listeners = new Set<ReferenceHealthListener>()
  private readonly unsubscribeGraph: () => void
  private refreshTail: Promise<unknown> = Promise.resolve()
  private generation = 0
  private snapshotValue: ReferenceHealthSnapshot = snapshotForFacts(0, 0, [])

  constructor(options: ReferenceHealthServiceOptions)
  constructor(
    graph: ReferenceGraph,
    options?: Omit<ReferenceHealthServiceOptions, 'graph'>,
  )
  constructor(
    graphOrOptions: ReferenceGraph | ReferenceHealthServiceOptions,
    options: Omit<ReferenceHealthServiceOptions, 'graph'> = {},
  ) {
    const normalized =
      graphOrOptions instanceof ReferenceGraph
        ? { graph: graphOrOptions, ...options }
        : graphOrOptions
    if (!(normalized.graph instanceof ReferenceGraph)) {
      throw new ReferenceHealthValidationError(
        'Reference health service requires a ReferenceGraph',
      )
    }

    const readers = [normalized.contentReader, normalized.reader].filter(
      (reader): reader is ReferenceContentReaderLike => reader !== undefined,
    )
    if (
      readers.some(
        (reader) =>
          reader === null ||
          typeof reader !== 'object' ||
          typeof reader.readFile !== 'function',
      )
    ) {
      throw new ReferenceHealthValidationError(
        'Reference health content reader must expose readFile',
      )
    }
    if (readers.length > 1 && readers.some((reader) => reader !== readers[0])) {
      throw new ReferenceHealthValidationError(
        'Reference health reader aliases must refer to one reader',
      )
    }
    if (
      normalized.objectResolver !== undefined &&
      typeof normalized.objectResolver !== 'function'
    ) {
      throw new ReferenceHealthValidationError(
        'Reference health objectResolver must be a function',
      )
    }

    this.graph = normalized.graph
    this.contentReader = readers[0]
    this.objectResolver = normalized.objectResolver
    this.resolutionOptions = Object.freeze({
      ...(normalized.extensions === undefined
        ? {}
        : { extensions: Object.freeze([...normalized.extensions]) }),
      ...(normalized.basenameSearch === undefined
        ? {}
        : { basenameSearch: normalized.basenameSearch }),
    })
    this.unsubscribeGraph = this.graph.subscribe(() => {
      void this.refresh().catch(() => undefined)
    })
  }

  getSnapshot(): ReferenceHealthSnapshot {
    return this.snapshotValue
  }

  getFacts(): readonly ReferenceHealthFact[] {
    return this.snapshotValue.facts
  }

  getBrokenReferences(): readonly ReferenceHealthFact[] {
    return this.snapshotValue.broken
  }

  getDiagnostics(): readonly ReferenceHealthDiagnostic[] {
    return this.snapshotValue.diagnostics
  }

  subscribe(listener: ReferenceHealthListener): () => void {
    if (typeof listener !== 'function') {
      throw new ReferenceHealthValidationError(
        'Reference health listener must be a function',
      )
    }
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  /** Resolves the current source of one editor without caching its Markdown. */
  resolveSource(
    sourcePath: WorkspacePath | string,
    source: string,
    sourceId?: DocumentId,
    sourceRevision?: Revision,
  ): Promise<readonly ReferenceHealthFact[]> {
    return evaluateMarkdownReferenceHealth(sourcePath, source, {
      ...this.resolutionOptions,
      availablePaths: this.graph.getWorkspacePaths(),
      contentReader: this.contentReader,
      objectResolver: this.objectResolver,
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(sourceRevision === undefined ? {} : { sourceRevision }),
    })
  }

  /** Re-evaluates all graph edges and publishes a diagnostics snapshot. */
  refresh(): Promise<ReferenceHealthSnapshot> {
    const run = this.refreshTail.then(() => this.refreshNow())
    this.refreshTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async refreshNow(): Promise<ReferenceHealthSnapshot> {
    // A target read can yield while the graph is rebuilt. Repeat until the
    // graph generation used for every fact is stable; no clock-based wait is
    // needed and no late result can overwrite newer derived state.
    while (true) {
      const graphGeneration = this.graph.getGeneration()
      const edges = this.graph.getEdges()
      const availablePaths = this.graph.getWorkspacePaths()
      const facts = await Promise.all(
        edges.map((edge) =>
          evaluateReferenceHealth(edge.reference, {
            ...this.resolutionOptions,
            sourcePath: edge.sourcePath,
            sourceId: edge.sourceId,
            sourceRevision: edge.sourceRevision,
            availablePaths,
            contentReader: this.contentReader,
            objectResolver: this.objectResolver,
          }),
        ),
      )
      if (graphGeneration !== this.graph.getGeneration()) continue

      this.generation += 1
      this.snapshotValue = snapshotForFacts(
        this.generation,
        graphGeneration,
        facts,
      )
      for (const listener of [...this.listeners]) {
        try {
          listener(this.snapshotValue)
        } catch {
          // A diagnostics observer cannot interrupt health publication.
        }
      }
      return this.snapshotValue
    }
  }

  dispose(): void {
    this.unsubscribeGraph()
    this.listeners.clear()
  }
}

/** Compatibility aliases for callers that model health as a resolver service. */
export {
  ReferenceHealthService as ReferenceHealth,
  ReferenceHealthService as ReferenceHealthResolver,
}

/** Returns only broken diagnostics from a health snapshot. */
export function getReferenceDiagnostics(
  snapshot: ReferenceHealthSnapshot,
): readonly ReferenceHealthDiagnostic[] {
  if (snapshot === null || typeof snapshot !== 'object') {
    throw new ReferenceHealthValidationError('Reference health snapshot is required')
  }
  return snapshot.diagnostics
}

/** Keeps graph-edge consumers source-compatible with the health API. */
export function healthForGraphEdge(
  edge: ReferenceGraphEdge,
  options: Omit<ReferenceHealthEvaluationOptions, 'sourcePath' | 'sourceId' | 'sourceRevision'> & {
    readonly contentReader?: ReferenceContentReaderLike
    readonly objectResolver?: ReferenceObjectResolver
  },
): Promise<ReferenceHealthFact> {
  return evaluateReferenceHealth(edge.reference, {
    ...options,
    sourcePath: edge.sourcePath,
    sourceId: edge.sourceId,
    sourceRevision: edge.sourceRevision,
  })
}
