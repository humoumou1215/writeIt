import { markdown } from '@codemirror/lang-markdown'
import {
  Annotation,
  EditorState,
  type ChangeSpec,
  type Extension,
  type Transaction,
} from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import {
  createDocumentOrigin,
  createSourceChangeSet,
  DocumentNotFoundError,
  DocumentStore,
  type DocumentHistoryGroup,
  type DocumentStoreEvent,
  type ProjectionId,
  type SourceChangeSet,
} from '../../../core/document'
import type {
  DocumentLocator,
  DocumentOrigin,
  DocumentState,
  Revision,
} from '../../../core/document'
import { findReferenceFragmentPosition } from '../../../core/reference'
import {
  createProjectionMutationCapability,
  projectionMutationFacet,
  type ProjectionMutationCapability,
  type ProjectionMutationCapabilityController,
} from './mutation-capability'
import {
  projectMarkdownSource,
  projectSourceChangeToProjection,
  projectedChangesToSourceChangeSet,
  type MarkdownSourceProjection,
} from './source-fidelity'
import {
  containsLivePreviewExtension,
  createLivePreviewExtension,
  getPresentationMode,
  setPresentationMode as setViewPresentationMode,
  togglePresentationMode as toggleViewPresentationMode,
  DEFAULT_PRESENTATION_MODE,
  type PresentationMode,
} from '../extensions/live-preview'
import type { ImageProjectionRenderOptions } from '../../preview/image-projection'

export const DEFAULT_SINGLE_DOCUMENT_PROJECTION_ID: ProjectionId =
  'cm6-main-editor'

type StoreSyncToken = object

interface StoreSyncController {
  readonly token: StoreSyncToken
  readonly trustedTransactions: WeakSet<Transaction>
  allowNextTransaction: boolean
  expectedMarkdown?: string
}

/**
 * Marks a CM6 transaction that is applying an already-committed Store value.
 * The annotation type and per-projection token intentionally stay private to
 * this adapter. Public consumers can submit edits, but cannot authorize a
 * local document change as a Store replay.
 */
const storeSync = Annotation.define<StoreSyncToken>()

function createStoreSyncController(): StoreSyncController {
  return {
    token: Object.freeze({}),
    trustedTransactions: new WeakSet<Transaction>(),
    allowNextTransaction: false,
  }
}

function consumeAuthorizedStoreSync(
  transaction: Transaction,
  controller: StoreSyncController,
): boolean {
  const authorized =
    transaction.annotation(storeSync) === controller.token &&
    controller.trustedTransactions.has(transaction)
  if (authorized) controller.trustedTransactions.delete(transaction)
  return authorized
}

function createStoreSyncGuard(
  editable: boolean,
  controller: StoreSyncController,
): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged) return transaction

    if (
      transaction.annotation(storeSync) === controller.token &&
      controller.allowNextTransaction &&
      transaction.newDoc.toString() === controller.expectedMarkdown
    ) {
      controller.allowNextTransaction = false
      controller.expectedMarkdown = undefined
      controller.trustedTransactions.add(transaction)
      return transaction
    }

    // Editable transactions remain user intents and are routed through the
    // update listener. Read-only projections only accept the one authenticated
    // transaction currently authorized by the adapter.
    return editable ? transaction : []
  })
}

export interface SingleDocumentViewSurface {
  readonly state: EditorState
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  readonly scrollDOM: HTMLElement
  readonly hasFocus: boolean
  readonly presentationMode: PresentationMode
  focus(): void
  /** Moves the caret to a source-backed heading/object fragment when possible. */
  jumpToFragment(fragment: string): boolean
  /** Compatibility alias for navigation callers. */
  navigateToFragment(fragment: string): boolean
  /** Dispatches a source edit intent without exposing CM6 annotations. */
  dispatch(spec: SingleDocumentUserTransaction): void
  setPresentationMode(mode: PresentationMode): void
  togglePresentationMode(): PresentationMode
}

export interface SingleDocumentUserTransaction {
  readonly changes: ChangeSpec
}

