import {
  StateEffect,
  type Extension,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import {
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  documentByPath,
  DocumentStore,
  isDocumentLocator,
} from '../../../core/document'
import type {
  DocumentLocator,
  DocumentState,
  DocumentPath,
} from '../../../core/document'
import {
  parseReferences,
  resolveReference,
} from '../../../core/reference'
import type { ParsedReference } from '../../../core/reference'
import {
  getPresentationMode,
} from './live-preview'
import {
  mountSingleDocumentView,
} from '../projection/single-document-view'
import type {
  SingleDocumentView,
} from '../projection/single-document-view'

/** A target can be known before its DocumentStore state has been loaded. */
export interface EmbedProjectionTarget {
  readonly locator?: DocumentLocator
  readonly path?: DocumentPath | string
}

export interface EmbedProjectionResolutionContext {
  readonly host: DocumentState
  /** Stable document/path keys already visited by this projection chain. */
  readonly stack: readonly string[]
}

export type EmbedProjectionTargetResult =
  | DocumentLocator
  | EmbedProjectionTarget
  | undefined

export type EmbedProjectionTargetResolver = (
  reference: ParsedReference,
  context: EmbedProjectionResolutionContext,
) => EmbedProjectionTargetResult

export interface StoreEmbedTargetResolverOptions {
  /** Paths from the workspace tree, including files not loaded in the Store. */
  readonly getAvailablePaths?: () => readonly (DocumentPath | string)[]
  readonly extensions?: readonly string[]
}

export interface EmbedProjectionMissingTargetContext
  extends EmbedProjectionResolutionContext {
  readonly reference: ParsedReference
  readonly path?: DocumentPath
}

export interface EmbedProjectionExtensionOptions {
  readonly store: DocumentStore
  /** The host Document whose embed tokens are being projected. */
  readonly locator: DocumentLocator
  readonly targetResolver?: EmbedProjectionTargetResolver
  readonly getAvailablePaths?: () => readonly (DocumentPath | string)[]
  readonly referenceExtensions?: readonly string[]
  /** Loads an unopened target and resolves when a later refresh can mount it. */
  readonly onTargetMissing?: (
    context: EmbedProjectionMissingTargetContext,
  ) => void | PromiseLike<void>
  /** Invalidates target resolution without changing Markdown. */
  readonly subscribeTargets?: (listener: () => void) => () => void
  /** Readonly is also enforced by the CM6 host state. */
  readonly editable?: boolean
  /** Internal chain state; callers normally leave this unset. */
  readonly stack?: readonly string[]
  readonly depth?: number
  /** Prefix used to give every nested projection a unique Store identity. */
  readonly hostProjectionId?: string
  /** Focuses the parent projection when Escape is pressed in this child. */
  readonly hostFocus?: () => void
  readonly maxDepth?: number
}

interface NormalizedTarget {
  readonly locator?: DocumentLocator
  readonly path?: DocumentPath
  readonly document?: DocumentState
  readonly keys: readonly string[]
  readonly key: string
}

interface EmbedRenderTarget {
  readonly target?: NormalizedTarget
  readonly error?: string
}

const refreshEmbedProjectionEffect = StateEffect.define<number>()
const EMBED_WIDGET_SELECTOR = '[data-writeit-embed]'
const DEFAULT_MAX_EMBED_DEPTH = 24
let hostSequence = 0

function errorText(error: unknown): string {
  try {
    const value = String(error)
    return value.length > 0 ? value : 'Embed target resolution failed'
  } catch {
    return 'Embed target resolution failed'
  }
}

function pathKey(path: DocumentPath): string {
  return `path:${path}`
}

function idKey(id: string): string {
  return `id:${id}`
}

function documentKeys(document: DocumentState): readonly string[] {
  return Object.freeze([idKey(document.id), pathKey(document.path)])
}

function normalizePath(value: unknown): DocumentPath | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  try {
    return createDocumentPath(value)
  } catch {
    return undefined
  }
}

