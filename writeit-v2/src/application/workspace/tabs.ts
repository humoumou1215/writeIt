import { flattenWorkspaceTree } from '../../core/workspace'
import type { DocumentId } from '../../core/document'
import type { WorkspacePath, WorkspaceTree } from '../../core/workspace'

export interface WorkspaceTab {
  readonly documentId: DocumentId
}

export interface WorkspaceTabsSnapshot {
  readonly tabs: readonly WorkspaceTab[]
  readonly activeDocumentId: DocumentId | null
  /** Monotonic workspace-tab state generation. */
  readonly revision: number
}

export type WorkspaceTabsListener = (snapshot: WorkspaceTabsSnapshot) => void
export type WorkspaceTabsUnsubscribe = () => void

export class WorkspaceTabNotFoundError extends Error {
  readonly documentId: DocumentId

  constructor(documentId: DocumentId) {
    super(`Workspace tab is not open for document ${documentId}`)
    this.name = 'WorkspaceTabNotFoundError'
    this.documentId = documentId
  }
}

function requireDocumentId(documentId: DocumentId): DocumentId {
  if (typeof documentId !== 'string' || documentId.trim().length === 0) {
    throw new TypeError('Workspace tab document id must be non-empty')
  }
  return documentId
}

function createTab(documentId: DocumentId): WorkspaceTab {
  return Object.freeze({ documentId: requireDocumentId(documentId) })
}

function createSnapshot(
  tabs: readonly WorkspaceTab[],
  activeDocumentId: DocumentId | null,
  revision: number,
): WorkspaceTabsSnapshot {
  return Object.freeze({
    tabs: Object.freeze(tabs.map((tab) => createTab(tab.documentId))),
    activeDocumentId,
    revision,
  })
}

function requireDirection(direction: number): -1 | 1 {
  if (direction !== -1 && direction !== 1) {
    throw new RangeError('Workspace tab direction must be -1 or 1')
  }
  return direction
}

/**
 * Application-owned tab order and active-tab state.
 *
 * A tab stores only the stable DocumentId. Markdown, revision, dirty state,
 * and path are always read from DocumentStore by the caller, so this model
 * cannot become a second document authority.
 */
export class WorkspaceTabManager {
  private readonly listeners = new Set<WorkspaceTabsListener>()

  private snapshot: WorkspaceTabsSnapshot

  constructor(initialDocumentIds: readonly DocumentId[] = []) {
    if (!Array.isArray(initialDocumentIds)) {
      throw new TypeError('Initial workspace tabs must be an array')
    }

    const tabs: WorkspaceTab[] = []
    const seen = new Set<DocumentId>()
    for (const documentId of initialDocumentIds) {
      const normalized = requireDocumentId(documentId)
      if (seen.has(normalized)) {
        throw new TypeError(`Duplicate workspace tab document ${normalized}`)
      }
      seen.add(normalized)
      tabs.push(createTab(normalized))
    }

    this.snapshot = createSnapshot(tabs, tabs[0]?.documentId ?? null, 0)
  }

  getSnapshot(): WorkspaceTabsSnapshot {
    return this.snapshot
  }

  getActiveTab(): WorkspaceTab | undefined {
    const activeDocumentId = this.snapshot.activeDocumentId
    if (activeDocumentId === null) return undefined
    return this.snapshot.tabs.find(
      (tab) => tab.documentId === activeDocumentId,
    )
  }

  getTab(documentId: DocumentId): WorkspaceTab | undefined {
    const normalized = requireDocumentId(documentId)
    return this.snapshot.tabs.find((tab) => tab.documentId === normalized)
  }

  isOpen(documentId: DocumentId): boolean {
    return this.getTab(documentId) !== undefined
  }

