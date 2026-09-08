import type { EditorState, Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { CaretPopup } from '../caret-popup'
import {
  createDocumentOrigin,
  type Revision,
} from '../../../core/document'
import {
  getProjectionMutationCapability,
  type ProjectionMutationCapability,
} from '../projection/mutation-capability'
import { projectMarkdownSource } from '../projection/source-fidelity'

export type CompletionTriggerKind = '@' | '[[' | '![['

export interface CompletionTrigger {
  readonly kind: CompletionTriggerKind
  readonly from: number
  readonly to: number
  readonly query: string
}

export interface CompletionSurfaceMode {
  /** Stable provider-defined identifier. */
  readonly id: string
  readonly label: string
  readonly description?: string
}

/**
 * Keep trigger normalization in the editor adapter's pure detection layer.
 * Each supported IME punctuation mapping is one UTF-16 code unit, so the
 * normalized detection copy preserves offsets while the original source stays
 * untouched until a completion is explicitly applied.
 */
const FULL_WIDTH_TRIGGER_MAP: Readonly<Record<string, string>> = Object.freeze({
  '＠': '@',
  '！': '!',
  '【': '[',
  '［': '[',
  '】': ']',
  '］': ']',
})

export function normalizeCompletionTriggers(source: string): string {
  if (typeof source !== 'string') {
    throw new TypeError('Completion trigger source must be a string')
  }

  let normalized = ''
  for (const character of source) {
    normalized += FULL_WIDTH_TRIGGER_MAP[character] ?? character
  }
  return normalized
}

/** Compatibility name for callers that use the legacy trigger-core term. */
export const normalizeTriggers = normalizeCompletionTriggers

export interface CompletionSurfaceContext {
  readonly source: string
  readonly cursor: number
  readonly trigger: CompletionTrigger
  readonly mode?: CompletionSurfaceMode
}

export interface CompletionSurfaceEdit {
  readonly from: number
  readonly to: number
  readonly insert: string
  readonly cursorOffset?: number
}

export type CompletionSurfaceApplyResult = CompletionSurfaceEdit | string

export type CompletionSurfaceChildrenResult =
  | readonly CompletionSurfaceItem[]
  | null
  | undefined

export type CompletionSurfaceChildrenResolver = (
  context: CompletionSurfaceContext,
) => CompletionSurfaceChildrenResult | Promise<CompletionSurfaceChildrenResult>

export type CompletionSurfaceItemKind =
  | 'file'
  | 'directory'
  | 'object'
  | 'heading'

export interface CompletionSurfaceItem {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly keywords?: readonly string[]
  /** Optional semantic kind for source-backed workspace candidates. */
  readonly kind?: CompletionSurfaceItemKind
  readonly insertText?: string
  readonly apply?: (
    context: CompletionSurfaceContext,
  ) => CompletionSurfaceApplyResult | Promise<CompletionSurfaceApplyResult>
  /** Opens provider-owned child candidates without changing the source. */
  readonly children?: CompletionSurfaceChildrenResolver
}

export interface CompletionSurfaceQueryResult {
  readonly items: readonly CompletionSurfaceItem[]
  readonly errors?: readonly {
    readonly providerId: string
    readonly error: unknown
  }[]
  readonly modes?: readonly CompletionSurfaceMode[]
  readonly initialModeId?: string
}

/**
 * Structural application bridge. The editor adapter deliberately does not
 * import the application assistance layer: it only needs a completion query
 * and turns the selected result into a Store mutation.
 */
export interface CompletionSurfaceRegistry {
  complete(
    context: CompletionSurfaceContext,
  ): CompletionSurfaceQueryResult | readonly CompletionSurfaceItem[] | Promise<
    CompletionSurfaceQueryResult | readonly CompletionSurfaceItem[]
  >
}

export interface CompletionSurfaceOptions {
  readonly registry: CompletionSurfaceRegistry
  /** Optional for direct surface mounts; SingleDocumentView injects it via CM6. */
  readonly mutation?: ProjectionMutationCapability
}

const MENU_CLASS = 'writeit-completion-menu'
const MENU_OPTION_SELECTOR = '[data-completion-index]'
const MENU_MODE_SELECTOR = '[data-completion-mode-id]'
const MENU_BACK_SELECTOR = '[data-completion-back]'

function triggerKey(trigger: CompletionTrigger, source: string): string {
  return `${trigger.kind}:${trigger.from}:${trigger.to}:${trigger.query}:${source}`
}

function incompleteBracketTrigger(
  source: string,
  cursor: number,
  opener: '[[' | '![[',
  kind: CompletionTriggerKind,
): CompletionTrigger | undefined {
  let searchEnd = cursor - opener.length
  while (searchEnd >= 0) {
    const from = source.lastIndexOf(opener, searchEnd)
    if (from < 0) return undefined
    if (kind === '[[' && source[from - 1] === '!') {
      searchEnd = from - 1
      continue
    }

    const query = source.slice(from + opener.length, cursor)
    if (!/[\r\n]/u.test(query) && !query.includes(']]')) {
      return Object.freeze({ kind, from, to: cursor, query })
    }
    searchEnd = from - 1
  }
  return undefined
}

/**
 * Finds the latest incomplete trigger before the primary cursor. Full-width
 * punctuation is normalized only in a detection copy; CM6 and Store retain
 * the original Markdown until the user applies a completion.
 */
export function findCompletionTrigger(
  state: EditorState,
): CompletionTrigger | undefined {
  const selection = state.selection.main
  if (!selection.empty) return undefined

  const source = state.doc.toString()
  const normalizedSource = normalizeCompletionTriggers(source)
  const cursor = selection.head
  const candidates: CompletionTrigger[] = []
  const embed = incompleteBracketTrigger(normalizedSource, cursor, '![[', '![[')
  const link = incompleteBracketTrigger(normalizedSource, cursor, '[[', '[[')
  if (embed) candidates.push(embed)
  if (link) candidates.push(link)

  const lineStart = normalizedSource.lastIndexOf('\n', cursor - 1) + 1
  const beforeCursor = normalizedSource.slice(lineStart, cursor)
  const atMatch = /(^|[\s])@([^\s]*)$/u.exec(beforeCursor)
  if (atMatch) {
    candidates.push(
      Object.freeze({
        kind: '@',
        from: lineStart + atMatch.index + atMatch[0].indexOf('@'),
        to: cursor,
        query: atMatch[2],
      }),
    )
  }

  candidates.sort(
    (left, right) =>
      right.from - left.from || right.kind.length - left.kind.length,
  )
  return candidates[0]
}

function triggerText(trigger: CompletionTrigger): string {
  return `${trigger.kind}${trigger.query}`
}

function formatError(error: unknown): string {
  try {
    const text = String(error)
    return text.length > 0 ? text : 'Completion failed'
  } catch {
    return 'Completion failed'
  }
}

function normalizeSurfaceModes(
  modes: readonly CompletionSurfaceMode[] | undefined,
): readonly CompletionSurfaceMode[] {
  if (modes === undefined) return []
  if (!Array.isArray(modes)) {
    throw new TypeError('Completion registry modes must be an array')
  }

  const normalized = modes.map((mode, index) => {
    if (
      mode === null ||
      typeof mode !== 'object' ||
      typeof mode.id !== 'string' ||
      mode.id.trim().length === 0 ||
      typeof mode.label !== 'string' ||
      mode.label.trim().length === 0
    ) {
      throw new TypeError(`Completion mode ${index} is invalid`)
    }
    if (mode.description !== undefined && typeof mode.description !== 'string') {
      throw new TypeError(`Completion mode ${mode.id} description is invalid`)
    }
    return Object.freeze({
      id: mode.id,
      label: mode.label,
      ...(mode.description === undefined ? {} : { description: mode.description }),
    })
  })
  if (new Set(normalized.map((mode) => mode.id)).size !== normalized.length) {
    throw new TypeError('Completion registry modes must have unique ids')
  }
  return Object.freeze(normalized)
}

function normalizeResult(
  result:
    | CompletionSurfaceQueryResult
    | readonly CompletionSurfaceItem[],
): CompletionSurfaceQueryResult {
  if (Array.isArray(result)) {
    return { items: result as readonly CompletionSurfaceItem[], errors: [] }
  }
  if (result === null || typeof result !== 'object') {
    throw new TypeError('Completion registry must return items')
  }
  const queryResult = result as CompletionSurfaceQueryResult
  if (!Array.isArray(queryResult.items)) {
    throw new TypeError('Completion registry must return items')
  }
  return {
    items: queryResult.items,
    errors: queryResult.errors ?? [],
    modes: queryResult.modes,
    ...(queryResult.initialModeId === undefined
      ? {}
      : { initialModeId: queryResult.initialModeId }),
  }
}

function normalizeEdit(
  edit: CompletionSurfaceEdit,
  source: string,
): CompletionSurfaceEdit {
  if (edit === null || typeof edit !== 'object') {
    throw new TypeError('Completion apply result must be an edit')
  }
  if (
    !Number.isSafeInteger(edit.from) ||
    !Number.isSafeInteger(edit.to) ||
    edit.from < 0 ||
    edit.to < edit.from ||
    edit.to > source.length
  ) {
    throw new RangeError('Completion edit range must be inside the source')
  }
  if (typeof edit.insert !== 'string') {
    throw new TypeError('Completion edit insert must be a string')
  }
  if (
    edit.cursorOffset !== undefined &&
    (!Number.isSafeInteger(edit.cursorOffset) ||
      edit.cursorOffset < 0 ||
      edit.cursorOffset > edit.insert.length)
  ) {
    throw new RangeError('Completion edit cursorOffset must be inside insert')
  }
  return Object.freeze({
    from: edit.from,
    to: edit.to,
    insert: edit.insert,
    ...(edit.cursorOffset === undefined
      ? {}
      : { cursorOffset: edit.cursorOffset }),
  })
}

async function resolveEdit(
  item: CompletionSurfaceItem,
  context: CompletionSurfaceContext,
): Promise<CompletionSurfaceEdit> {
  if (!item.apply && item.insertText === undefined) {
    throw new TypeError('Completion item must provide insertText or apply')
  }
  const result = item.apply
    ? await item.apply(context)
    : {
        from: context.trigger.from,
        to: context.trigger.to,
        insert: item.insertText as string,
      }
  const edit =
    typeof result === 'string'
      ? {
          from: context.trigger.from,
          to: context.trigger.to,
          insert: result,
        }
      : result
  return normalizeEdit(edit, context.source)
}

class CompletionController {
  private readonly menu: HTMLDivElement
  private readonly popup: CaretPopup

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open) return
    if (
      this.composing ||
      event.isComposing ||
      event.keyCode === 229 ||
      this.view.composing
    ) {
      return
    }

    if (event.key === 'Tab' && this.modes.length > 1) {
      // Mode navigation belongs to the completion session. Preventing the
      // browser's default focus traversal keeps the CM6 caret and projection
      // focus untouched while the provider-owned mode changes.
      event.preventDefault()
      event.stopPropagation()
      this.moveMode(event.shiftKey ? -1 : 1)
      return
    }

    if (event.key === 'ArrowLeft' && this.level > 0) {
      event.preventDefault()
      event.stopPropagation()
      this.goBack()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      this.moveSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      this.moveSelection(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      void this.executeSelected()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.dismiss()
    }
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (
      this.optionFromEvent(event) !== undefined ||
      this.modeFromEvent(event) !== undefined ||
      this.backFromEvent(event)
    ) {
      // Mode and candidate buttons are popup controls, not editor focus
      // targets. Keep the CM6 caret in place while they are selected.
      event.preventDefault()
    }
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (this.backFromEvent(event)) {
      event.preventDefault()
      this.goBack()
      return
    }

    const modeId = this.modeFromEvent(event)
    if (modeId !== undefined) {
      event.preventDefault()
      this.selectMode(modeId)
      return
    }

    const index = this.optionFromEvent(event)
    if (index === undefined) return
    event.preventDefault()
    void this.execute(index)
  }

  private readonly onCompositionStart = (): void => {
    this.composing = true
    this.compositionEndPending = false
    this.invalidatePendingMutation()
    this.dismissedKey = undefined
    this.activeKey = undefined
    this.hide()
  }

  private readonly onCompositionEnd = (): void => {
    this.composing = false
    this.compositionEndPending = true
    this.syncFromEditor()
    this.reconcileCompositionEnd()
    // CM6 can settle the composition transaction after the DOM event. Use an
    // event-order microtask, never a fixed timeout, to re-evaluate the trigger.
    if (this.compositionEndPending) {
      queueMicrotask(() => {
        if (!this.destroyed) this.reconcileCompositionEnd()
      })
    }
  }

  private items: readonly CompletionSurfaceItem[] = []
  private rootItems: readonly CompletionSurfaceItem[] = []
  private errors: readonly { providerId: string; error: unknown }[] = []
  private modes: readonly CompletionSurfaceMode[] = []
  private activeModeId: string | undefined
  private selectedIndex = 0
  private level = 0
  private parentItem: CompletionSurfaceItem | undefined
  private childLoading = false
  private childGeneration = 0
  private currentTrigger: CompletionTrigger | undefined
  private activeKey: string | undefined
  private dismissedKey: string | undefined
  private refreshGeneration = 0
  private compositionEndPending = false
  private mutationGeneration = 0
  private pendingMutationToken: number | undefined
  private loading = false
  private open = false
  private composing = false
  private destroyed = false

  private readonly mutation: ProjectionMutationCapability | undefined

  constructor(
    private readonly view: EditorView,
    private readonly options: CompletionSurfaceOptions,
  ) {
    this.mutation =
      options.mutation ?? getProjectionMutationCapability(view.state)
    const document = view.dom.ownerDocument
    this.menu = document.createElement('div')
    this.menu.className = MENU_CLASS
    this.menu.dataset.completionMenu = 'true'
    this.menu.dataset.show = 'false'
    this.menu.hidden = true
    this.menu.setAttribute('role', 'listbox')
    this.menu.setAttribute('aria-label', 'Completions')
    this.menu.addEventListener('mousedown', this.onMouseDown)
    this.menu.addEventListener('click', this.onClick)
    view.dom.addEventListener('keydown', this.onKeyDown, true)
    view.dom.addEventListener('compositionstart', this.onCompositionStart)
    view.dom.addEventListener('compositionend', this.onCompositionEnd)
    view.dom.append(this.menu)
    this.popup = new CaretPopup(
      view,
      this.menu,
      () => this.currentTrigger?.to,
    )
    this.syncFromEditor()
  }

  get element(): HTMLElement {
    return this.menu
  }

  get isOpen(): boolean {
    return this.open
  }

  update(update: ViewUpdate): void {
    if (this.destroyed) return
    this.reconcileCompositionEnd()
    if (
      (update.docChanged || update.selectionSet) &&
      this.pendingMutationToken !== undefined
    ) {
      this.invalidatePendingMutation()
    }
    if (update.docChanged || update.selectionSet || update.focusChanged) {
      this.syncFromEditor()
    } else if (this.open && update.geometryChanged) {
      this.popup.reposition()
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.refreshGeneration += 1
    this.open = false
    this.invalidatePendingMutation()
    this.popup.destroy()
    this.view.dom.removeEventListener('keydown', this.onKeyDown, true)
    this.view.dom.removeEventListener('compositionstart', this.onCompositionStart)
    this.view.dom.removeEventListener('compositionend', this.onCompositionEnd)
    this.menu.removeEventListener('mousedown', this.onMouseDown)
    this.menu.removeEventListener('click', this.onClick)
    this.menu.remove()
  }

  private reconcileCompositionEnd(): void {
    if (
      !this.compositionEndPending ||
      this.composing ||
      this.view.composing
    ) {
      return
    }
    this.compositionEndPending = false
    this.syncFromEditor()
  }

  private syncFromEditor(): void {
    if (this.composing || this.view.composing) {
      this.hide()
      return
    }

    const trigger = findCompletionTrigger(this.view.state)
    if (!trigger) {
      this.currentTrigger = undefined
      this.activeKey = undefined
      this.dismissedKey = undefined
      this.rootItems = []
      this.items = []
      this.level = 0
      this.parentItem = undefined
      this.childLoading = false
      this.childGeneration += 1
      this.modes = []
      this.activeModeId = undefined
      this.hide()
      return
    }

    const source = this.view.state.doc.toString()
    const key = triggerKey(trigger, source)
    this.currentTrigger = trigger
    this.menu.dataset.triggerKind = trigger.kind
    if (this.dismissedKey === key) {
      this.hide()
      return
    }

    this.open = true
    if (this.activeKey !== key) {
      this.activeKey = key
      this.selectedIndex = 0
      this.refresh(trigger, source, key)
    } else {
      this.renderMenu()
    }
  }

  private refresh(
    trigger: CompletionTrigger,
    source: string,
    key: string,
  ): void {
    const generation = ++this.refreshGeneration
    this.childGeneration += 1
    this.items = []
    this.rootItems = []
    this.level = 0
    this.parentItem = undefined
    this.childLoading = false
    this.errors = []
    this.modes = []
    this.activeModeId = undefined
    this.loading = true
    this.renderMenu()

    const context: CompletionSurfaceContext = {
      source,
      cursor: trigger.to,
      trigger,
    }
    void Promise.resolve(this.options.registry.complete(context))
      .then((result) => normalizeResult(result))
      .then((result) => {
        if (
          this.destroyed ||
          generation !== this.refreshGeneration ||
          this.activeKey !== key ||
          !this.currentTrigger ||
          !this.isCurrentTrigger(this.currentTrigger)
        ) {
          return
        }
        if (!this.composing && !this.view.composing) this.open = true
        this.rootItems = result.items
        this.items = result.items
        this.level = 0
        this.parentItem = undefined
        this.childLoading = false
        this.errors = [...(result.errors ?? [])]
        this.modes = normalizeSurfaceModes(result.modes)
        const requestedMode = result.initialModeId
        this.activeModeId = this.modes.some((mode) => mode.id === requestedMode)
          ? requestedMode
          : this.modes[0]?.id
        this.loading = false
        this.selectedIndex = Math.min(
          this.selectedIndex,
          Math.max(0, this.items.length - 1),
        )
        this.renderMenu()
      })
      .catch((error: unknown) => {
        if (
          this.destroyed ||
          generation !== this.refreshGeneration ||
          this.activeKey !== key
        ) {
          return
        }
        this.rootItems = []
        this.items = []
        this.level = 0
        this.parentItem = undefined
        this.childLoading = false
        this.errors = [{ providerId: 'completion-registry', error }]
        this.loading = false
        this.renderMenu()
      })
  }

  private createContext(
    trigger: CompletionTrigger,
    source: string,
  ): CompletionSurfaceContext {
    const mode = this.modes.find((candidate) => candidate.id === this.activeModeId)
    return {
      source,
      cursor: trigger.to,
      trigger,
      ...(mode === undefined ? {} : { mode }),
    }
  }

  private isCurrentTrigger(trigger: CompletionTrigger): boolean {
    const current = findCompletionTrigger(this.view.state)
    return Boolean(
      current &&
        current.kind === trigger.kind &&
        current.from === trigger.from &&
        current.to === trigger.to &&
        current.query === trigger.query,
    )
  }

  private moveSelection(delta: number): void {
    if (this.items.length === 0) return
    const count = this.items.length
    this.selectedIndex = (this.selectedIndex + delta + count) % count
    this.renderMenu()
  }

  private moveMode(delta: number): void {
    if (this.modes.length < 2) return
    const currentIndex = Math.max(
      0,
      this.modes.findIndex((mode) => mode.id === this.activeModeId),
    )
    const nextIndex =
      (currentIndex + delta + this.modes.length) % this.modes.length
    this.activeModeId = this.modes[nextIndex]?.id
    this.resetToRoot()
    this.renderMenu()
  }

  private selectMode(modeId: string): void {
    if (!this.modes.some((mode) => mode.id === modeId)) return
    this.activeModeId = modeId
    this.resetToRoot()
    this.renderMenu()
  }

  private resetToRoot(): void {
    this.childGeneration += 1
    this.level = 0
    this.parentItem = undefined
    this.childLoading = false
    this.items = this.rootItems
    this.menu.scrollTop = 0
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.items.length - 1),
    )
  }

  private goBack(): void {
    if (this.level === 0) return
    this.resetToRoot()
    this.renderMenu()
  }

  private async executeSelected(): Promise<void> {
    if (this.items.length === 0) return
    await this.execute(this.selectedIndex)
  }

  private requireMutation(): ProjectionMutationCapability {
    if (!this.mutation) {
      throw new Error(
        'Completion surface is not bound to a live editable projection',
      )
    }
    return this.mutation
  }

  private beginMutation(): number {
    const token = ++this.mutationGeneration
    this.pendingMutationToken = token
    return token
  }

  private requireMutationToken(token: number): void {
    if (
      this.destroyed ||
      this.composing ||
      this.pendingMutationToken !== token ||
      this.mutationGeneration !== token
    ) {
      throw new Error('Completion mutation capability is no longer active')
    }
  }

  private consumeMutationToken(token: number): void {
    if (this.pendingMutationToken !== token) return
    this.pendingMutationToken = undefined
    this.mutationGeneration += 1
  }

  private invalidatePendingMutation(): void {
    this.pendingMutationToken = undefined
    this.mutationGeneration += 1
  }

  private snapshotForMutation(
    trigger: CompletionTrigger,
    source: string,
  ) {
    if (!this.isCurrentTrigger(trigger)) {
      throw new Error('Completion trigger is no longer active')
    }
    if (this.view.state.doc.toString() !== source) {
      throw new Error('Completion editor changed before apply')
    }
    const document = this.requireMutation().snapshot()
    if (projectMarkdownSource(document.markdown).projected !== source) {
      throw new Error('Completion editor is not synchronized with DocumentStore')
    }
    if (
      normalizeCompletionTriggers(source.slice(trigger.from, trigger.to)) !==
      triggerText(trigger)
    ) {
      throw new Error('Completion trigger no longer matches the source')
    }
    return document
  }

  private async execute(index: number): Promise<void> {
    const item = this.items[index]
    const trigger = this.currentTrigger
    if (!item || !trigger || !this.isCurrentTrigger(trigger)) return

    if (item.children) {
      await this.openChildren(item)
      return
    }
    await this.executeLeaf(item, trigger)
  }

  private async openChildren(item: CompletionSurfaceItem): Promise<void> {
    const trigger = this.currentTrigger
    if (!trigger || !this.isCurrentTrigger(trigger)) return

    const source = this.view.state.doc.toString()
    const context = this.createContext(trigger, source)
    const generation = ++this.childGeneration
    this.level = 1
    this.parentItem = item
    this.items = []
    this.selectedIndex = 0
    this.childLoading = true
    // A browser click can scroll the root menu to reveal a file candidate.
    // Child content has a different height, so carry-over scrollTop could put
    // the sticky mode bar over the only child option and make it unclickable.
    this.menu.scrollTop = 0
    this.renderMenu()

    try {
      const result = await item.children?.(context)
      if (
        this.destroyed ||
        generation !== this.childGeneration ||
        this.activeKey === undefined ||
        !this.isCurrentTrigger(trigger)
      ) {
        return
      }
      if (result !== null && result !== undefined && !Array.isArray(result)) {
        throw new TypeError('Completion children must be an array')
      }
      if (!result || result.length === 0) {
        this.resetToRoot()
        this.renderMenu()
        await this.executeLeaf(item, trigger)
        return
      }
      this.items = result
      this.childLoading = false
      this.selectedIndex = 0
      this.renderMenu()
    } catch (error) {
      if (
        this.destroyed ||
        generation !== this.childGeneration ||
        !this.isCurrentTrigger(trigger)
      ) {
        return
      }
      // Entity discovery is derived data. If it fails, preserve the existing
      // file candidate's ordinary insertion behavior instead of blocking it.
      this.resetToRoot()
      this.errors = [
        ...this.errors,
        { providerId: 'completion-children', error },
      ]
      this.renderMenu()
      await this.executeLeaf(item, trigger)
    }
  }

  private async executeLeaf(
    item: CompletionSurfaceItem,
    trigger: CompletionTrigger,
  ): Promise<void> {
    if (!this.isCurrentTrigger(trigger)) return
    const source = this.view.state.doc.toString()
    let mutationToken: number | undefined
    try {
      const document = this.snapshotForMutation(trigger, source)
      mutationToken = this.beginMutation()
      const context = this.createContext(trigger, source)
      this.hide()

      const edit = await resolveEdit(item, context)
      this.requireMutationToken(mutationToken)
      this.applyEdit(item, trigger, context, edit, document.revision, mutationToken)
    } catch (error) {
      if (!this.destroyed) this.menu.dataset.error = formatError(error)
    } finally {
      if (mutationToken !== undefined) {
        this.invalidatePendingMutation()
      }
    }
  }

  private applyEdit(
    item: CompletionSurfaceItem,
    trigger: CompletionTrigger,
    context: CompletionSurfaceContext,
    edit: CompletionSurfaceEdit,
    expectedRevision: Revision,
    mutationToken: number,
  ): void {
    this.requireMutationToken(mutationToken)
    const source = this.view.state.doc.toString()
    const document = this.snapshotForMutation(trigger, source)
    if (source !== context.source) {
      throw new Error('Completion editor changed before apply')
    }
    if (document.revision !== expectedRevision) {
      throw new Error('Completion source changed before apply')
    }

    const markdown =
      source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
    this.requireMutation().applyChange({
      markdown,
      origin: createDocumentOrigin('completion', item.id),
      expectedRevision,
    })
    this.consumeMutationToken(mutationToken)
    const cursorOffset = edit.cursorOffset ?? edit.insert.length
    const cursor = Math.min(edit.from + cursorOffset, this.view.state.doc.length)
    if (!this.destroyed) this.view.dispatch({ selection: { anchor: cursor } })
  }

  private modeFromEvent(event: MouseEvent): string | undefined {
    const target = event.target as HTMLElement | null
    const mode = target?.closest<HTMLElement>(MENU_MODE_SELECTOR)
    if (!mode || !this.menu.contains(mode)) return undefined
    const modeId = mode.dataset.completionModeId
    return modeId && this.modes.some((candidate) => candidate.id === modeId)
      ? modeId
      : undefined
  }

  private backFromEvent(event: MouseEvent): boolean {
    if (this.level === 0) return false
    const target = event.target as HTMLElement | null
    const back = target?.closest<HTMLElement>(MENU_BACK_SELECTOR)
    return Boolean(back && this.menu.contains(back))
  }

  private optionFromEvent(event: MouseEvent): number | undefined {
    const target = event.target as HTMLElement | null
    const option = target?.closest<HTMLElement>(MENU_OPTION_SELECTOR)
    if (!option || !this.menu.contains(option)) return undefined
    const index = Number(option.dataset.completionIndex)
    return Number.isSafeInteger(index) ? index : undefined
  }

  private renderMenu(): void {
    const document = this.menu.ownerDocument
    this.menu.replaceChildren()
    this.menu.dataset.show = this.open ? 'true' : 'false'
    this.menu.hidden = !this.open
    this.menu.toggleAttribute(
      'data-completion-loading',
      this.loading || this.childLoading,
    )
    this.menu.dataset.triggerKind = this.currentTrigger?.kind ?? ''
    this.menu.dataset.activeMode = this.activeModeId ?? ''
    this.menu.dataset.modeCount = String(this.modes.length)
    this.menu.dataset.completionLevel = String(this.level)
    this.menu.dataset.completionParentId = this.parentItem?.id ?? ''
    this.menu.removeAttribute('data-error')

    if (!this.open) {
      this.popup.hide()
      return
    }

    if (this.modes.length > 0) {
      const modeBar = document.createElement('div')
      modeBar.className = 'writeit-completion-menu__mode-selector'
      modeBar.setAttribute('role', 'tablist')
      modeBar.setAttribute('aria-label', 'Reference insertion mode')

      for (const [index, mode] of this.modes.entries()) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'writeit-completion-menu__mode'
        button.id = `writeit-completion-mode-${index}`
        button.dataset.completionModeId = mode.id
        button.dataset.completionMode = mode.id
        button.setAttribute('role', 'tab')
        button.setAttribute('aria-selected', String(mode.id === this.activeModeId))
        button.setAttribute('aria-label', mode.description
          ? `${mode.label}: ${mode.description}`
          : mode.label)
        button.title = mode.description ?? mode.label
        button.tabIndex = -1
        button.textContent = mode.label
        modeBar.append(button)
      }
      this.menu.append(modeBar)
    }

    if (this.level > 0) {
      const back = document.createElement('button')
      back.type = 'button'
      back.className = 'writeit-completion-menu__back'
      back.dataset.completionBack = 'true'
      back.setAttribute('aria-label', 'Back to file suggestions')
      back.tabIndex = -1
      back.textContent = `‹ ${this.parentItem?.label ?? 'Back'}`
      this.menu.append(back)
    }

    if (this.loading || this.childLoading) {
      const loading = document.createElement('div')
      loading.className = 'writeit-completion-menu__status'
      loading.dataset.completionLoading = 'true'
      loading.textContent = this.childLoading
        ? 'Loading entities…'
        : 'Loading suggestions…'
      this.menu.append(loading)
    } else if (this.items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'writeit-completion-menu__status'
      empty.setAttribute('role', 'status')
      empty.textContent = 'No suggestions'
      this.menu.append(empty)
    } else {
      for (const [index, item] of this.items.entries()) {
        const option = document.createElement('button')
        option.type = 'button'
        option.className = 'writeit-completion-menu__option'
        option.id = `writeit-completion-option-${index}`
        option.dataset.completionIndex = String(index)
        option.dataset.completionId = item.id
        option.dataset.completionKind = item.kind ?? ''
        option.dataset.completionEntityKind =
          item.kind === 'object' || item.kind === 'heading' || item.kind === 'file'
            ? item.kind
            : ''
        option.dataset.completionExpandable = item.children ? 'true' : 'false'
        option.classList.toggle(
          'writeit-completion-menu__option--directory',
          item.kind === 'directory',
        )
        option.classList.toggle(
          'writeit-completion-menu__option--entity',
          item.kind === 'object' || item.kind === 'heading' || item.kind === 'file',
        )
        option.setAttribute('role', 'option')
        option.setAttribute(
          'aria-selected',
          String(index === this.selectedIndex),
        )
        option.tabIndex = -1

        const label = document.createElement('span')
        label.className = 'writeit-completion-menu__label'
        label.textContent = item.label
        option.append(label)
        if (item.detail) {
          const detail = document.createElement('span')
          detail.className = 'writeit-completion-menu__detail'
          detail.textContent = item.detail
          option.append(detail)
        }
        this.menu.append(option)
      }
    }

    this.menu.setAttribute(
      'aria-activedescendant',
      this.items[this.selectedIndex]
        ? `writeit-completion-option-${this.selectedIndex}`
        : '',
    )
    if (this.errors.length > 0) {
      this.menu.dataset.error = this.errors
        .map((entry) => `${entry.providerId}: ${formatError(entry.error)}`)
        .join('; ')
    }
    this.popup.reposition()
    this.popup.ensureOptionVisible(
      this.menu.querySelector<HTMLElement>(
        `[data-completion-index="${this.selectedIndex}"]`,
      ),
    )
  }

  private hide(): void {
    this.open = false
    this.loading = false
    this.childLoading = false
    this.childGeneration += 1
    this.refreshGeneration += 1
    this.renderMenu()
  }

  private dismiss(): void {
    this.invalidatePendingMutation()
    if (this.currentTrigger) {
      this.dismissedKey = triggerKey(
        this.currentTrigger,
        this.view.state.doc.toString(),
      )
    }
    this.hide()
  }
}

export interface CompletionSurface {
  readonly element: HTMLElement
  readonly isOpen: boolean
  update(update: ViewUpdate): void
  destroy(): void
}

export function mountCompletionSurface(
  view: EditorView,
  options: CompletionSurfaceOptions,
): CompletionSurface {
  return new CompletionController(view, options)
}

/** Installs the anchored completion surface as a CM6 projection extension. */
export function createCompletionExtension(
  options: CompletionSurfaceOptions,
): Extension {
  return ViewPlugin.define(
    (view) => new CompletionController(view, options),
  )
}
