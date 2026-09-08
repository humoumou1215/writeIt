import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import {
  createDocumentOrigin,
  type Revision,
} from '../../../core/document'
import {
  createReferenceClipboardEdit,
  createReferenceContextEdit,
  createReferenceContextOpenRequest,
  defaultReferenceClipboardStore,
  extractReferenceClipboardItems,
  parseReferences,
  referenceContextModeFor,
  referenceContextSyntax,
  type ParsedReference,
  type ReferenceClipboardData,
  type ReferenceClipboardEdit,
  type ReferenceClipboardNode,
  type ReferenceClipboardParseOptions,
  type ReferenceClipboardStore,
  type ReferenceContextActionMode,
  type ReferenceContextModeEdit,
  type ReferenceContextOpenRequest,
  type ReferencePasteMode,
} from '../../../core/reference'
import {
  getProjectionMutationCapability,
  type ProjectionMutationCapability,
} from '../projection/mutation-capability'
import { projectMarkdownSource } from '../projection/source-fidelity'

export interface ReferenceClipboardPasteContext {
  readonly expectedRevision: Revision
  readonly from: number
  readonly to: number
  readonly projectedSource: string
}

export interface ReferenceClipboardAppliedResult {
  readonly items: readonly ReferenceClipboardNode[]
  readonly mode: ReferencePasteMode
  readonly edit: ReferenceClipboardEdit
  readonly context: ReferenceClipboardPasteContext
}

export interface ReferenceContextTarget {
  readonly reference: ParsedReference
  readonly from: number
  readonly to: number
  /** The LF-normalized source displayed by CM6 at menu-open time. */
  readonly projectedSource: string
  /** Optional application-resolved workspace path used by “Open reference”. */
  readonly targetPath?: string
}

export interface ReferenceContextModeChangedResult {
  readonly target: ReferenceContextTarget
  readonly edit: ReferenceContextModeEdit
  readonly expectedRevision: Revision
}

export interface ReferenceContextActionOptions {
  /** Resolves an already-parsed token to the canonical workspace target. */
  readonly getTargetPath?: (
    reference: ParsedReference,
    from: number,
    to: number,
  ) => string | undefined
  /** Opens the target without asking the editor adapter to own navigation. */
  readonly onOpen?: (
    request: ReferenceContextOpenRequest,
  ) => void | PromiseLike<void>
  /** Optional text clipboard writer; defaults to navigator.clipboard.writeText. */
  readonly copyText?: (text: string) => void | PromiseLike<void>
  readonly onCopied?: (
    syntax: string,
    target: ReferenceContextTarget,
  ) => void
  readonly onModeChanged?: (result: ReferenceContextModeChangedResult) => void
}

export interface ReferenceClipboardExtensionOptions {
  /** Optional direct capability for standalone EditorView tests/adapters. */
  readonly mutation?: ProjectionMutationCapability
  /** Freshness-bound in-app fallback for text-only clipboard events. */
  readonly store?: ReferenceClipboardStore
  /** Maps system file-manager paths to workspace-relative reference paths. */
  readonly clipboardParseOptions?: ReferenceClipboardParseOptions
  /** Alias for callers that configure the external path mapping directly. */
  readonly resolveExternalPath?: ReferenceClipboardParseOptions['resolveExternalPath']
  /** Async browser/platform read used by the custom context menu. */
  readonly readClipboard?: () =>
    | readonly ReferenceClipboardNode[]
    | PromiseLike<readonly ReferenceClipboardNode[] | undefined>
    | undefined
  readonly onApplied?: (result: ReferenceClipboardAppliedResult) => void
  readonly onError?: (error: unknown) => void
  readonly originSource?: string
  /** Reference actions are shown in the same menu as clipboard paste modes. */
  readonly contextActions?: ReferenceContextActionOptions
  /** Set false when an embedding shell supplies its own context menu. */
  readonly contextMenu?: boolean
}

interface CapturedPasteContext extends ReferenceClipboardPasteContext {
  readonly mutation: ProjectionMutationCapability
}

interface CapturedReferenceContext extends ReferenceContextTarget {
  readonly mutation?: ProjectionMutationCapability
  readonly expectedRevision?: Revision
}

interface CapturedMenuContext {
  readonly paste?: CapturedPasteContext
  readonly reference?: CapturedReferenceContext
}

