import {
  createWorkspacePath,
  workspaceName,
} from '../workspace'
import type { WorkspacePath } from '../workspace'
import {
  resolveReference,
  resolveReferencePath,
} from './resolution'
import type {
  ReferencePathResolution,
  ReferenceResolutionOptions,
  ReferenceResolutionStatus,
} from './resolution'
import {
  ReferenceIndex,
} from './reference-index'
import type {
  ReferenceDocumentInput,
  ReferenceIndexEntry,
  ReferenceSourceLocator,
} from './reference-index'
import type { ParsedReference, ReferenceKind } from './syntax'
import type { DocumentId, Revision } from '../document'

export interface ReferenceGraphOptions
  extends Pick<ReferenceResolutionOptions, 'extensions' | 'basenameSearch'> {
  /** Paths known to exist even when their documents are not currently loaded. */
  readonly workspacePaths?: readonly (WorkspacePath | string)[]
  /** Initial source snapshots to parse into the derived index. */
  readonly documents?: Iterable<ReferenceDocumentInput>
}

export type ReferenceGraphInput =
  | ReferenceIndex
  | ReferenceGraphOptions
  | Iterable<ReferenceDocumentInput>

export interface ReferenceGraphNode {
  readonly path: WorkspacePath
  readonly name: string
  readonly indexed: boolean
  readonly sourceId?: DocumentId
  readonly revision?: Revision
}

export interface ReferenceGraphEdge {
  /** Stable for the source path and token offsets in one graph generation. */
  readonly id: string
  readonly source: WorkspacePath
  readonly sourcePath: WorkspacePath
  readonly sourceId?: DocumentId
  readonly sourceRevision: Revision
  readonly reference: ParsedReference
  readonly kind: ReferenceKind
  readonly fragment: string | null
  readonly readonly: boolean
  readonly raw: string
  readonly from: number
  readonly to: number
  readonly status: ReferenceResolutionStatus
  readonly resolution: ReferencePathResolution & {
    readonly reference: ParsedReference
    readonly kind: ReferenceKind
    readonly fragment: string | null
    readonly readonly: boolean
  }
  readonly target?: WorkspacePath
  readonly targetPath?: WorkspacePath
}

/** A resolved incoming edge, retaining the exact source token and offsets. */
export type BacklinkFact = ReferenceGraphEdge & {
  readonly target: WorkspacePath
  readonly targetPath: WorkspacePath
}

export interface ReferenceGraphSnapshot {
  readonly generation: number
  readonly nodes: readonly ReferenceGraphNode[]
  readonly edges: readonly ReferenceGraphEdge[]
}

export type ReferenceGraphListener = (
  snapshot: ReferenceGraphSnapshot,
) => void

export class ReferenceGraphValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceGraphValidationError'
  }
}

function isReferenceIndex(value: ReferenceGraphInput): value is ReferenceIndex {
  return value instanceof ReferenceIndex
}

function isOptions(value: ReferenceGraphInput): value is ReferenceGraphOptions {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !isReferenceIndex(value)
}

