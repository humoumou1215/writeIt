import {
  DocumentNotFoundError,
  DocumentStore,
  type DocumentStoreEvent,
  type ProjectionId,
} from '../../core/document'
import type {
  DocumentLocator,
  DocumentState,
  Revision,
} from '../../core/document'
import {
  mimeTypeForImagePath,
  resolveWorkspaceImagePath,
  type ImageProjectionRenderOptions,
  type ImageProjectionResource,
} from './image-projection'

export const DEFAULT_LIVE_PREVIEW_PROJECTION_ID: ProjectionId = 'live-preview'

export type BasicLivePreviewRenderMode =
  | 'rich'
  | 'source-fallback'
  | 'unavailable'

export type BasicLivePreviewRenderer = (
  parent: HTMLElement,
  markdownSource: string,
  options?: ImageProjectionRenderOptions,
) => void

export interface BasicLivePreviewOptions extends ImageProjectionRenderOptions {
  readonly store: DocumentStore
  readonly locator: DocumentLocator
  readonly parent: HTMLElement
  readonly projectionId?: ProjectionId
  /** Injectable renderer used by deterministic renderer-failure tests. */
  readonly renderer?: BasicLivePreviewRenderer
}

const DEFAULT_RENDER_FAILURE = 'Live preview renderer failed'

function formatPreviewError(error: unknown): string {
  try {
    const formatted = String(error)
    return formatted.length > 0 ? formatted : DEFAULT_RENDER_FAILURE
  } catch {
    return `${DEFAULT_RENDER_FAILURE} (unformattable error)`
  }
}

function combinePreviewErrors(
  renderError: unknown,
  fallbackError: unknown,
): string {
  return `rich render failed: ${formatPreviewError(renderError)}; source fallback failed: ${formatPreviewError(fallbackError)}`
}

function setPreviewRenderMode(
  parent: HTMLElement,
  mode: BasicLivePreviewRenderMode,
): void {
  parent.dataset.previewMode = mode
  parent.dataset.previewDegraded = mode === 'rich' ? 'false' : 'true'
}

/**
 * Renders the deliberately small P2-06 Markdown subset without using
 * `innerHTML`. Unrecognized syntax is emitted as text, while the source
 * remains owned by DocumentStore.
 */