const PASTE_MODES: readonly {
  readonly id: ReferencePasteMode
  readonly label: string
}[] = Object.freeze([
  Object.freeze({ id: 'link' as const, label: 'Paste as link' }),
  Object.freeze({ id: 'embed' as const, label: 'Paste as editable embed' }),
  Object.freeze({ id: 'embed-readonly' as const, label: 'Paste as readonly embed' }),
])

const CONTEXT_MODES: readonly {
  readonly id: ReferenceContextActionMode
  readonly label: string
  readonly syntax: string
}[] = Object.freeze([
  Object.freeze({ id: 'link' as const, label: 'Link reference', syntax: '[[path]]' }),
  Object.freeze({ id: 'embed' as const, label: 'Editable embed', syntax: '![[path]]' }),
  Object.freeze({
    id: 'embed-readonly' as const,
    label: 'Readonly embed',
    syntax: '![[path|ro]]',
  }),
])

function formatError(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : String(error)
    return message.length > 0 ? message : 'Reference paste failed'
  } catch {
    return 'Reference paste failed'
  }
}

function isEditable(view: EditorView): boolean {
  return !view.state.readOnly && view.state.facet(EditorView.editable)
}

function referenceClipboardData(
  data: DataTransfer | null,
): ReferenceClipboardData | null {
  if (!data) return null
  return data
}

function parseOptions(
  options: ReferenceClipboardExtensionOptions,
): ReferenceClipboardParseOptions {
  return Object.freeze({
    ...(options.clipboardParseOptions ?? {}),
    ...(options.resolveExternalPath === undefined
      ? {}
      : { resolveExternalPath: options.resolveExternalPath }),
  })
}

/**
 * CM6 adapter for file-reference clipboard workflows. It commits only a
 * source edit through the projection mutation capability; CM6 remains a
 * projection and never becomes a clipboard/content authority.
 */
export class ReferenceClipboardController {
  private readonly mutation: ProjectionMutationCapability | undefined
  private readonly store: ReferenceClipboardStore
  private readonly menu: HTMLDivElement
  private menuContext: CapturedMenuContext | undefined
  private menuGeneration = 0
  private destroyed = false

  private readonly onContextMenu = (event: MouseEvent): void => {
    this.handleContextMenuEvent(event)
  }

  private readonly onClipboardCopy = (event: ClipboardEvent): void => {
    const types = event.clipboardData?.types
    if (!types || !Array.from(types).includes('application/x-writeit-node')) {
      this.store.clear()
    }
  }

  handlePasteEvent(event: ClipboardEvent): boolean {
    if (this.destroyed || !isEditable(this.view) || event.defaultPrevented) {
      return false
    }
    if (this.view.composing) return false

    const items = extractReferenceClipboardItems(
      referenceClipboardData(event.clipboardData),
      {
        ...parseOptions(this.options),
        store: this.store,
      },
    )
    if (!items || items.length === 0) return false

    let context: CapturedPasteContext
    try {
      context = this.captureContext()
    } catch (error) {
      this.report(error)
      return false
    }

    event.preventDefault()
    void this.apply(items, 'link', context).catch((error: unknown) =>
      this.report(error),
    )
    return true
  }