function normalizeTargetResult(
  store: DocumentStore,
  result: EmbedProjectionTargetResult,
): NormalizedTarget | undefined {
  if (result === undefined) return undefined

  let locator: DocumentLocator | undefined
  let path: DocumentPath | undefined
  if (isDocumentLocator(result)) {
    locator = result
  } else if (result !== null && typeof result === 'object') {
    if (result.locator !== undefined) {
      if (!isDocumentLocator(result.locator)) return undefined
      locator = result.locator
    }
    path = normalizePath(result.path)
  } else {
    return undefined
  }

  if (locator?.kind === 'path') path ??= normalizePath(locator.path)

  let document: DocumentState | undefined
  try {
    document = locator === undefined
      ? path === undefined
        ? undefined
        : store.get(documentByPath(path))
      : store.get(locator)
  } catch {
    document = undefined
  }

  if (document) {
    locator = documentById(document.id)
    path = document.path
  }

  if (path === undefined && locator?.kind === 'id' && document === undefined) {
    const key = idKey(locator.id)
    return { locator, keys: Object.freeze([key]), key }
  }

  if (path === undefined && document === undefined) return undefined

  const keys = document
    ? documentKeys(document)
    : Object.freeze([pathKey(path as DocumentPath)])
  return {
    ...(locator === undefined ? {} : { locator }),
    ...(path === undefined ? {} : { path }),
    ...(document === undefined ? {} : { document }),
    keys,
    key: keys[0] as string,
  }
}

function targetPath(target: NormalizedTarget | undefined): DocumentPath | undefined {
  if (target?.path !== undefined) return target.path
  return target?.document?.path
}

function normalizeAvailablePaths(
  store: DocumentStore,
  getAvailablePaths: (() => readonly (DocumentPath | string)[]) | undefined,
): readonly string[] {
  const paths = new Set<string>()
  for (const document of store.getAll()) paths.add(document.path)
  if (getAvailablePaths) {
    try {
      for (const path of getAvailablePaths()) {
        if (typeof path === 'string' && path.trim().length > 0) paths.add(path)
      }
    } catch {
      // A workspace catalog failure is a missing/degraded projection, not a
      // reason to replace or mutate the host Markdown.
    }
  }
  return [...paths]
}

/**
 * Resolves embed paths against loaded Documents and an optional workspace
 * catalog. It returns a path even when the target is not loaded, allowing the
 * application layer to load it without making the editor a filesystem owner.
 */
export function createDocumentStoreEmbedTargetResolver(
  store: DocumentStore,
  options: StoreEmbedTargetResolverOptions = {},
): EmbedProjectionTargetResolver {
  return (reference, context) => {
    if (reference.kind !== 'embed') return undefined
    const availablePaths = normalizeAvailablePaths(store, options.getAvailablePaths)
    try {
      const resolution = resolveReference(reference, availablePaths, {
        extensions: options.extensions,
        hostPath: context.host.path,
      })
      if (resolution.status !== 'resolved' || resolution.resolvedPath === undefined) {
        return undefined
      }
      const path = createDocumentPath(resolution.resolvedPath)
      const document = store.get(documentByPath(path))
      return {
        path,
        ...(document === undefined
          ? {}
          : { locator: documentById(document.id) }),
      }
    } catch {
      return undefined
    }
  }
}

function normalizeResolver(
  store: DocumentStore,
  options: EmbedProjectionExtensionOptions,
): EmbedProjectionTargetResolver {
  return options.targetResolver ?? createDocumentStoreEmbedTargetResolver(store, {
    getAvailablePaths: options.getAvailablePaths,
    extensions: options.referenceExtensions,
  })
}

function isCircular(
  target: NormalizedTarget,
  stack: readonly string[],
): boolean {
  return target.keys.some((key) => stack.includes(key))
}

function displayTarget(target: NormalizedTarget | undefined, reference: ParsedReference): string {
  return targetPath(target) ?? reference.path
}