export function renderBasicMarkdownPreview(
  parent: HTMLElement,
  markdownSource: string,
  options: ImageProjectionRenderOptions = {},
): void {
  if (typeof markdownSource !== 'string') {
    throw new TypeError('Preview source must be a string')
  }

  const document = parent.ownerDocument
  const fragment = document.createDocumentFragment()
  const lines = markdownSource.split('\n')
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = line.match(/^```([^\s]*)\s*$/)
    if (fence) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1

      const pre = document.createElement('pre')
      pre.className = 'live-preview-code'
      const code = document.createElement('code')
      if (fence[1]) code.dataset.language = fence[1]
      code.textContent = codeLines.join('\n')
      pre.append(code)
      fragment.append(pre)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`)
      appendInline(element, heading[2], document, options)
      fragment.append(element)
      index += 1
      continue
    }

    const paragraph = document.createElement('p')
    appendInline(paragraph, line, document, options)
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^```([^\s]*)\s*$/.test(lines[index]) &&
      !/^#{1,6}\s+/.test(lines[index])
    ) {
      paragraph.append(document.createElement('br'))
      appendInline(paragraph, lines[index], document, options)
      index += 1
    }
    fragment.append(paragraph)
  }

  parent.replaceChildren(fragment)
  setPreviewRenderMode(parent, 'rich')
}

const pattern =
  /!\[([^\]\n]*)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]\n]+)\]\(([^)\s]+)\)/g

function isDirectImageSource(source: string): boolean {
  const normalized = source.toLowerCase()
  return (
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:') ||
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    source.startsWith('//')
  )
}

function imageResourceWithoutResolver(
  source: string,
  alt: string,
): ImageProjectionResource {
  if (isDirectImageSource(source)) {
    return Object.freeze({
      source,
      url: source,
      name: source.split('/').at(-1) || 'image',
      alt,
      mimeType: source.toLowerCase().startsWith('data:')
        ? source.slice(5).split(/[;,]/u)[0] || 'image/png'
        : 'image/png',
      status: 'external' as const,
    })
  }

  const path = resolveWorkspaceImagePath(source)
  return Object.freeze({
    source,
    url: '',
    ...(path === undefined ? {} : { path }),
    name: path ?? source,
    alt,
    mimeType: mimeTypeForImagePath(path ?? source),
    status: 'unavailable' as const,
    error: 'Image projection resolver is unavailable',
  })
}

function appendImageProjection(
  parent: HTMLElement,
  source: string,
  alt: string,
  document: Document,
  options: ImageProjectionRenderOptions,
): void {
  const wrapper = document.createElement('span')
  wrapper.className = 'live-preview-image'
  wrapper.dataset.imageSource = source

  const image = document.createElement('img')
  image.className = 'live-preview-image__content'
  image.alt = alt
  image.loading = 'lazy'
  image.decoding = 'async'
  image.dataset.imageSource = source
  wrapper.append(image)

  const status = document.createElement('span')
  status.className = 'live-preview-image__status'
  status.setAttribute('role', 'status')
  status.textContent = 'Loading image…'
  wrapper.append(status)

  const actions = document.createElement('span')
  actions.className = 'live-preview-image__actions'
  const previewButton = document.createElement('button')
  previewButton.type = 'button'
  previewButton.className = 'live-preview-image__action'
  previewButton.dataset.imageAction = 'preview'
  previewButton.setAttribute('aria-label', `Preview image ${alt || 'image'}`)
  previewButton.textContent = 'Preview'
  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.className = 'live-preview-image__action'
  copyButton.dataset.imageAction = 'copy'
  copyButton.setAttribute('aria-label', `Copy image ${alt || 'image'}`)
  copyButton.textContent = 'Copy'
  const revealButton = document.createElement('button')
  revealButton.type = 'button'
  revealButton.className = 'live-preview-image__action'
  revealButton.dataset.imageAction = 'reveal'
  revealButton.setAttribute('aria-label', `Locate image ${alt || 'image'} in workspace`)
  revealButton.textContent = 'Locate'
  actions.append(previewButton, copyButton, revealButton)
  wrapper.append(actions)

  let currentResource: ImageProjectionResource | undefined
  const applyResource = (resource: ImageProjectionResource): void => {
    if (!wrapper.isConnected && parent !== wrapper.parentElement) return
    currentResource = Object.freeze({ ...resource, alt })
    wrapper.dataset.imageStatus = resource.status
    image.dataset.imageStatus = resource.status
    if (resource.path !== undefined) {
      wrapper.dataset.imagePath = resource.path
      image.dataset.imagePath = resource.path
    } else {
      delete wrapper.dataset.imagePath
      delete image.dataset.imagePath
    }

    if (resource.url !== '') image.src = resource.url
    else image.removeAttribute('src')

    const unavailable = resource.status === 'unavailable'
    status.hidden = !unavailable
    status.textContent = unavailable
      ? `Image unavailable${resource.error ? `: ${resource.error}` : ''}`
      : ''
    previewButton.disabled = unavailable || options.onPreview === undefined
    copyButton.disabled = resource.bytes === undefined || options.onCopy === undefined
    revealButton.hidden = resource.path === undefined || options.onReveal === undefined
    revealButton.disabled = resource.path === undefined || options.onReveal === undefined
  }

  const invokePreview = (): void => {
    if (currentResource && options.onPreview) options.onPreview(currentResource)
  }
  image.addEventListener('click', invokePreview)
  previewButton.addEventListener('click', invokePreview)
  copyButton.addEventListener('click', () => {
    if (!currentResource || !options.onCopy) return
    void Promise.resolve(options.onCopy(currentResource)).catch(() => {
      // Copy feedback belongs to the application shell; a failed observer
      // must not interrupt the preview or mutate the Markdown source.
    })
  })
  revealButton.addEventListener('click', () => {
    if (currentResource?.path && options.onReveal) {
      options.onReveal(currentResource.path)
    }
  })
  image.addEventListener('error', () => {
    if (!currentResource || currentResource.url === '') return
    wrapper.dataset.imageStatus = 'unavailable'
    image.dataset.imageStatus = 'unavailable'
    status.hidden = false
    status.textContent = 'Image could not be decoded; Markdown path was kept.'
  })

  parent.append(wrapper)
  const initialResource = options.imageResolver
    ? undefined
    : imageResourceWithoutResolver(source, alt)
  if (initialResource) {
    applyResource(initialResource)
  } else if (options.imageResolver) {
    wrapper.dataset.imageStatus = 'pending'
    image.dataset.imageStatus = 'pending'
    void options.imageResolver
      .resolve(source, options.documentPath)
      .then((resource) => {
        if (wrapper.isConnected || parent.contains(wrapper)) applyResource(resource)
      })
      .catch((error: unknown) => {
        if (!wrapper.isConnected && !parent.contains(wrapper)) return
        applyResource({
          ...imageResourceWithoutResolver(source, alt),
          error: `Image read failed: ${String(error)}`,
        })
      })
  }
}

function appendInline(
  parent: HTMLElement,
  source: string,
  document: Document,
  options: ImageProjectionRenderOptions,
): void {
  pattern.lastIndex = 0
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) {
      parent.append(document.createTextNode(source.slice(cursor, match.index)))
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      appendImageProjection(parent, match[2], match[1], document, options)
    } else if (match[3] !== undefined) {
      const strong = document.createElement('strong')
      strong.textContent = match[3]
      parent.append(strong)
    } else if (match[4] !== undefined) {
      const emphasis = document.createElement('em')
      emphasis.textContent = match[4]
      parent.append(emphasis)
    } else if (match[5] !== undefined) {
      const emphasis = document.createElement('em')
      emphasis.textContent = match[5]
      parent.append(emphasis)
    } else {
      const label = match[6]
      const href = match[7]
      if (label !== undefined && href !== undefined && isSafeHref(href)) {
        const link = document.createElement('a')
        link.href = href
        link.textContent = label
        parent.append(link)
      } else {
        parent.append(document.createTextNode(match[0]))
      }
    }

    cursor = match.index + match[0].length
  }

  if (cursor < source.length) {
    parent.append(document.createTextNode(source.slice(cursor)))
  }
}

function isSafeHref(href: string): boolean {
  const normalized = href.trim().toLowerCase()
  return (
    normalized.startsWith('#') ||
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('mailto:')
  )
}

function renderSourceFallback(parent: HTMLElement, source: string): void {
  const document = parent.ownerDocument
  const status = document.createElement('p')
  status.className = 'live-preview-degraded'
  status.setAttribute('role', 'status')
  status.textContent =
    'Rich preview unavailable; showing the original Markdown source.'

  const pre = document.createElement('pre')
  pre.className = 'live-preview-source-fallback'
  pre.dataset.previewFallback = 'true'
  pre.setAttribute('aria-label', 'Original Markdown source fallback')
  pre.textContent = source
  parent.replaceChildren(status, pre)
  setPreviewRenderMode(parent, 'source-fallback')
}

/**
 * A source-backed live preview projection. Rendering failures fall back to the
 * original source and leave the Store revision untouched.
 */
export class BasicLivePreview {
  private destroyed = false

  private displayedRevisionValue: Revision

  private acknowledgedRevision: Revision | undefined

  private renderModeValue: BasicLivePreviewRenderMode = 'unavailable'

  constructor(
    private readonly store: DocumentStore,
    readonly locator: DocumentLocator,
    readonly projectionId: ProjectionId,
    readonly parent: HTMLElement,
    readonly initialDocument: DocumentState,
    private readonly unsubscribe: () => void,
    private readonly renderer: BasicLivePreviewRenderer =
      renderBasicMarkdownPreview,
    private readonly renderOptions: ImageProjectionRenderOptions = {},
  ) {
    this.displayedRevisionValue = initialDocument.revision
  }

  get document(): DocumentState {
    const document = this.store.get(this.locator)
    if (!document) throw new DocumentNotFoundError(this.locator)
    return document
  }

  get displayedRevision(): Revision {
    return this.displayedRevisionValue
  }

  get projectionState() {
    return this.store.getProjection(this.locator, this.projectionId)
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }

  /** Current visual mode; source-fallback and unavailable are degraded modes. */
  get renderMode(): BasicLivePreviewRenderMode {
    return this.renderModeValue
  }

  /**
   * Renders the initial snapshot after the Store subscription is installed.
   * Mount keeps delivery buffered until this method has finished.
   */
  renderInitialDocument(): void {
    if (this.destroyed) return

    try {
      this.applyAuthoritativeDocument(this.initialDocument)
    } catch (error) {
      this.showSourceFallback(this.initialDocument, error)
    }
  }

  onDocumentEvent(event: DocumentStoreEvent): void {
    if (this.destroyed || event.type !== 'changed') return

    if (event.document.revision < this.displayedRevisionValue) {
      this.markSourceApplyFailure(
        new Error(
          `Received document revision ${event.document.revision} after ${this.displayedRevisionValue}`,
        ),
      )
      return
    }

    try {
      this.applyAuthoritativeDocument(event.document)
    } catch (error) {
      this.showSourceFallback(event.document, error)
    }
  }

  /**
   * Reconciles with a fresh Store snapshot after mount. Buffered events cover
   * renderer initialization; the fresh read also closes the window between
   * projection attachment and subscription.
   */
  reconcileToCurrentStore(): void {
    if (this.destroyed) return

    const current = this.store.get(this.locator)
    if (!current) {
      this.markSourceApplyFailure(new DocumentNotFoundError(this.locator))
      return
    }

    if (current.revision < this.displayedRevisionValue) {
      this.markSourceApplyFailure(
        new Error(
          `Store revision ${current.revision} is behind displayed revision ${this.displayedRevisionValue}`,
        ),
      )
      return
    }

    if (current.revision === this.displayedRevisionValue) {
      // An unavailable projection has no successful source display to
      // acknowledge. Retrying is explicit so reconciliation cannot silently
      // erase a real render failure.
      if (this.renderModeValue === 'unavailable') return
      if (this.acknowledgedRevision === current.revision) return
      try {
        this.acknowledgeProjection(current.revision)
      } catch (error) {
        this.markSourceApplyFailure(error)
      }
      return
    }

    try {
      this.applyAuthoritativeDocument(current)
    } catch (error) {
      this.showSourceFallback(current, error)
    }
  }

  /**
   * Retries rich rendering for the current source without requiring a new
   * DocumentStore revision. Success clears only the enhancement degradation;
   * the source revision remains unchanged.
   */
  retryRender(): void {
    if (this.destroyed) return

    const current = this.store.get(this.locator)
    if (!current) {
      this.markSourceApplyFailure(new DocumentNotFoundError(this.locator))
      return
    }

    if (current.revision < this.displayedRevisionValue) {
      this.markSourceApplyFailure(
        new Error(
          `Store revision ${current.revision} is behind displayed revision ${this.displayedRevisionValue}`,
        ),
      )
      return
    }

    try {
      this.applyAuthoritativeDocument(current, true)
    } catch (error) {
      this.showSourceFallback(current, error)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.unsubscribe()
    this.parent.replaceChildren()
    this.store.detachProjection(this.locator, this.projectionId)
  }

  private applyAuthoritativeDocument(
    document: DocumentState,
    forceAcknowledgement = false,
  ): void {
    this.renderer(this.parent, document.markdown, this.renderOptions)
    this.renderModeValue = 'rich'
    setPreviewRenderMode(this.parent, 'rich')
    this.displayedRevisionValue = document.revision
    this.acknowledgeProjection(
      document.revision,
      undefined,
      forceAcknowledgement,
    )
  }

  /**
   * Displays the exact source as a fallback and acknowledges its source
   * revision while preserving a separate degraded-rendering reason.
   */
  private showSourceFallback(
    document: DocumentState,
    renderError: unknown,
  ): void {
    let fallbackError: unknown
    let fallbackFailed = false
    try {
      renderSourceFallback(this.parent, document.markdown)
    } catch (error) {
      fallbackFailed = true
      fallbackError = error
    }

    if (fallbackFailed) {
      this.renderModeValue = 'unavailable'
      try {
        setPreviewRenderMode(this.parent, 'unavailable')
      } catch {
        // The DOM may be unavailable as well as the renderer.
      }
      this.markSourceApplyFailure(
        combinePreviewErrors(renderError, fallbackError),
        document.revision,
      )
      return
    }

    this.renderModeValue = 'source-fallback'
    this.displayedRevisionValue = document.revision
    try {
      this.acknowledgeProjection(
        document.revision,
        formatPreviewError(renderError),
        true,
      )
    } catch (error) {
      // The source fallback is visible, but a failed acknowledgement means
      // the Store cannot truthfully report it as current.
      this.markSourceApplyFailure(error, document.revision)
    }
  }

  private acknowledgeProjection(
    revision: Revision,
    degradedReason?: string,
    force = false,
  ): void {
    if (
      !force &&
      degradedReason === undefined &&
      this.acknowledgedRevision === revision
    ) {
      return
    }

    const previousRevision = this.acknowledgedRevision
    this.acknowledgedRevision = revision
    try {
      this.store.acknowledgeProjection(
        this.locator,
        this.projectionId,
        revision,
        degradedReason === undefined ? {} : { degradedReason },
      )
    } catch (error) {
      // A lifecycle observer can synchronously advance the projection while
      // acknowledgement is being recorded. Preserve newer nested progress.
      if (this.acknowledgedRevision === revision) {
        this.acknowledgedRevision = previousRevision
      }
      throw error
    }
  }

  private markSourceApplyFailure(
    error: unknown,
    reportedRevision?: Revision,
  ): void {
    try {
      const reason = formatPreviewError(error)
      if (reportedRevision === undefined) {
        this.store.markProjectionStale(
          this.locator,
          this.projectionId,
          reason,
        )
      } else {
        this.store.markProjectionStale(
          this.locator,
          this.projectionId,
          reportedRevision,
          reason,
        )
      }
    } catch {
      // The projection may already be detached during teardown.
    }
  }
}

export function mountBasicLivePreview(
  options: BasicLivePreviewOptions,
): BasicLivePreview {
  const snapshot = options.store.get(options.locator)
  if (!snapshot) throw new DocumentNotFoundError(options.locator)
  if (!options.parent || typeof options.parent.replaceChildren !== 'function') {
    throw new TypeError('Preview parent must be a DOM element')
  }

  const projectionId =
    options.projectionId ?? DEFAULT_LIVE_PREVIEW_PROJECTION_ID
  let attached = false
  let unsubscribe: (() => void) | undefined
  let preview: BasicLivePreview | undefined
  const previewRef: { current?: BasicLivePreview } = {}
  const pendingEvents: DocumentStoreEvent[] = []
  const receiveEvent = (event: DocumentStoreEvent): void => {
    if (previewRef.current) {
      previewRef.current.onDocumentEvent(event)
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

    // Subscribe before the first render. A renderer may synchronously cause a
    // Store change; buffer it until the preview object owns the DOM lifecycle.
    unsubscribe = options.store.subscribeProjection(
      options.locator,
      projectionId,
      receiveEvent,
    )

    preview = new BasicLivePreview(
      options.store,
      options.locator,
      projectionId,
      options.parent,
      snapshot,
      unsubscribe,
      options.renderer ?? renderBasicMarkdownPreview,
      {
        imageResolver: options.imageResolver,
        documentPath: options.documentPath,
        onPreview: options.onPreview,
        onCopy: options.onCopy,
        onReveal: options.onReveal,
      },
    )

    // Keep delivery buffered while the initial renderer owns the DOM. This
    // lets a renderer-triggered Store change be replayed after initialization
    // instead of being overwritten by the initial snapshot.
    preview.renderInitialDocument()
    previewRef.current = preview

    for (const event of pendingEvents.splice(0)) {
      preview.onDocumentEvent(event)
    }

    // Always reconcile after replay. Same-revision degraded/unavailable states
    // are intentionally preserved; a newer source revision is applied here.
    preview.reconcileToCurrentStore()

    return preview
  } catch (error) {
    preview?.destroy()
    if (!preview) {
      unsubscribe?.()
      if (attached) options.store.detachProjection(options.locator, projectionId)
    }
    renderSourceFallback(options.parent, snapshot.markdown)
    throw error
  }
}
