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
  DocumentNotFoundError,
  DocumentStore,
  type DocumentStoreEvent,
  type ProjectionId,
} from '../../../core/document'
import type {
  DocumentLocator,
  DocumentOrigin,
  DocumentState,
  Revision,
} from '../../../core/document'
import {
  containsLivePreviewExtension,
  createLivePreviewExtension,
  getPresentationMode,
  setPresentationMode as setViewPresentationMode,
  togglePresentationMode as toggleViewPresentationMode,
  DEFAULT_PRESENTATION_MODE,
  type PresentationMode,
} from '../extensions/live-preview'

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
): EditorState {
  return createSingleDocumentEditorStateWithController(
    markdownSource,
    extensions,
    editable,
    createStoreSyncController(),
    presentationMode,
  )
}

function createSingleDocumentEditorStateWithController(
  markdownSource: string,
  extensions: readonly Extension[],
  editable: boolean,
  controller: StoreSyncController,
  presentationMode: PresentationMode,
): EditorState {
  if (typeof markdownSource !== 'string') {
    throw new TypeError('Editor document must be a string')
  }

  const authorityGuard: Extension[] = [
    createStoreSyncGuard(editable, controller),
  ]
  const presentationExtension = containsLivePreviewExtension(extensions)
    ? []
    : createLivePreviewExtension({ initialMode: presentationMode })
  if (!editable) {
    authorityGuard.unshift(EditorState.readOnly.of(true))
  }

  return EditorState.create({
    doc: markdownSource,
    extensions: [
      markdown(),
      EditorView.lineWrapping,
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
  ) {
    this.displayedRevisionValue = initialDocument.revision
    this.view = createPublicEditorSurface(editorView)
  }

  /** Current presentation of the same CM6 document. */
  get presentationMode(): PresentationMode {
    return getPresentationMode(this.editorView.state)
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
    if (this.destroyed || !update.docChanged) return
    let hasUntrustedDocumentChange = false
    for (const transaction of update.transactions) {
      if (
        transaction.docChanged &&
        !consumeAuthorizedStoreSync(transaction, this.syncController)
      ) {
        hasUntrustedDocumentChange = true
      }
    }
    if (!hasUntrustedDocumentChange) {
      this.ensureAuthoritativeSource()
      return
    }

    if (!this.editable) {
      this.ensureAuthoritativeSource()
      return
    }

    try {
      this.store.applyChange(this.locator, {
        markdown: update.state.doc.toString(),
        origin: this.origin,
        expectedRevision: this.displayedRevisionValue,
      })
    } catch (error) {
      this.recoverFromStore(error)
    }
  }

  /** Applies one committed Store event to this local projection. */
  onDocumentEvent(event: DocumentStoreEvent): void {
    if (this.destroyed || event.type !== 'changed') return

    if (event.document.revision < this.displayedRevisionValue) {
      this.markApplyFailure(
        new Error(
          `Received document revision ${event.document.revision} after ${this.displayedRevisionValue}`,
        ),
      )
      return
    }

    try {
      this.applyAuthoritativeDocument(event.document)
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

    if (
      current.revision === this.displayedRevisionValue &&
      this.editorView.state.doc.toString() === current.markdown
    ) {
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

    if (this.editorView.state.doc.toString() === current.markdown) return

    this.recoverFromStore(
      new Error('CM6 document change was not authorized by this adapter'),
    )
  }

  private applyAuthoritativeDocument(document: DocumentState): void {
    const localMarkdown = this.editorView.state.doc.toString()
    if (localMarkdown !== document.markdown) {
      this.applyStoreSource(document.markdown)
    }
    this.requireLocalSource(document.markdown)

    this.displayedRevisionValue = document.revision
    this.acknowledgeProjection(document.revision)
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

  private applyStoreSource(markdownSource: string): void {
    const localMarkdown = this.editorView.state.doc.toString()
    if (localMarkdown === markdownSource) return

    this.syncController.allowNextTransaction = true
    this.syncController.expectedMarkdown = markdownSource
    try {
      this.editorView.dispatch({
        changes: {
          from: 0,
          to: localMarkdown.length,
          insert: markdownSource,
        },
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
      this.applyStoreSource(current.markdown)
      this.requireLocalSource(current.markdown)
      this.displayedRevisionValue = current.revision
      this.acknowledgeProjection(current.revision, true)
    } catch (recoveryError) {
      this.markApplyFailure(recoveryError)
    }
  }

  private requireLocalSource(markdownSource: string): void {
    if (this.editorView.state.doc.toString() !== markdownSource) {
      throw new Error('CM6 projection did not apply authoritative source')
    }
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
        snapshot.markdown,
        [...(options.extensions ?? []), ...updateExtensions],
        editable,
        syncController,
        options.presentationMode ?? DEFAULT_PRESENTATION_MODE,
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
      unsubscribe?.()
      view?.destroy()
      if (attached) {
        options.store.detachProjection(options.locator, projectionId)
      }
    }
    throw error
  }
}