function documentForTarget(
  store: DocumentStore,
  target: NormalizedTarget,
): DocumentState | undefined {
  if (target.document) return target.document
  if (!target.locator) return undefined
  try {
    return store.get(target.locator)
  } catch {
    return undefined
  }
}

function safeProjectionPart(value: string): string {
  return encodeURIComponent(value).replaceAll('%', '_')
}

function createChildProjectionId(
  hostProjectionId: string,
  from: number,
  to: number,
  target: string,
): string {
  return `${hostProjectionId}/embed-${from}-${to}-${safeProjectionPart(target)}`
}

function modeLabel(readonly: boolean): string {
  return readonly ? 'Readonly embed' : 'Editable embed'
}

function setStateDataset(
  element: HTMLElement,
  state: ReturnType<DocumentStore['getProjection']> | undefined,
): void {
  if (!state) return
  element.dataset.embedRevision = String(state.revision)
  element.dataset.embedStale = String(state.stale)
  element.dataset.embedDegraded = String(state.degraded)
  if (state.degradedReason !== undefined) {
    element.dataset.embedDegradedReason = state.degradedReason
  } else {
    delete element.dataset.embedDegradedReason
  }
}

class EmbedProjectionWidget extends WidgetType {
  private child: SingleDocumentView | undefined
  private wrapper: HTMLDivElement | undefined
  private mount: HTMLDivElement | undefined
  private unsubscribeDocument: (() => void) | undefined
  private unsubscribeTimeline: (() => void) | undefined

  constructor(
    private readonly store: DocumentStore,
    private readonly hostProjectionId: string,
    private readonly reference: ParsedReference,
    private readonly renderTarget: EmbedRenderTarget,
    private readonly stack: readonly string[],
    private readonly depth: number,
    private readonly canEdit: boolean,
    private readonly maxDepth: number,
    private readonly options: EmbedProjectionExtensionOptions,
  ) {
    super()
  }