export interface SingleDocumentViewOptions {
  readonly store: DocumentStore
  readonly locator: DocumentLocator
  readonly parent: HTMLElement
  readonly projectionId?: ProjectionId
  /** Additional editor extensions installed alongside the CM6 surface. */
  readonly extensions?: readonly Extension[]
  /** P2-01 defaults to read-only; P2-02 enables the Store-backed editor. */
  readonly editable?: boolean
  /** Presentation stays in the same CM6 document; source is the default. */
  readonly presentationMode?: PresentationMode
  /** Optional source-backed image projection settings for live presentation. */
  readonly imageProjection?: ImageProjectionRenderOptions
}

/**
 * Creates the CM6 state for the first editor surface.
 *
 * A read-only surface still accepts Store-originated transactions, but only
 * when the adapter has authorized that exact transaction. The sync
 * capability is deliberately not part of the public API.
 */
export function createSingleDocumentEditorState(
  markdownSource: string,
  extensions: readonly Extension[] = [],
  editable = false,
  presentationMode: PresentationMode = DEFAULT_PRESENTATION_MODE,
  mutationCapability?: ProjectionMutationCapability,
  imageProjection?: ImageProjectionRenderOptions,
): EditorState {
  return createSingleDocumentEditorStateWithController(
    projectMarkdownSource(markdownSource).projected,
    extensions,
    editable,
    createStoreSyncController(),
    presentationMode,
    mutationCapability,
    imageProjection,
  )
}

function createSingleDocumentEditorStateWithController(
  markdownSource: string,
  extensions: readonly Extension[],
  editable: boolean,
  controller: StoreSyncController,
  presentationMode: PresentationMode,
  mutationCapability?: ProjectionMutationCapability,
  imageProjection?: ImageProjectionRenderOptions,
): EditorState {
  if (typeof markdownSource !== 'string') {
    throw new TypeError('Editor document must be a string')
  }

  const authorityGuard: Extension[] = [
    createStoreSyncGuard(editable, controller),
  ]
  const projectionCapability = mutationCapability
    ? [projectionMutationFacet.of(mutationCapability)]
    : []
  const presentationExtension = containsLivePreviewExtension(extensions)
    ? []
    : createLivePreviewExtension({
        initialMode: presentationMode,
        ...(imageProjection ?? {}),
      })
  if (!editable) {
    authorityGuard.unshift(EditorState.readOnly.of(true))
  }

  return EditorState.create({
    doc: markdownSource,
    extensions: [
      markdown(),
      EditorView.lineWrapping,
      ...projectionCapability,
      ...extensions,
      presentationExtension,
      EditorView.editable.of(editable),
      ...authorityGuard,
    ],
  })
}

/**
 * One CM6 projection backed by one DocumentStore document.
 *
 * CM6 owns local selection/focus/editor state only. Source changes go through
 * DocumentStore, and Store-originated updates are annotated so they cannot
 * return through the user-transaction path as a synchronization loop.
 */
function createPublicEditorSurface(
  editorView: EditorView,
): SingleDocumentViewSurface {
  return Object.freeze({
    get state(): EditorState {
      return editorView.state
    },
    get dom(): HTMLElement {
      return editorView.dom
    },
    get contentDOM(): HTMLElement {
      return editorView.contentDOM
    },
    get scrollDOM(): HTMLElement {
      return editorView.scrollDOM
    },
    get hasFocus(): boolean {
      return editorView.hasFocus
    },
    get presentationMode(): PresentationMode {
      return getPresentationMode(editorView.state)
    },
    focus(): void {
      editorView.focus()
    },
    jumpToFragment(fragment: string): boolean {
      const position = findReferenceFragmentPosition(
        editorView.state.doc.toString(),
        fragment,
      )
      if (position === undefined) return false
      editorView.dispatch({
        selection: { anchor: position },
        scrollIntoView: true,
      })
      editorView.focus()
      return true
    },
    navigateToFragment(fragment: string): boolean {
      return this.jumpToFragment(fragment)
    },
    dispatch(spec: SingleDocumentUserTransaction): void {
      if (spec === null || typeof spec !== 'object') {
        throw new TypeError('Editor user transaction must be an object')
      }
      editorView.dispatch({ changes: spec.changes })
    },
    setPresentationMode(mode: PresentationMode): void {
      if (!setViewPresentationMode(editorView, mode)) {
        throw new Error('Live preview presentation extension is not installed')
      }
    },
    togglePresentationMode(): PresentationMode {
      if (!toggleViewPresentationMode(editorView)) {
        throw new Error('Live preview presentation extension is not installed')
      }
      return getPresentationMode(editorView.state)
    },
  })
}