function normalizeWorkspacePaths(
  paths: readonly (WorkspacePath | string)[] | undefined,
): readonly WorkspacePath[] {
  if (paths === undefined) return Object.freeze([])
  if (!Array.isArray(paths)) {
    throw new ReferenceGraphValidationError(
      'Reference graph workspacePaths must be an array',
    )
  }

  const unique = new Set<WorkspacePath>()
  for (const value of paths) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ReferenceGraphValidationError(
        'Reference graph workspace paths must be non-empty strings',
      )
    }
    let path: WorkspacePath
    try {
      path = createWorkspacePath(value)
    } catch (error) {
      throw new ReferenceGraphValidationError(
        `Reference graph workspace path is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    if (path === '') {
      throw new ReferenceGraphValidationError(
        'Reference graph workspace paths must identify files',
      )
    }
    unique.add(path)
  }

  return sortPaths(unique)
}

function sortPaths(paths: Iterable<WorkspacePath>): readonly WorkspacePath[] {
  return Object.freeze(
    [...paths].sort((left, right) => {
      const lowerOrder = left.toLocaleLowerCase('en-US').localeCompare(
        right.toLocaleLowerCase('en-US'),
        'en-US',
      )
      return lowerOrder || left.localeCompare(right, 'en-US')
    }),
  )
}

function normalizeOptions(
  options: ReferenceGraphOptions,
): ReferenceGraphOptions {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ReferenceGraphValidationError(
      'Reference graph options must be an object',
    )
  }
  if (
    options.basenameSearch !== undefined &&
    typeof options.basenameSearch !== 'boolean'
  ) {
    throw new ReferenceGraphValidationError(
      'Reference graph basenameSearch must be a boolean',
    )
  }

  // The resolver owns extension validation. Running a harmless lookup here
  // makes a bad graph configuration fail at construction time, not on the
  // first edge refresh.
  if (options.extensions !== undefined) {
    try {
      resolveReferencePath('__writeit_reference_options_probe__', [], {
        extensions: options.extensions,
      })
    } catch (error) {
      throw new ReferenceGraphValidationError(
        `Reference graph extensions are invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  return Object.freeze({
    ...(options.extensions === undefined
      ? {}
      : { extensions: Object.freeze([...options.extensions]) }),
    ...(options.basenameSearch === undefined
      ? {}
      : { basenameSearch: options.basenameSearch }),
  })
}

function sourceLocatorPath(
  index: ReferenceIndex,
  locator: ReferenceSourceLocator,
): WorkspacePath | undefined {
  const entry = index.get(locator)
  return entry?.sourcePath
}

function normalizeTargetPath(path: WorkspacePath | string): WorkspacePath {
  if (typeof path !== 'string' || path.length === 0) {
    throw new ReferenceGraphValidationError(
      'Reference graph target path must be a non-empty string',
    )
  }
  try {
    const normalized = createWorkspacePath(path)
    if (normalized === '') {
      throw new ReferenceGraphValidationError(
        'Reference graph target path must identify a file',
      )
    }
    return normalized
  } catch (error) {
    if (error instanceof ReferenceGraphValidationError) throw error
    throw new ReferenceGraphValidationError(
      `Reference graph target path is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

function edgeId(
  sourcePath: WorkspacePath,
  reference: ParsedReference,
): string {
  return `${sourcePath}:${reference.from}-${reference.to}`
}

function freezeNode(input: ReferenceGraphNode): ReferenceGraphNode {
  return Object.freeze({
    ...input,
  })
}

function freezeEdge(input: ReferenceGraphEdge): ReferenceGraphEdge {
  return Object.freeze({
    ...input,
  })
}

/**
 * A source-backed reference graph. Nodes and edges are rebuilt from
 * ReferenceIndex facts whenever a source document or workspace path changes;
 * neither the index nor this graph stores Markdown or controls persistence.
 */
export class ReferenceGraph {
  private readonly index: ReferenceIndex

  private readonly unsubscribeIndex: () => void

  private readonly resolutionOptions: ReferenceGraphOptions

  private readonly listeners = new Set<ReferenceGraphListener>()

  /** Workspace catalog paths, kept separate from paths implied by indexed sources. */
  private configuredWorkspacePaths: readonly WorkspacePath[]

  private nodes: readonly ReferenceGraphNode[] = Object.freeze([])

  private edges: readonly ReferenceGraphEdge[] = Object.freeze([])

  private generation = 0

  constructor(input: ReferenceGraphInput = {}, options: ReferenceGraphOptions = {}) {
    let initialOptions: ReferenceGraphOptions
    if (isReferenceIndex(input)) {
      this.index = input
      initialOptions = options
    } else if (isOptions(input)) {
      initialOptions = input
      this.index = new ReferenceIndex(input.documents ?? [])
    } else {
      initialOptions = options
      this.index = new ReferenceIndex(input)
    }

    const normalizedOptions = normalizeOptions(initialOptions)
    this.resolutionOptions = normalizedOptions
    this.configuredWorkspacePaths = normalizeWorkspacePaths(initialOptions.workspacePaths)
    this.unsubscribeIndex = this.index.subscribe(() => {
      this.refresh()
    })
    this.refresh()
  }

  getGeneration(): number {
    return this.generation
  }

  getIndex(): ReferenceIndex {
    return this.index
  }

  getWorkspacePaths(): readonly WorkspacePath[] {
    const paths = new Set<WorkspacePath>(this.configuredWorkspacePaths)
    for (const entry of this.index.getAll()) paths.add(entry.sourcePath)
    return sortPaths(paths)
  }

  getSnapshot(): ReferenceGraphSnapshot {
    return Object.freeze({
      generation: this.generation,
      nodes: this.nodes,
      edges: this.edges,
    })
  }

  subscribe(listener: ReferenceGraphListener): () => void {
    if (typeof listener !== 'function') {
      throw new ReferenceGraphValidationError(
        'Reference graph listener must be a function',
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

  getNodes(): readonly ReferenceGraphNode[] {
    return this.nodes
  }

  getEdges(): readonly ReferenceGraphEdge[] {
    return this.edges
  }

  getNode(path: WorkspacePath | string): ReferenceGraphNode | undefined {
    const normalized = normalizeTargetPath(path)
    return this.nodes.find((node) => node.path === normalized)
  }

  /** Adds or replaces one source snapshot and refreshes derived edges. */
  indexDocument(input: ReferenceDocumentInput): ReferenceIndexEntry {
    return this.index.indexDocument(input)
  }

  upsert(input: ReferenceDocumentInput): ReferenceIndexEntry {
    return this.indexDocument(input)
  }

  /** Replaces all source snapshots and refreshes the graph. */
  rebuild(
    documents?: Iterable<ReferenceDocumentInput>,
  ): ReferenceGraphSnapshot {
    if (documents !== undefined) {
      this.index.rebuild(documents)
      return this.getSnapshot()
    }
    return this.refresh()
  }

  /** Re-resolves existing parsed facts after the workspace catalog changes. */
  refresh(): ReferenceGraphSnapshot {
    const indexedEntries = this.index.getAll()
    const available = new Set<WorkspacePath>(this.configuredWorkspacePaths)
    for (const entry of indexedEntries) available.add(entry.sourcePath)
    const availablePaths = sortPaths(available)

    const nodeByPath = new Map<WorkspacePath, ReferenceGraphNode>()
    for (const path of availablePaths) {
      const entry = this.index.getByPath(path)
      nodeByPath.set(
        path,
        freezeNode({
          path,
          name: workspaceName(path),
          indexed: entry !== undefined,
          ...(entry?.sourceId === undefined ? {} : { sourceId: entry.sourceId }),
          ...(entry === undefined ? {} : { revision: entry.revision }),
        }),
      )
    }
    for (const entry of indexedEntries) {
      if (nodeByPath.has(entry.sourcePath)) continue
      nodeByPath.set(
        entry.sourcePath,
        freezeNode({
          path: entry.sourcePath,
          name: workspaceName(entry.sourcePath),
          indexed: true,
          ...(entry.sourceId === undefined ? {} : { sourceId: entry.sourceId }),
          revision: entry.revision,
        }),
      )
    }

    const edges: ReferenceGraphEdge[] = []
    for (const entry of indexedEntries) {
      for (const reference of entry.references) {
        const resolution = resolveReference(reference, availablePaths, {
          ...this.resolutionOptions,
          hostPath: entry.sourcePath,
        })
        const targetPath =
          resolution.status === 'resolved'
            ? resolution.resolvedPath
            : undefined
        edges.push(
          freezeEdge({
            id: edgeId(entry.sourcePath, reference),
            source: entry.sourcePath,
            sourcePath: entry.sourcePath,
            ...(entry.sourceId === undefined ? {} : { sourceId: entry.sourceId }),
            sourceRevision: entry.revision,
            reference,
            kind: reference.kind,
            fragment: reference.fragment,
            readonly: reference.readonly,
            raw: reference.raw,
            from: reference.from,
            to: reference.to,
            status: resolution.status,
            resolution,
            ...(targetPath === undefined
              ? {}
              : { target: targetPath, targetPath }),
          }),
        )
      }
    }

    edges.sort((left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.from - right.from ||
      left.to - right.to,
    )
    this.nodes = Object.freeze(
      [...nodeByPath.values()].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    )
    this.edges = Object.freeze(edges)
    this.generation++
    const snapshot = this.getSnapshot()
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot)
      } catch {
        // A derived graph observer must not interrupt index/source updates.
      }
    }
    return snapshot
  }

  setWorkspacePaths(
    paths: readonly (WorkspacePath | string)[],
  ): ReferenceGraphSnapshot {
    this.configuredWorkspacePaths = normalizeWorkspacePaths(paths)
    return this.refresh()
  }

  /** Alias for callers that receive a workspace file catalog. */
  setAvailablePaths(
    paths: readonly (WorkspacePath | string)[],
  ): ReferenceGraphSnapshot {
    return this.setWorkspacePaths(paths)
  }

  removeDocument(
    locator: ReferenceSourceLocator,
  ): ReferenceIndexEntry | undefined {
    return this.index.removeDocument(locator)
  }

  remove(locator: ReferenceSourceLocator): ReferenceIndexEntry | undefined {
    return this.removeDocument(locator)
  }

  /** Stops following an externally-owned ReferenceIndex. */
  dispose(): void {
    this.unsubscribeIndex()
    this.listeners.clear()
  }

  getOutgoing(locator: ReferenceSourceLocator): readonly ReferenceGraphEdge[] {
    const path = sourceLocatorPath(this.index, locator)
    if (path === undefined) return Object.freeze([])
    return Object.freeze(
      this.edges.filter((edge) => edge.sourcePath === path),
    )
  }

  /** Alias used by callers that name the direction explicitly. */
  outgoing(locator: ReferenceSourceLocator): readonly ReferenceGraphEdge[] {
    return this.getOutgoing(locator)
  }

  getIncoming(path: WorkspacePath | string): readonly BacklinkFact[] {
    const target = normalizeTargetPath(path)
    return Object.freeze(
      this.edges.filter(
        (edge): edge is BacklinkFact => edge.targetPath === target,
      ),
    )
  }

  getBacklinks(path: WorkspacePath | string): readonly BacklinkFact[] {
    return this.getIncoming(path)
  }

  /** Returns unique source documents that link to a target, preserving edge order. */
  getBacklinkSources(path: WorkspacePath | string): readonly WorkspacePath[] {
    const sources = new Set<WorkspacePath>()
    for (const edge of this.getIncoming(path)) sources.add(edge.sourcePath)
    return Object.freeze([...sources])
  }

  getBrokenReferences(): readonly ReferenceGraphEdge[] {
    return Object.freeze(
      this.edges.filter((edge) => edge.status !== 'resolved'),
    )
  }

  getEdgesByStatus(
    status: ReferenceResolutionStatus,
  ): readonly ReferenceGraphEdge[] {
    return Object.freeze(this.edges.filter((edge) => edge.status === status))
  }
}

export function buildReferenceGraph(
  documents: Iterable<ReferenceDocumentInput>,
  options: Omit<ReferenceGraphOptions, 'documents'> = {},
): ReferenceGraph {
  return new ReferenceGraph({ ...options, documents })
}