  eq(other: EmbedProjectionWidget): boolean {
    return (
      other instanceof EmbedProjectionWidget &&
      other.reference.raw === this.reference.raw &&
      other.reference.readonly === this.reference.readonly &&
      other.renderTarget.target?.key === this.renderTarget.target?.key &&
      other.renderTarget.error === this.renderTarget.error &&
      other.stack.join('\u0000') === this.stack.join('\u0000') &&
      other.canEdit === this.canEdit
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-writeit-embed-projection'
    wrapper.dataset.writeitEmbed = 'true'
    wrapper.dataset.embedTarget = displayTarget(this.renderTarget.target, this.reference)
    wrapper.dataset.embedMode = this.reference.readonly ? 'readonly' : 'editable'
    wrapper.dataset.embedDepth = String(this.depth)
    wrapper.setAttribute('aria-label', `${modeLabel(this.reference.readonly)} ${wrapper.dataset.embedTarget}`)
    this.wrapper = wrapper

    const label = document.createElement('div')
    label.className = 'cm-writeit-embed-projection__label'
    label.dataset.embedLabel = 'true'
    label.textContent = `${modeLabel(this.reference.readonly)} · ${wrapper.dataset.embedTarget}`
    wrapper.append(label)

    const target = this.renderTarget.target
    if (this.renderTarget.error !== undefined) {
      this.appendMessage(wrapper, 'error', `Embed unavailable: ${this.renderTarget.error}`)
      return wrapper
    }
    if (!target) {
      wrapper.dataset.embedStatus = 'missing'
      this.appendMessage(wrapper, 'missing', `Missing embed target: ${this.reference.path}`)
      return wrapper
    }
    if (isCircular(target, this.stack)) {
      wrapper.dataset.embedStatus = 'circular'
      this.appendMessage(
        wrapper,
        'circular',
        `Circular embed: ${[...this.stack, ...target.keys].join(' → ')}`,
      )
      return wrapper
    }
    if (this.depth >= this.maxDepth) {
      wrapper.dataset.embedStatus = 'depth-limited'
      this.appendMessage(wrapper, 'depth-limited', `Embed nesting limit reached at ${displayTarget(target, this.reference)}`)
      return wrapper
    }

    const targetDocument = documentForTarget(this.store, target)
    if (!targetDocument) {
      wrapper.dataset.embedStatus = 'unloaded'
      this.appendMessage(wrapper, 'unloaded', `Target is not loaded: ${displayTarget(target, this.reference)}`)
      return wrapper
    }

    const locator = documentById(targetDocument.id)
    const childId = createChildProjectionId(
      this.hostProjectionId,
      this.reference.from,
      this.reference.to,
      target.key,
    )
    const childMount = document.createElement('div')
    childMount.className = 'cm-writeit-embed-projection__editor'
    childMount.dataset.embedEditor = 'true'
    childMount.dataset.embedProjectionId = childId
    childMount.dataset.embedDocumentId = targetDocument.id
    childMount.dataset.embedDocumentPath = targetDocument.path
    childMount.dataset.embedMode = this.reference.readonly ? 'readonly' : 'editable'
    wrapper.dataset.embedStatus = 'mounted'
    wrapper.dataset.embedProjectionId = childId
    wrapper.append(childMount)
    this.mount = childMount

    const childEditable = this.canEdit && !this.reference.readonly
    const childExtensions: Extension[] = [
      createEmbedProjectionExtension({
        ...this.options,
        locator,
        editable: childEditable,
        stack: Object.freeze([...this.stack, ...target.keys]),
        depth: this.depth + 1,
        hostProjectionId: childId,
        hostFocus: () => view.focus(),
      }),
      keymap.of([
        {
          key: 'Mod-z',
          run: () => this.undoChild(locator, childId, childEditable),
        },
        {
          key: 'Mod-y',
          run: () => this.redoChild(locator, childId, childEditable),
        },
        {
          key: 'Mod-Shift-z',
          run: () => this.redoChild(locator, childId, childEditable),
        },
      ]),
    ]

    try {
      this.child = mountSingleDocumentView({
        store: this.store,
        locator,
        parent: childMount,
        projectionId: childId,
        editable: childEditable,
        presentationMode: 'live-preview',
        extensions: childExtensions,
      })
      this.subscribeChildState(locator, childId, childMount)
      this.renderChildState()
    } catch (error) {
      wrapper.dataset.embedStatus = 'error'
      childMount.replaceChildren()
      this.appendMessage(wrapper, 'error', `Embed could not be mounted: ${errorText(error)}`)
    }

    return wrapper
  }

  destroy(): void {
    this.unsubscribeDocument?.()
    this.unsubscribeTimeline?.()
    this.unsubscribeDocument = undefined
    this.unsubscribeTimeline = undefined
    this.child?.destroy()
    this.child = undefined
    this.mount = undefined
    this.wrapper = undefined
  }

  ignoreEvent(): boolean {
    return true
  }

  private appendMessage(
    wrapper: HTMLDivElement,
    status: string,
    message: string,
  ): void {
    wrapper.dataset.embedStatus = status
    const element = wrapper.ownerDocument.createElement('div')
    element.className = `cm-writeit-embed-projection__message cm-writeit-embed-projection__message--${status}`
    element.dataset.embedMessage = status
    element.textContent = message
    wrapper.append(element)
  }

  private subscribeChildState(
    locator: DocumentLocator,
    projectionId: string,
    mount: HTMLDivElement,
  ): void {
    this.unsubscribeDocument = this.store.subscribe(locator, () => {
      this.renderChildState()
    })
    this.unsubscribeTimeline = this.store.subscribeTimeline((event) => {
      if (
        'projectionId' in event &&
        event.documentId === this.child?.document.id &&
        event.projectionId === projectionId
      ) {
        this.renderChildState()
      }
    })
    mount.dataset.embedProjectionId = projectionId
  }

  private renderChildState(): void {
    if (!this.mount || !this.child) return
    try {
      const state = this.store.getProjection(
        documentById(this.child.document.id),
        this.child.projectionId,
      )
      setStateDataset(this.mount, state)
      if (this.wrapper) setStateDataset(this.wrapper, state)
    } catch {
      this.mount.dataset.embedStatus = 'detached'
      if (this.wrapper) this.wrapper.dataset.embedStatus = 'detached'
    }
  }

  private undoChild(
    locator: DocumentLocator,
    projectionId: string,
    editable: boolean,
  ): boolean {
    if (!editable) return false
    this.store.undo(locator, createDocumentOrigin('embed-undo', projectionId))
    return true
  }

  private redoChild(
    locator: DocumentLocator,
    projectionId: string,
    editable: boolean,
  ): boolean {
    if (!editable) return false
    this.store.redo(locator, createDocumentOrigin('embed-redo', projectionId))
    return true
  }
}

/**
 * CM6 Embed projection controller. Embed widgets own only child editor
 * lifecycle; all child source edits still go through the target DocumentStore
 * projection and therefore fan out to every other target projection.
 */
export class EmbedProjectionController {
  decorations: DecorationSet = Decoration.none