export class SingleDocumentView {
  private destroyed = false

  private displayedRevisionValue: Revision

  private acknowledgedRevision: Revision | undefined

  private typingGroupId: string | undefined

  private typingGroupSequence = 0

  private sourceCommitInProgress = false

  /**
   * Maps the normalized CM6 text back to the current authoritative source.
   * This is refreshed on every Store revision, including revisions whose only
   * difference is line-ending encoding.
   */
  private sourceProjection: MarkdownSourceProjection

  readonly view: SingleDocumentViewSurface

  constructor(
    private readonly store: DocumentStore,
    readonly locator: DocumentLocator,
    readonly projectionId: ProjectionId,
    private readonly editorView: EditorView,
    readonly initialDocument: DocumentState,
    private readonly unsubscribe: () => void,
    private readonly origin: DocumentOrigin,
    private readonly editable: boolean,
    private readonly syncController: StoreSyncController,
    private readonly mutationCapabilityController: ProjectionMutationCapabilityController,
  ) {
    this.displayedRevisionValue = initialDocument.revision
    this.sourceProjection = projectMarkdownSource(initialDocument.markdown)
    this.view = createPublicEditorSurface(editorView)
  }

  /** Current presentation of the same CM6 document. */
  get presentationMode(): PresentationMode {
    return getPresentationMode(this.editorView.state)
  }

  jumpToFragment(fragment: string): boolean {
    if (this.destroyed) return false
    return this.view.jumpToFragment(fragment)
  }

  navigateToFragment(fragment: string): boolean {
    return this.jumpToFragment(fragment)
  }

  setPresentationMode(mode: PresentationMode): void {
    if (this.destroyed) return
    if (!setViewPresentationMode(this.editorView, mode)) {
      throw new Error('Live preview presentation extension is not installed')
    }
  }

  togglePresentationMode(): PresentationMode {
    if (this.destroyed) return this.presentationMode
    if (!toggleViewPresentationMode(this.editorView)) {
      throw new Error('Live preview presentation extension is not installed')
    }
    return this.presentationMode
  }

  /** Current authoritative document state, never the CM6 document. */
  get document(): DocumentState {
    const document = this.store.get(this.locator)
    if (!document) throw new DocumentNotFoundError(this.locator)
    return document
  }

  /** Highest revision this projection has applied and acknowledged. */
  get displayedRevision(): Revision {
    return this.displayedRevisionValue
  }

  get projectionState() {
    return this.store.getProjection(this.locator, this.projectionId)
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }

  /**
   * Called by the CM6 update listener. It is public only for the adapter
   * closure created by `mountSingleDocumentView`.
   */
  onViewUpdate(update: ViewUpdate): void {
    if (this.destroyed) return

    let hasUntrustedDocumentChange = false
    let hasAuthorizedDocumentChange = false
    for (const transaction of update.transactions) {
      if (!transaction.docChanged) continue
      if (consumeAuthorizedStoreSync(transaction, this.syncController)) {
        hasAuthorizedDocumentChange = true
      } else {
        hasUntrustedDocumentChange = true
      }
    }

    if (hasAuthorizedDocumentChange) this.typingGroupId = undefined
    if (!hasUntrustedDocumentChange) {
      if (!update.docChanged && update.selectionSet) {
        this.typingGroupId = undefined
      }
      this.ensureAuthoritativeSource()
      return
    }

    if (!this.editable) {
      this.typingGroupId = undefined
      this.ensureAuthoritativeSource()
      return
    }

    try {
      if (update.startState.doc.toString() !== this.sourceProjection.projected) {
        throw new Error(
          'CM6 transaction does not start from the mapped authoritative source',
        )
      }

      const sourceChange = projectedChangesToSourceChangeSet(
        this.sourceProjection,
        update.changes,
      )
      const historyGroup = this.historyGroupFor(update)
      this.sourceCommitInProgress = true
      let committed: DocumentState
      try {
        committed = this.store.applySourceChange(this.locator, {
          change: sourceChange,
          origin: this.origin,
          expectedRevision: this.displayedRevisionValue,
          ...(historyGroup === undefined ? {} : { historyGroup }),
        })
      } finally {
        this.sourceCommitInProgress = false
      }
      this.sourceProjection = projectMarkdownSource(committed.markdown)
    } catch (error) {
      this.typingGroupId = undefined
      this.recoverFromStore(error)
    }
  }

