import {
  createWorkspacePath,
  isWorkspacePath,
} from '../../core/workspace'
import type { WorkspacePath } from '../../core/workspace'
import type { SettingsStoragePort } from '../../platform/settings'

export const WORKSPACE_RECOVERY_STORAGE_KEY = 'writeit-v2.workspace-recovery'

export interface WorkspaceRecoveryState {
  /** Identity of the workspace whose session was recorded. */
  readonly workspacePath: WorkspacePath
  /** Open documents are represented by paths, never by source snapshots. */
  readonly openDocumentPaths: readonly WorkspacePath[]
  readonly activeDocumentPath: WorkspacePath | null
  /** Last selected tree entry, which may be a directory. */
  readonly selectedWorkspacePath: WorkspacePath | null
}

export interface WorkspaceRecoveryInput {
  readonly workspacePath: WorkspacePath | string
  readonly openDocumentPaths?: readonly (WorkspacePath | string)[]
  readonly activeDocumentPath?: WorkspacePath | string | null
  readonly selectedWorkspacePath?: WorkspacePath | string | null
}

export interface WorkspaceRecoveryStoreOptions {
  readonly storageKey?: string
  readonly workspacePath?: WorkspacePath | string
}

export type WorkspaceRecoveryListener = (
  state: WorkspaceRecoveryState,
) => void
export type WorkspaceRecoveryUnsubscribe = () => void