  subscribe(listener: WorkspaceTabsListener): WorkspaceTabsUnsubscribe {
    if (typeof listener !== 'function') {
      throw new TypeError('Workspace tabs listener must be a function')
    }
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  /** Opens a document once and makes its tab active. */
  open(documentId: DocumentId): WorkspaceTabsSnapshot {
    const normalized = requireDocumentId(documentId)
    const existing = this.snapshot.tabs.some(
      (tab) => tab.documentId === normalized,
    )
    const nextTabs = existing
      ? this.snapshot.tabs
      : [...this.snapshot.tabs, createTab(normalized)]

    if (existing && this.snapshot.activeDocumentId === normalized) {
      return this.snapshot
    }

    return this.commit(nextTabs, normalized)
  }

  activate(documentId: DocumentId): WorkspaceTabsSnapshot {
    const normalized = requireDocumentId(documentId)
    if (!this.isOpen(normalized)) {
      throw new WorkspaceTabNotFoundError(normalized)
    }
    if (this.snapshot.activeDocumentId === normalized) return this.snapshot
    return this.commit(this.snapshot.tabs, normalized)
  }

  /**
   * Closes a tab after the application has performed any dirty-confirmation
   * policy. Closing a tab does not unload or mutate its DocumentStore state.
   */
  close(documentId: DocumentId): WorkspaceTabsSnapshot {
    const normalized = requireDocumentId(documentId)
    const index = this.snapshot.tabs.findIndex(
      (tab) => tab.documentId === normalized,
    )
    if (index < 0) throw new WorkspaceTabNotFoundError(normalized)

    const nextTabs = this.snapshot.tabs.filter(
      (tab) => tab.documentId !== normalized,
    )
    let nextActive = this.snapshot.activeDocumentId
    if (nextActive === normalized) {
      nextActive =
        nextTabs[index]?.documentId ??
        nextTabs[index - 1]?.documentId ??
        null
    }

    return this.commit(nextTabs, nextActive)
  }

  /** Returns the wrapped adjacent tab without changing active state. */
  getAdjacentTab(direction: -1 | 1): WorkspaceTab | undefined {
    const normalizedDirection = requireDirection(direction)
    const tabs = this.snapshot.tabs
    if (tabs.length === 0) return undefined

    const activeIndex = tabs.findIndex(
      (tab) => tab.documentId === this.snapshot.activeDocumentId,
    )
    const index =
      activeIndex < 0
        ? normalizedDirection === 1
          ? 0
          : tabs.length - 1
        : (activeIndex + normalizedDirection + tabs.length) % tabs.length
    return tabs[index]
  }

  /** Activates the wrapped next tab. */
  nextTab(): WorkspaceTabsSnapshot {
    const next = this.getAdjacentTab(1)
    return next ? this.activate(next.documentId) : this.snapshot
  }

  /** Activates the wrapped previous tab. */
  previousTab(): WorkspaceTabsSnapshot {
    const previous = this.getAdjacentTab(-1)
    return previous ? this.activate(previous.documentId) : this.snapshot
  }

  private commit(
    tabs: readonly WorkspaceTab[],
    activeDocumentId: DocumentId | null,
  ): WorkspaceTabsSnapshot {
    this.snapshot = createSnapshot(
      tabs,
      activeDocumentId,
      this.snapshot.revision + 1,
    )
    this.notify()
    return this.snapshot
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener(this.snapshot)
  }
}

/** Returns files in the same deterministic depth-first order as the tree. */
export function orderedWorkspaceFilePaths(
  tree: WorkspaceTree,
): readonly WorkspacePath[] {
  return Object.freeze(
    flattenWorkspaceTree(tree)
      .filter((entry) => entry.node.kind === 'file')
      .map((entry) => entry.node.path),
  )
}

/**
 * Finds the wrapped adjacent file in workspace tree order. If the current
 * path is not present, forward navigation starts at the first file and
 * backward navigation starts at the last file.
 */
export function adjacentWorkspaceFilePath(
  tree: WorkspaceTree,
  currentPath: WorkspacePath | undefined,
  direction: -1 | 1,
): WorkspacePath | undefined {
  const normalizedDirection = requireDirection(direction)
  const files = orderedWorkspaceFilePaths(tree)
  if (files.length === 0) return undefined

  const currentIndex =
    currentPath === undefined ? -1 : files.indexOf(currentPath)
  const index =
    currentIndex < 0
      ? normalizedDirection === 1
        ? 0
        : files.length - 1
      : (currentIndex + normalizedDirection + files.length) % files.length
  return files[index]
}