  /** Applies one committed Store event to this local projection. */
  onDocumentEvent(event: DocumentStoreEvent): void {
    if (this.destroyed || event.type !== 'changed') return
    // The originating editable projection already contains this transaction;
    // other projections must treat the Store replay as a typing boundary.
    const ownCommit =
      this.sourceCommitInProgress &&
      event.origin.kind === this.origin.kind &&
      event.origin.source === this.origin.source
    if (!ownCommit) this.typingGroupId = undefined

    if (event.document.revision < this.displayedRevisionValue) {
      this.markApplyFailure(
        new Error(
          `Received document revision ${event.document.revision} after ${this.displayedRevisionValue}`,
        ),
      )
      return
    }

    try {
      this.applyAuthoritativeDocument(event.document, event.change, ownCommit)
    } catch (error) {
      this.markApplyFailure(error)
    }
  }

  /**
   * Reconciles the projection with a fresh Store snapshot after the mount
   * window. Events that happened before the projection object existed are
   * buffered by the mount adapter; this final read also covers changes made
   * during attach itself, before the subscription could be registered.
   */
  reconcileToCurrentStore(): void {
    if (this.destroyed) return

    const current = this.store.get(this.locator)
    if (!current) {
      this.markApplyFailure(new DocumentNotFoundError(this.locator))
      return
    }

    if (current.revision < this.displayedRevisionValue) {
      this.markApplyFailure(
        new Error(
          `Store revision ${current.revision} is behind displayed revision ${this.displayedRevisionValue}`,
        ),
      )
      return
    }

    const currentProjection = projectMarkdownSource(current.markdown)
    if (
      current.revision === this.displayedRevisionValue &&
      this.editorView.state.doc.toString() === currentProjection.projected
    ) {
      this.sourceProjection = currentProjection
      try {
        this.acknowledgeProjection(current.revision)
      } catch (error) {
        this.markApplyFailure(error)
      }
      return
    }

    try {
      this.applyAuthoritativeDocument(current)
    } catch (error) {
      this.recoverFromStore(error)
    }
  }

  /**
   * Releases the CM6 view, subscription, and Store projection registration.
   * Repeated calls are safe so component lifecycle cleanup cannot double-run.
   */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.mutationCapabilityController.invalidate()
    this.unsubscribe()