  private readonly resolver: EmbedProjectionTargetResolver
  private readonly unsubscribeTargets: (() => void) | undefined
  private readonly hostProjectionId: string
  private readonly stack: readonly string[]
  private readonly depth: number
  private readonly maxDepth: number
  private readonly canEdit: boolean
  private readonly missingRequests = new Set<string>()
  private refreshSequence = 0
  private mode
  private destroyed = false

  constructor(
    private readonly view: EditorView,
    private readonly options: EmbedProjectionExtensionOptions,
  ) {
    this.resolver = normalizeResolver(options.store, options)
    this.hostProjectionId = options.hostProjectionId ?? `embed-host-${++hostSequence}`
    this.depth = options.depth ?? 0
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_EMBED_DEPTH
    this.canEdit = (options.editable ?? view.state.facet(EditorView.editable)) && !view.state.readOnly

    const host = options.store.get(options.locator)
    this.stack = Object.freeze(
      options.stack && options.stack.length > 0
        ? [...options.stack]
        : host
          ? [...documentKeys(host)]
          : [],
    )
    try {
      this.unsubscribeTargets = options.subscribeTargets?.(() => this.requestRefresh())
    } catch {
      this.unsubscribeTargets = undefined
      view.dom.dataset.embedTargetError = 'Embed target subscription failed'
    }
    this.mode = getPresentationMode(view.state)
    this.refresh()
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }

  update(update: ViewUpdate): void {
    if (this.destroyed) return
    let refreshRequested = false
    for (const transaction of update.transactions) {
      if (transaction.docChanged) refreshRequested = true
      for (const effect of transaction.effects) {
        if (effect.is(refreshEmbedProjectionEffect)) refreshRequested = true
      }
    }
    const nextMode = getPresentationMode(update.state)
    if (nextMode !== this.mode) {
      this.mode = nextMode
      refreshRequested = true
    }
    if (refreshRequested) this.refresh()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.unsubscribeTargets?.()
    this.missingRequests.clear()
    delete this.view.dom.dataset.embedTargetError
    delete this.view.dom.dataset.embedCount
  }