export class WorkspaceRecoveryValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceRecoveryValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizePath(value: unknown, name: string): WorkspacePath {
  if (typeof value !== 'string') {
    throw new WorkspaceRecoveryValidationError(`${name} must be a workspace path`)
  }
  try {
    return createWorkspacePath(value)
  } catch (error) {
    throw new WorkspaceRecoveryValidationError(
      `${name} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function normalizeOptionalPath(
  value: unknown,
  name: string,
): WorkspacePath | null {
  if (value === null || value === undefined) return null
  return normalizePath(value, name)
}

function normalizeOpenPaths(value: unknown): readonly WorkspacePath[] {
  if (!Array.isArray(value)) {
    throw new WorkspaceRecoveryValidationError(
      'openDocumentPaths must be an array',
    )
  }

  const paths: WorkspacePath[] = []
  const seen = new Set<WorkspacePath>()
  for (const [index, candidate] of value.entries()) {
    const path = normalizePath(candidate, `openDocumentPaths[${index}]`)
    if (path === '') {
      throw new WorkspaceRecoveryValidationError(
        'openDocumentPaths cannot contain the workspace root',
      )
    }
    if (seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return Object.freeze(paths)
}

function createState(input: {
  readonly workspacePath: WorkspacePath | string
  readonly openDocumentPaths?: readonly (WorkspacePath | string)[]
  readonly activeDocumentPath?: WorkspacePath | string | null
  readonly selectedWorkspacePath?: WorkspacePath | string | null
}): WorkspaceRecoveryState {
  const workspacePath = normalizePath(input.workspacePath, 'workspacePath')
  const openDocumentPaths = normalizeOpenPaths(input.openDocumentPaths ?? [])
  const openSet = new Set(openDocumentPaths)
  const activeDocumentPath = normalizeOptionalPath(
    input.activeDocumentPath,
    'activeDocumentPath',
  )
  const selectedWorkspacePath = normalizeOptionalPath(
    input.selectedWorkspacePath,
    'selectedWorkspacePath',
  )

  return Object.freeze({
    workspacePath,
    openDocumentPaths,
    activeDocumentPath:
      activeDocumentPath !== null && openSet.has(activeDocumentPath)
        ? activeDocumentPath
        : null,
    selectedWorkspacePath,
  })
}

const DEFAULT_RECOVERY_STATE = createState({ workspacePath: '' })

function decodeRecovery(
  raw: string | null,
  fallbackWorkspacePath: WorkspacePath,
): WorkspaceRecoveryState {
  if (raw === null) {
    return createState({ workspacePath: fallbackWorkspacePath })
  }

  try {
    const decoded: unknown = JSON.parse(raw)
    if (!isRecord(decoded) || decoded.version !== 1 || !isRecord(decoded.state)) {
      return createState({ workspacePath: fallbackWorkspacePath })
    }
    const state = decoded.state
    return createState({
      workspacePath: state.workspacePath as string,
      openDocumentPaths: state.openDocumentPaths as string[],
      activeDocumentPath: state.activeDocumentPath as string | null,
      selectedWorkspacePath: state.selectedWorkspacePath as string | null,
    })
  } catch {
    // Recovery metadata is disposable. Ignore corrupt data and start cleanly.
    return createState({ workspacePath: fallbackWorkspacePath })
  }
}

function encodeRecovery(state: WorkspaceRecoveryState): string {
  return JSON.stringify({ version: 1, state })
}

function isValidStoredRecovery(raw: string | null): boolean {
  if (raw === null) return false
  try {
    const decoded: unknown = JSON.parse(raw)
    if (!isRecord(decoded) || decoded.version !== 1 || !isRecord(decoded.state)) {
      return false
    }
    const state = decoded.state
    createState({
      workspacePath: state.workspacePath as string,
      openDocumentPaths: state.openDocumentPaths as string[],
      activeDocumentPath: state.activeDocumentPath as string | null,
      selectedWorkspacePath: state.selectedWorkspacePath as string | null,
    })
    return true
  } catch {
    return false
  }
}

function sameState(
  left: WorkspaceRecoveryState,
  right: WorkspaceRecoveryState,
): boolean {
  return (
    left.workspacePath === right.workspacePath &&
    left.activeDocumentPath === right.activeDocumentPath &&
    left.selectedWorkspacePath === right.selectedWorkspacePath &&
    left.openDocumentPaths.length === right.openDocumentPaths.length &&
    left.openDocumentPaths.every(
      (path, index) => path === right.openDocumentPaths[index],
    )
  )
}

/**
 * Persists only enough information to reopen a workspace session. Source text,
 * CM6 state, selection and Document revisions deliberately do not cross this
 * boundary; reopening always reads files into a fresh DocumentStore authority.
 */
export class WorkspaceRecoveryStore {
  private readonly storage: SettingsStoragePort

  private readonly storageKey: string

  private readonly listeners = new Set<WorkspaceRecoveryListener>()

  private storedState: boolean

  private snapshot: WorkspaceRecoveryState

  constructor(
    storage: SettingsStoragePort,
    options: WorkspaceRecoveryStoreOptions = {},
  ) {
    if (storage === null || typeof storage !== 'object') {
      throw new TypeError('Workspace recovery storage is required')
    }
    this.storage = storage
    this.storageKey = options.storageKey ?? WORKSPACE_RECOVERY_STORAGE_KEY
    if (
      typeof this.storageKey !== 'string' ||
      this.storageKey.trim().length === 0
    ) {
      throw new WorkspaceRecoveryValidationError(
        'Workspace recovery storage key must be non-empty',
      )
    }

    const fallbackWorkspacePath = normalizePath(
      options.workspacePath ?? '',
      'workspacePath',
    )
    const raw = this.storage.read(this.storageKey)
    this.storedState = isValidStoredRecovery(raw)
    this.snapshot = decodeRecovery(raw, fallbackWorkspacePath)
  }

  getSnapshot(): WorkspaceRecoveryState {
    return this.snapshot
  }

  /** Indicates whether startup found a valid previous session to restore. */
  hasStoredSession(): boolean {
    return this.storedState
  }

  /** True when the recorded session belongs to the supplied workspace root. */
  isForWorkspace(workspacePath: WorkspacePath | string): boolean {
    return this.snapshot.workspacePath === normalizePath(workspacePath, 'workspacePath')
  }

  subscribe(listener: WorkspaceRecoveryListener): WorkspaceRecoveryUnsubscribe {
    if (typeof listener !== 'function') {
      throw new TypeError('Workspace recovery listener must be a function')
    }
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  record(input: WorkspaceRecoveryInput): WorkspaceRecoveryState {
    if (!isRecord(input)) {
      throw new WorkspaceRecoveryValidationError(
        'Workspace recovery state must be an object',
      )
    }

    const next = createState({
      workspacePath: input.workspacePath,
      openDocumentPaths: input.openDocumentPaths ?? [],
      activeDocumentPath: input.activeDocumentPath,
      selectedWorkspacePath: input.selectedWorkspacePath,
    })
    if (sameState(next, this.snapshot)) return this.snapshot

    this.storage.write(this.storageKey, encodeRecovery(next))
    this.snapshot = next
    this.storedState = true
    this.notify()
    return next
  }

  clear(workspacePath: WorkspacePath | string = this.snapshot.workspacePath): WorkspaceRecoveryState {
    const next = createState({ workspacePath })
    if (sameState(next, this.snapshot)) return this.snapshot

    this.storage.write(this.storageKey, encodeRecovery(next))
    this.snapshot = next
    this.storedState = true
    this.notify()
    return next
  }

  /** Removes the durable session without changing the in-memory snapshot. */
  forget(): void {
    this.storage.remove(this.storageKey)
    this.storedState = false
  }

  /** Returns only valid file-like paths from a potentially stale recovery record. */
  validDocumentPaths(
    availablePaths: ReadonlySet<WorkspacePath>,
  ): readonly WorkspacePath[] {
    return Object.freeze(
      this.snapshot.openDocumentPaths.filter((path) => availablePaths.has(path)),
    )
  }

  /** Guards callers against accidentally treating a directory as a document. */
  static isDocumentPath(path: unknown): path is WorkspacePath {
    return isWorkspacePath(path) && path !== ''
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.snapshot)
      } catch {
        // Recovery observers are shell projections and cannot block writes.
      }
    }
  }
}

export { DEFAULT_RECOVERY_STATE }