    try {
      this.editorView.destroy()
    } finally {
      this.store.detachProjection(this.locator, this.projectionId)
    }
  }

  private ensureAuthoritativeSource(): void {
    const current = this.store.get(this.locator)
    if (!current) {
      this.markApplyFailure(new DocumentNotFoundError(this.locator))
      return
    }

    const currentProjection = projectMarkdownSource(current.markdown)
    if (this.editorView.state.doc.toString() === currentProjection.projected) {
      this.sourceProjection = currentProjection
      return
    }

    this.recoverFromStore(
      new Error('CM6 document change was not authorized by this adapter'),
    )
  }

  private applyAuthoritativeDocument(
    document: DocumentState,
    authoritativeChange?: SourceChangeSet,
    alreadyAppliedByThisProjection = false,
  ): void {
    const nextProjection = projectMarkdownSource(document.markdown)
    const previousProjection = this.sourceProjection
    const localMarkdown = this.editorView.state.doc.toString()
    if (
      localMarkdown !== previousProjection.projected &&
      !(alreadyAppliedByThisProjection &&
        localMarkdown === nextProjection.projected)
    ) {
      throw new Error(
        'CM6 projection is not at the expected source before Store fan-out',
      )
    }

    const projectedChange =
      authoritativeChange === undefined
        ? createSourceChangeSet(
            previousProjection.projected,
            nextProjection.projected,
          )
        : projectSourceChangeToProjection(
            previousProjection,
            nextProjection,
            authoritativeChange,
          ) ??
          createSourceChangeSet(
            previousProjection.projected,
            nextProjection.projected,
          )
    if (localMarkdown !== nextProjection.projected) {
      this.applyStoreSource(nextProjection.projected, projectedChange)
    }
    this.requireLocalSource(document.markdown)

    this.displayedRevisionValue = document.revision
    this.acknowledgeProjection(document.revision)
  }

  private historyGroupFor(
    update: ViewUpdate,
  ): DocumentHistoryGroup | undefined {
    const documentTransactions = update.transactions.filter(
      (transaction) => transaction.docChanged,
    )
    const typingTransaction = documentTransactions[0]
    if (
      documentTransactions.length !== 1 ||
      typingTransaction === undefined ||
      !typingTransaction.isUserEvent('input.type')
    ) {
      this.typingGroupId = undefined
      return undefined
    }

    const continuation = this.typingGroupId === undefined ? 'start' : 'continue'
    const groupId =
      this.typingGroupId ??
      `${this.projectionId}:typing:${++this.typingGroupSequence}`
    this.typingGroupId = groupId
    return Object.freeze({
      id: groupId,
      kind: 'typing' as const,
      continuation,
    })
  }

  private acknowledgeProjection(
    revision: Revision,
    force = false,
  ): void {
    if (!force && this.acknowledgedRevision === revision) return

    const previousRevision = this.acknowledgedRevision
    this.acknowledgedRevision = revision
    try {
      this.store.acknowledgeProjection(
        this.locator,
        this.projectionId,
        revision,
      )
    } catch (error) {
      // A lifecycle observer can synchronously advance the projection while
      // acknowledgement is being recorded. Do not roll that newer progress
      // back when the outer acknowledgement fails.
      if (this.acknowledgedRevision === revision) {
        this.acknowledgedRevision = previousRevision
      }
      throw error
    }
  }

  private applyStoreSource(
    markdownSource: string,
    projectedChange?: SourceChangeSet,
  ): void {
    const localMarkdown = this.editorView.state.doc.toString()
    if (localMarkdown === markdownSource) return

    const change =
      projectedChange ?? createSourceChangeSet(localMarkdown, markdownSource)
    if (change.sourceLength !== localMarkdown.length) {
      throw new Error('Projected Store change does not start at local source')
    }
    if (change.changes.length === 0) {
      throw new Error('Projected Store change is empty for different source')
    }

    this.syncController.allowNextTransaction = true
    this.syncController.expectedMarkdown = markdownSource
    try {
      this.editorView.dispatch({
        changes: change.changes.map((sourceChange) => ({
          from: sourceChange.from,
          to: sourceChange.to,
          insert: sourceChange.inserted,
        })),
        annotations: storeSync.of(this.syncController.token),
      })
    } finally {
      this.syncController.allowNextTransaction = false
      this.syncController.expectedMarkdown = undefined
    }
  }

  private recoverFromStore(error: unknown): void {
    const current = this.store.get(this.locator)
    if (!current) {
      this.markApplyFailure(error)
      return
    }

    try {
      this.store.markProjectionStale(
        this.locator,
        this.projectionId,
        current.revision,
        `source transaction rejected: ${String(error)}`,
      )
      const currentProjection = projectMarkdownSource(current.markdown)
      this.sourceProjection = currentProjection
      this.applyStoreSource(currentProjection.projected)
      this.requireLocalSource(current.markdown)
      this.displayedRevisionValue = current.revision
      this.acknowledgeProjection(current.revision, true)
    } catch (recoveryError) {
      this.markApplyFailure(recoveryError)
    }
  }

  private requireLocalSource(markdownSource: string): void {
    const projection = projectMarkdownSource(markdownSource)
    if (this.editorView.state.doc.toString() !== projection.projected) {
      throw new Error('CM6 projection did not apply authoritative source')
    }
    this.sourceProjection = projection
  }

  private markApplyFailure(error: unknown): void {
    try {
      this.store.markProjectionStale(
        this.locator,
        this.projectionId,
        String(error),
      )
    } catch {
      // The projection may already be detached during teardown.
    }
  }
}