  private refresh(): void {
    if (this.destroyed) return
    const source = this.view.state.doc.toString()
    const host = this.options.store.get(this.options.locator)
    if (this.mode !== 'live-preview' || !host) {
      this.decorations = Decoration.none
      this.view.dom.dataset.embedCount = '0'
      return
    }

    const ranges = [] as Array<{
      readonly from: number
      readonly to: number
      readonly decoration: Decoration
    }>
    for (const reference of parseEmbedReferences(source)) {
      if (source.slice(reference.from, reference.to) !== reference.raw) continue
      const rendered = this.resolveRenderTarget(reference, host)
      if (rendered.target && !isCircular(rendered.target, this.stack)) {
        // The target may be unloaded; the application callback gets one
        // source-backed opportunity to load it without changing the host.
        if (!rendered.target.document) this.requestMissingTarget(reference, host, rendered.target)
      } else if (!rendered.target) {
        this.requestMissingTarget(reference, host, undefined)
      }
      ranges.push({
        from: reference.from,
        to: reference.to,
        decoration: Decoration.replace({
          widget: new EmbedProjectionWidget(
            this.options.store,
            this.hostProjectionId,
            reference,
            rendered,
            this.stack,
            this.depth,
            this.canEdit,
            this.maxDepth,
            this.options,
          ),
        }),
      })
    }
    this.decorations = ranges.length === 0
      ? Decoration.none
      : Decoration.set(
          ranges.map((range) => range.decoration.range(range.from, range.to)),
          true,
        )
    this.view.dom.dataset.embedCount = String(ranges.length)
  }

  private resolveRenderTarget(
    reference: ParsedReference,
    host: DocumentState,
  ): EmbedRenderTarget {
    try {
      const result = this.resolver(reference, {
        host,
        stack: this.stack,
      })
      const normalized = normalizeTargetResult(this.options.store, result)
      return normalized === undefined ? {} : { target: normalized }
    } catch (error) {
      return { error: errorText(error) }
    }
  }

  private requestMissingTarget(
    reference: ParsedReference,
    host: DocumentState,
    target: NormalizedTarget | undefined,
  ): void {
    const loader = this.options.onTargetMissing
    if (!loader) return
    const path = targetPath(target)
    const key = `${host.id}:${reference.from}:${reference.to}:${path ?? reference.path}`
    if (this.missingRequests.has(key)) return
    this.missingRequests.add(key)
    let result: void | PromiseLike<void>
    try {
      result = loader({
        host,
        reference,
        stack: this.stack,
        ...(path === undefined ? {} : { path }),
      })
    } catch (error) {
      this.view.dom.dataset.embedTargetError = errorText(error)
      return
    }
    void Promise.resolve(result).then(
      () => this.requestRefresh(),
      (error: unknown) => {
        if (!this.destroyed) this.view.dom.dataset.embedTargetError = errorText(error)
      },
    )
  }

  private requestRefresh(): void {
    if (this.destroyed) return
    this.refreshSequence += 1
    this.view.dispatch({ effects: refreshEmbedProjectionEffect.of(this.refreshSequence) })
  }
}

function parseEmbedReferences(source: string): readonly ParsedReference[] {
  // The shared parser excludes fenced and inline code, so embed replacement
  // cannot invent a projection for an example token in Markdown source.
  return parseReferences(source).filter((reference) => reference.kind === 'embed')
}

/** Installs source-backed editable/read-only nested embed projections. */
export function createEmbedProjectionExtension(
  options: EmbedProjectionExtensionOptions,
): Extension {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('Embed projection options are required')
  }
  if (!(options.store instanceof DocumentStore)) {
    throw new TypeError('Embed projection requires a DocumentStore')
  }
  if (!isDocumentLocator(options.locator)) {
    throw new TypeError('Embed projection requires a document locator')
  }
  if (options.maxDepth !== undefined &&
      (!Number.isSafeInteger(options.maxDepth) || options.maxDepth < 1)) {
    throw new RangeError('Embed projection maxDepth must be a positive integer')
  }

  const extension: Extension[] = [
    ViewPlugin.define(
      (view) => new EmbedProjectionController(view, options),
      { decorations: (controller) => controller.decorations },
    ),
  ]
  if (options.hostFocus) {
    extension.push(
      keymap.of([
        {
          key: 'Escape',
          run: () => {
            options.hostFocus?.()
            return true
          },
        },
      ]),
    )
  }
  return extension
}

export interface EmbedProjectionSurface {
  readonly isDestroyed: boolean
  destroy(): void
}

/** Selector kept public for browser adapters and diagnostics probes. */
export const EMBED_PROJECTION_SELECTOR = EMBED_WIDGET_SELECTOR