  handleContextMenuEvent(event: MouseEvent): boolean {
    if (
      event.defaultPrevented ||
      this.destroyed ||
      this.options.contextMenu === false
    ) {
      return false
    }

    const reference = this.captureReferenceContext(event)
    let paste: CapturedPasteContext | undefined
    if (isEditable(this.view)) {
      try {
        paste = this.captureContext()
      } catch {
        // A reference can still offer open/copy actions while its projection
        // is catching up. Mode conversion and paste remain unavailable.
      }
    }
    if (!reference && !paste) return false

    event.preventDefault()
    event.stopPropagation()
    this.showMenu(
      Object.freeze({
        ...(paste === undefined ? {} : { paste }),
        ...(reference === undefined ? {} : { reference }),
      }),
      event.clientX,
      event.clientY,
    )
    return true
  }

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target as Node | null
    if (target && this.menu.contains(target)) return
    this.hideMenu()
  }

  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.hideMenu()
  }

  private readonly onMenuMouseDown = (event: MouseEvent): void => {
    event.preventDefault()
  }

  private readonly onMenuClick = (event: MouseEvent): void => {
    const target = event.target as Element | null
    const contextAction = target?.closest<HTMLButtonElement>(
      '[data-reference-context-action]',
    )
    if (contextAction && this.menu.contains(contextAction)) {
      this.handleContextActionClick(contextAction, event)
      return
    }

    const button = target?.closest<HTMLButtonElement>(
      '[data-reference-paste-mode]',
    )
    if (!button || !this.menu.contains(button)) return
    const mode = button.dataset.referencePasteMode as ReferencePasteMode | undefined
    const context = this.menuContext?.paste
    if (!mode || !context) return

    event.preventDefault()
    const generation = this.menuGeneration
    void this.readClipboard()
      .then((items) => {
        if (
          this.destroyed ||
          generation !== this.menuGeneration ||
          !this.menuContext
        ) {
          return
        }
        if (!items || items.length === 0) {
          throw new Error('No copied workspace file or directory is available')
        }
        return this.apply(items, mode, context)
      })
      .catch((error: unknown) => this.report(error))
      .finally(() => {
        if (!this.destroyed && generation === this.menuGeneration) {
          this.hideMenu()
        }
      })
  }

  private handleContextActionClick(
    button: HTMLButtonElement,
    event: MouseEvent,
  ): void {
    const context = this.menuContext?.reference
    if (!context) return
    event.preventDefault()

    const action = button.dataset.referenceContextAction
    const generation = this.menuGeneration
    if (action === 'open') {
      const request = createReferenceContextOpenRequest(
        context.reference,
        context.targetPath,
      )
      this.hideMenu()
      try {
        const result = this.options.contextActions?.onOpen?.(request)
        if (result && typeof result.then === 'function') {
          void Promise.resolve(result).catch((error: unknown) => this.report(error))
        }
      } catch (error) {
        this.report(error)
      }
      return
    }

    if (action === 'copy-syntax') {
      const syntax = referenceContextSyntax(context.reference)
      void this.copyReferenceSyntax(syntax, context, generation)
      return
    }

    if (action === 'set-mode') {
      const mode = button.dataset.referenceContextMode as
        | ReferenceContextActionMode
        | undefined
      if (!mode) return
      void this.applyReferenceMode(mode, context, generation)
        .catch((error: unknown) => this.report(error))
        .finally(() => {
          if (!this.destroyed && generation === this.menuGeneration) {
            this.hideMenu()
          }
        })
    }
  }

  private async copyReferenceSyntax(
    syntax: string,
    context: CapturedReferenceContext,
    generation: number,
  ): Promise<void> {
    try {
      const writer =
        this.options.contextActions?.copyText ??
        ((text: string) => {
          const clipboard = this.view.dom.ownerDocument.defaultView?.navigator.clipboard
          if (!clipboard || typeof clipboard.writeText !== 'function') {
            throw new Error('Text clipboard access is unavailable')
          }
          return clipboard.writeText(text)
        })
      await writer(syntax)
      if (
        !this.destroyed &&
        generation === this.menuGeneration &&
        this.options.contextActions?.onCopied
      ) {
        try {
          this.options.contextActions.onCopied(syntax, context)
        } catch (error) {
          this.report(error)
        }
      }
      if (!this.destroyed && generation === this.menuGeneration) this.hideMenu()
    } catch (error) {
      this.report(error)
    }
  }

  private async applyReferenceMode(
    mode: ReferenceContextActionMode,
    context: CapturedReferenceContext,
    generation: number,
  ): Promise<void> {
    if (this.destroyed || generation !== this.menuGeneration) return
    const mutation = context.mutation
    if (!mutation || context.expectedRevision === undefined) {
      throw new Error('Reference mode changes require an attached editable projection')
    }

    const current = mutation.snapshot()
    if (current.revision !== context.expectedRevision) {
      throw new Error(
        `Reference mode change is stale at revision ${context.expectedRevision}; current revision is ${current.revision}`,
      )
    }
    const currentProjected = projectMarkdownSource(current.markdown).projected
    if (
      currentProjected !== context.projectedSource ||
      this.view.state.doc.toString() !== context.projectedSource ||
      currentProjected.slice(context.from, context.to) !== context.reference.raw
    ) {
      throw new Error('Reference mode change source changed before it was applied')
    }

    const edit = createReferenceContextEdit({
      source: context.projectedSource,
      reference: context.reference,
      from: context.from,
      to: context.to,
      mode,
    })
    if (!edit) {
      this.hideMenu()
      return
    }

    const markdown =
      context.projectedSource.slice(0, edit.from) +
      edit.insert +
      context.projectedSource.slice(edit.to)
    mutation.applyChange({
      markdown,
      origin: createDocumentOrigin(
        'reference-context-action',
        this.options.originSource ?? `mode:${mode}`,
      ),
      expectedRevision: context.expectedRevision,
    })

    try {
      this.view.dispatch({
        selection: { anchor: edit.from + edit.cursorOffset },
      })
    } catch {
      // The Store mutation remains authoritative if an observer destroys the
      // projection synchronously while the action is being applied.
    }

    try {
      this.options.contextActions?.onModeChanged?.({
        target: context,
        edit,
        expectedRevision: context.expectedRevision,
      })
    } catch (error) {
      this.report(error)
    }
    this.hideMenu()
  }

  constructor(
    private readonly view: EditorView,
    private readonly options: ReferenceClipboardExtensionOptions,
  ) {
    this.mutation =
      options.mutation ?? getProjectionMutationCapability(view.state)
    this.store = options.store ?? defaultReferenceClipboardStore
    const document = view.dom.ownerDocument
    this.menu = document.createElement('div')
    this.menu.className = 'writeit-reference-clipboard-menu'
    this.menu.dataset.referenceClipboardMenu = 'true'
    this.menu.dataset.referenceContextMenu = 'false'
    this.menu.dataset.show = 'false'
    this.menu.hidden = true
    this.menu.setAttribute('role', 'menu')
    this.menu.addEventListener('mousedown', this.onMenuMouseDown)
    this.menu.addEventListener('click', this.onMenuClick)
    document.body.append(this.menu)
    if (options.contextMenu !== false) {
      view.dom.addEventListener('contextmenu', this.onContextMenu)
    }
    document.addEventListener('copy', this.onClipboardCopy, true)
    document.addEventListener('cut', this.onClipboardCopy, true)
  }

  get element(): HTMLElement {
    return this.menu
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.menuGeneration += 1
    this.hideMenu()
    this.view.dom.removeEventListener('contextmenu', this.onContextMenu)
    this.view.dom.ownerDocument.removeEventListener('copy', this.onClipboardCopy, true)
    this.view.dom.ownerDocument.removeEventListener('cut', this.onClipboardCopy, true)
    this.menu.removeEventListener('mousedown', this.onMenuMouseDown)
    this.menu.removeEventListener('click', this.onMenuClick)
    this.menu.remove()
  }

  private captureReferenceContext(
    event: MouseEvent,
  ): CapturedReferenceContext | undefined {
    const projectedSource = this.view.state.doc.toString()
    const references = parseReferences(projectedSource)
    if (references.length === 0) return undefined

    let position: number | null = null
    try {
      position = this.view.posAtCoords({ x: event.clientX, y: event.clientY })
    } catch {
      position = null
    }
    if (position === null || position === undefined) {
      const target = event.target as Node | null
      if (target) {
        try {
          position = this.view.posAtDOM(target, 0)
        } catch {
          position = null
        }
      }
    }
    if (position === null || position === undefined) return undefined

    const reference =
      references.find(
        (candidate) => candidate.from <= position! && position! < candidate.to,
      ) ??
      (position > 0
        ? references.find(
            (candidate) =>
              candidate.from <= position! - 1 && position! - 1 < candidate.to,
          )
        : undefined)
    if (!reference) return undefined

    let mutation = this.mutation
    let expectedRevision: Revision | undefined
    if (mutation) {
      try {
        const snapshot = mutation.snapshot()
        const authoritative = projectMarkdownSource(snapshot.markdown).projected
        if (authoritative !== projectedSource) return undefined
        expectedRevision = snapshot.revision
      } catch {
        // Readonly projections can still open/copy a reference. The optional
        // mutation is retained only when it is currently usable for mode edits.
        mutation = undefined
      }
    }

    let targetPath: string | undefined
    try {
      targetPath = this.options.contextActions?.getTargetPath?.(
        reference,
        reference.from,
        reference.to,
      )
    } catch {
      targetPath = undefined
    }

    return Object.freeze({
      reference,
      from: reference.from,
      to: reference.to,
      projectedSource,
      ...(targetPath === undefined ? {} : { targetPath }),
      ...(mutation === undefined ? {} : { mutation }),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    })
  }

  private captureContext(): CapturedPasteContext {
    const mutation = this.mutation
    if (!mutation) {
      throw new Error('Reference paste requires an attached editable projection')
    }
    const snapshot = mutation.snapshot()
    const projectedSource = projectMarkdownSource(snapshot.markdown).projected
    if (this.view.state.doc.toString() !== projectedSource) {
      throw new Error('Reference editor is not synchronized with DocumentStore')
    }
    const selection = this.view.state.selection.main
    return Object.freeze({
      mutation,
      expectedRevision: snapshot.revision,
      from: selection.from,
      to: selection.to,
      projectedSource,
    })
  }

  private async readClipboard(): Promise<readonly ReferenceClipboardNode[] | undefined> {
    const reader = this.options.readClipboard
    if (!reader) return undefined
    const result = reader()
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return await result
    }
    return result
  }

  private async apply(
    items: readonly ReferenceClipboardNode[],
    mode: ReferencePasteMode,
    context: CapturedPasteContext,
  ): Promise<void> {
    if (this.destroyed) return
    const current = context.mutation.snapshot()
    if (current.revision !== context.expectedRevision) {
      throw new Error(
        `Reference paste is stale at revision ${context.expectedRevision}; current revision is ${current.revision}`,
      )
    }
    const currentProjected = projectMarkdownSource(current.markdown).projected
    if (
      currentProjected !== context.projectedSource ||
      this.view.state.doc.toString() !== context.projectedSource
    ) {
      throw new Error('Reference paste source changed before it was applied')
    }

    const edit = createReferenceClipboardEdit({
      source: context.projectedSource,
      from: context.from,
      to: context.to,
      items,
      mode,
    })
    if (!edit) return

    const markdown =
      context.projectedSource.slice(0, edit.from) +
      edit.insert +
      context.projectedSource.slice(edit.to)
    context.mutation.applyChange({
      markdown,
      origin: createDocumentOrigin(
        'reference-clipboard',
        this.options.originSource ?? `paste:${mode}`,
      ),
      expectedRevision: context.expectedRevision,
    })

    try {
      this.view.dispatch({
        selection: {
          anchor: edit.from + edit.cursorOffset,
        },
      })
    } catch {
      // The Store mutation has already succeeded if the view was destroyed by
      // a synchronous application observer.
    }

    try {
      this.options.onApplied?.({
        items: Object.freeze([...items]),
        mode,
        edit,
        context,
      })
    } catch {
      // Observing a successful source mutation cannot turn it into a failure.
    }
  }

  private showMenu(
    context: CapturedMenuContext,
    clientX: number,
    clientY: number,
  ): void {
    this.menuContext = context
    this.menuGeneration += 1
    const generation = this.menuGeneration
    this.menu.replaceChildren()
    this.menu.dataset.referenceContextMenu = context.reference ? 'true' : 'false'

    if (context.reference) {
      const heading = this.createMenuHeading('Reference actions')
      this.menu.append(heading)

      const open = this.createContextButton('open', 'Open reference')
      open.dataset.referenceContextTarget = context.reference.reference.raw
      open.disabled = this.options.contextActions?.onOpen === undefined
      this.menu.append(open)

      const copy = this.createContextButton('copy-syntax', 'Copy reference syntax')
      copy.dataset.referenceContextTarget = context.reference.reference.raw
      this.menu.append(copy)

      const modeHeading = this.createMenuHeading('Reference mode')
      this.menu.append(modeHeading)
      const currentMode = referenceContextModeFor(context.reference.reference)
      for (const mode of CONTEXT_MODES) {
        const button = this.createContextButton(
          'set-mode',
          `${mode.label} ${mode.syntax}`,
        )
        button.dataset.referenceContextMode = mode.id
        button.dataset.referenceContextTarget = context.reference.reference.raw
        button.dataset.referenceContextCurrent = String(mode.id === currentMode)
        button.setAttribute('aria-checked', String(mode.id === currentMode))
        button.classList.toggle(
          'writeit-reference-clipboard-menu__option--active',
          mode.id === currentMode,
        )
        button.disabled =
          mode.id === currentMode ||
          context.reference.mutation === undefined
        this.menu.append(button)
      }
    }

    if (context.paste) {
      const heading = this.createMenuHeading('Paste workspace reference')
      this.menu.append(heading)

      for (const mode of PASTE_MODES) {
        const button = this.ownerDocument.createElement('button')
        button.type = 'button'
        button.className = 'writeit-reference-clipboard-menu__option'
        button.dataset.referencePasteMode = mode.id
        button.dataset.referenceClipboardGeneration = String(generation)
        button.setAttribute('role', 'menuitem')
        button.textContent = mode.label
        this.menu.append(button)
      }
    }

    const window = this.ownerDocument.defaultView
    const viewportWidth = window?.innerWidth ?? 1024
    const viewportHeight = window?.innerHeight ?? 768
    const width = 300
    this.menu.hidden = false
    this.menu.dataset.show = 'true'
    const measuredHeight = this.menu.getBoundingClientRect().height
    const below = clientY + 4
    const above = clientY - measuredHeight - 4
    this.menu.style.left = `${Math.max(8, Math.min(clientX, viewportWidth - width - 8))}px`
    this.menu.style.top = `${
      below + measuredHeight <= viewportHeight - 8
        ? below
        : Math.max(8, above)
    }px`
    this.view.dom.ownerDocument.addEventListener(
      'pointerdown',
      this.onDocumentPointerDown,
      true,
    )
    this.view.dom.ownerDocument.addEventListener(
      'keydown',
      this.onDocumentKeyDown,
      true,
    )
  }

  private get ownerDocument(): Document {
    return this.view.dom.ownerDocument
  }

  private createMenuHeading(text: string): HTMLDivElement {
    const heading = this.ownerDocument.createElement('div')
    heading.className = 'writeit-reference-clipboard-menu__heading'
    heading.textContent = text
    return heading
  }

  private createContextButton(
    action: 'open' | 'copy-syntax' | 'set-mode',
    text: string,
  ): HTMLButtonElement {
    const button = this.ownerDocument.createElement('button')
    button.type = 'button'
    button.className = 'writeit-reference-clipboard-menu__option'
    button.dataset.referenceContextAction = action
    button.setAttribute(
      'role',
      action === 'set-mode' ? 'menuitemradio' : 'menuitem',
    )
    button.textContent = text
    return button
  }

  private hideMenu(): void {
    this.menuContext = undefined
    this.menu.hidden = true
    this.menu.dataset.show = 'false'
    this.menu.dataset.referenceContextMenu = 'false'
    this.view.dom.ownerDocument.removeEventListener(
      'pointerdown',
      this.onDocumentPointerDown,
      true,
    )
    this.view.dom.ownerDocument.removeEventListener(
      'keydown',
      this.onDocumentKeyDown,
      true,
    )
  }

  private report(error: unknown): void {
    const message = formatError(error)
    this.view.dom.dataset.referenceClipboardError = message
    try {
      this.options.onError?.(error)
    } catch {
      // Error presentation is never allowed to break a paste event.
    }
  }
}

/** Installs the source-backed clipboard projection on one CM6 view. */
export function createReferenceClipboardExtension(
  options: ReferenceClipboardExtensionOptions = {},
): Extension {
  const controllerRef: {
    current: ReferenceClipboardController | undefined
  } = { current: undefined }
  const plugin = ViewPlugin.define(
    (view) => {
      const controller = new ReferenceClipboardController(view, options)
      controllerRef.current = controller
      return controller
    },
  )

  return [
    EditorView.contentAttributes.of({
      'data-reference-clipboard-enabled': 'true',
    }),
    // CM6's DOM event bridge runs before the built-in paste handler, allowing
    // ordinary text/image paste to fall through while recognized file payloads
    // are consumed exactly once.
    EditorView.domEventHandlers({
      paste: (event) => controllerRef.current?.handlePasteEvent(event) ?? false,
      contextmenu: (event) =>
        controllerRef.current?.handleContextMenuEvent(event) ?? false,
    }),
    // ViewPlugin owns only DOM menu/lifecycle state and source edit bridging;
    // it never becomes a Markdown authority.
    plugin,
  ]
}