/**
 * Mounts one CM6 EditorView from one authoritative DocumentStore snapshot.
 * The projection subscription is installed before CM6 construction. Events
 * observed before the projection object exists are buffered, then a fresh
 * Store snapshot closes the attach/construction window before acknowledgement.
 */
export function mountSingleDocumentView(
  options: SingleDocumentViewOptions,
): SingleDocumentView {
  const snapshot = options.store.get(options.locator)
  if (!snapshot) throw new DocumentNotFoundError(options.locator)
  if (!options.parent || typeof options.parent.appendChild !== 'function') {
    throw new TypeError('Editor parent must be a DOM element')
  }

  const projectionId =
    options.projectionId ?? DEFAULT_SINGLE_DOCUMENT_PROJECTION_ID
  const editable = options.editable ?? false
  const origin = createDocumentOrigin('editor', projectionId)
  const syncController = createStoreSyncController()
  let attached = false
  let view: EditorView | undefined
  const mutationCapabilityController = createProjectionMutationCapability({
    store: options.store,
    locator: options.locator,
    projectionId,
    editable,
    isEditable: () =>
      view !== undefined &&
      !view.state.readOnly &&
      view.state.facet(EditorView.editable),
  })
  let unsubscribe: (() => void) | undefined
  let projection: SingleDocumentView | undefined
  const projectionRef: { current?: SingleDocumentView } = {}
  const pendingEvents: DocumentStoreEvent[] = []
  const receiveEvent = (event: DocumentStoreEvent): void => {
    if (projectionRef.current) {
      projectionRef.current.onDocumentEvent(event)
    } else {
      pendingEvents.push(event)
    }
  }

  try {
    options.store.attachProjection(
      options.locator,
      projectionId,
      snapshot.revision,
    )
    attached = true

    // Subscribe before constructing CM6. Extension/plugin initialization can
    // synchronously commit through Store; those events wait for the local
    // projection and are replayed below.
    unsubscribe = options.store.subscribeProjection(
      options.locator,
      projectionId,
      receiveEvent,
    )

    const updateExtensions: Extension[] = [
      EditorView.updateListener.of((update) =>
        projectionRef.current?.onViewUpdate(update),
      ),
    ]
    view = new EditorView({
      state: createSingleDocumentEditorStateWithController(
        projectMarkdownSource(snapshot.markdown).projected,
        [...(options.extensions ?? []), ...updateExtensions],
        editable,
        syncController,
        options.presentationMode ?? DEFAULT_PRESENTATION_MODE,
        mutationCapabilityController.capability,
        options.imageProjection,
      ),
      parent: options.parent,
    })

    projection = new SingleDocumentView(
      options.store,
      options.locator,
      projectionId,
      view,
      snapshot,
      unsubscribe,
      origin,
      editable,
      syncController,
      mutationCapabilityController,
    )
    projectionRef.current = projection

    for (const event of pendingEvents.splice(0)) {
      projection.onDocumentEvent(event)
    }

    // This acknowledgement is deliberately based on the fresh Store state,
    // not the pre-mount snapshot. It also catches a source change made during
    // attach, before the subscription was able to observe it.
    projection.reconcileToCurrentStore()

    return projection
  } catch (error) {
    if (projection) {
      projection.destroy()
    } else {
      mutationCapabilityController.invalidate()
      unsubscribe?.()
      view?.destroy()
      if (attached) {
        options.store.detachProjection(options.locator, projectionId)
      }
    }
    throw error
  }
}
