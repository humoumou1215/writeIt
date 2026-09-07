import type { EditorState, Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import {
  createDocumentOrigin,
  DocumentStore,
  type DocumentLocator,
} from '../../../core/document'

export type CompletionTriggerKind = '@' | '[[' | '![['

export interface CompletionTrigger {
  readonly kind: CompletionTriggerKind
  readonly from: number
  readonly to: number
  readonly query: string
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
}

export interface CompletionSurfaceEdit {
  readonly from: number
  readonly to: number
  readonly insert: string
  readonly cursorOffset?: number
}

export type CompletionSurfaceApplyResult = CompletionSurfaceEdit | string

export interface CompletionSurfaceItem {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly keywords?: readonly string[]
  readonly insertText?: string
  readonly apply?: (
    context: CompletionSurfaceContext,
  ) => CompletionSurfaceApplyResult | Promise<CompletionSurfaceApplyResult>
}

export interface CompletionSurfaceQueryResult {
  readonly items: readonly CompletionSurfaceItem[]
  readonly errors?: readonly {
    readonly providerId: string
    readonly error: unknown
  }[]
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
  readonly store: DocumentStore
  readonly locator: DocumentLocator
  readonly registry: CompletionSurfaceRegistry
}

const MENU_CLASS = 'writeit-completion-menu'
const MENU_OPTION_SELECTOR = '[data-completion-index]'

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

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open || event.isComposing || event.keyCode === 229) return

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
    if (this.optionFromEvent(event) !== undefined) event.preventDefault()
  }

  private readonly onClick = (event: MouseEvent): void => {
    const index = this.optionFromEvent(event)
    if (index === undefined) return
    event.preventDefault()
    void this.execute(index)
  }

  private readonly onCompositionStart = (): void => {
    this.composing = true
    this.hide()
  }

  private readonly onCompositionEnd = (): void => {
    this.composing = false
    this.syncFromEditor()
    // CM6 may finish its composition transaction after the DOM event. A
    // microtask re-check is event ordering, not a state synchronization delay.
    if (this.view.composing) {
      queueMicrotask(() => {
        if (!this.destroyed) this.syncFromEditor()
      })
    }
  }

  private items: readonly CompletionSurfaceItem[] = []
  private errors: readonly { providerId: string; error: unknown }[] = []
  private selectedIndex = 0
  private currentTrigger: CompletionTrigger | undefined
  private activeKey: string | undefined
  private dismissedKey: string | undefined
  private refreshGeneration = 0
  private loading = false
  private open = false
  private composing = false
  private destroyed = false

  constructor(
    private readonly view: EditorView,
    private readonly options: CompletionSurfaceOptions,
  ) {
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
    if (update.docChanged || update.selectionSet || update.focusChanged) {
      this.syncFromEditor()
    } else if (this.open && update.geometryChanged) {
      this.positionMenu()
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.refreshGeneration += 1
    this.open = false
    this.view.dom.removeEventListener('keydown', this.onKeyDown, true)
    this.view.dom.removeEventListener('compositionstart', this.onCompositionStart)
    this.view.dom.removeEventListener('compositionend', this.onCompositionEnd)
    this.menu.removeEventListener('mousedown', this.onMouseDown)
    this.menu.removeEventListener('click', this.onClick)
    this.menu.remove()
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
    this.positionMenu()
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
    this.items = []
    this.errors = []
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
        this.items = result.items
        this.errors = [...(result.errors ?? [])]
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
        this.items = []
        this.errors = [{ providerId: 'completion-registry', error }]
        this.loading = false
        this.renderMenu()
      })
  }

  private createContext(
    trigger: CompletionTrigger,
    source: string,
  ): CompletionSurfaceContext {
    return { source, cursor: trigger.to, trigger }
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

  private async executeSelected(): Promise<void> {
    if (this.items.length === 0) return
    await this.execute(this.selectedIndex)
  }

  private async execute(index: number): Promise<void> {
    const item = this.items[index]
    const trigger = this.currentTrigger
    if (!item || !trigger || !this.isCurrentTrigger(trigger)) return

    const source = this.view.state.doc.toString()
    const context = this.createContext(trigger, source)
    this.hide()

    try {
      const edit = await resolveEdit(item, context)
      this.applyEdit(item, trigger, context, edit)
    } catch (error) {
      this.menu.dataset.error = formatError(error)
    }
  }

  private applyEdit(
    item: CompletionSurfaceItem,
    trigger: CompletionTrigger,
    context: CompletionSurfaceContext,
    edit: CompletionSurfaceEdit,
  ): void {
    if (!this.isCurrentTrigger(trigger)) {
      throw new Error('Completion trigger is no longer active')
    }

    const source = this.view.state.doc.toString()
    if (source !== context.source) {
      throw new Error('Completion editor changed before apply')
    }
    const document = this.options.store.get(this.options.locator)
    if (!document) throw new Error('Completion document is no longer loaded')
    if (document.markdown !== source) {
      throw new Error('Completion editor is not synchronized with DocumentStore')
    }
    if (
      normalizeCompletionTriggers(source.slice(trigger.from, trigger.to)) !==
      triggerText(trigger)
    ) {
      throw new Error('Completion trigger no longer matches the source')
    }

    const markdown =
      source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
    const next = this.options.store.applyChange(this.options.locator, {
      markdown,
      origin: createDocumentOrigin('completion', item.id),
      expectedRevision: document.revision,
    })
    const cursorOffset = edit.cursorOffset ?? edit.insert.length
    const cursor = Math.min(edit.from + cursorOffset, next.markdown.length)
    this.view.dispatch({ selection: { anchor: cursor } })
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
    this.menu.toggleAttribute('data-completion-loading', this.loading)
    this.menu.dataset.triggerKind = this.currentTrigger?.kind ?? ''
    this.menu.removeAttribute('data-error')

    if (!this.open) return

    if (this.loading) {
      const loading = document.createElement('div')
      loading.className = 'writeit-completion-menu__status'
      loading.dataset.completionLoading = 'true'
      loading.textContent = 'Loading suggestions…'
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
  }

  private positionMenu(): void {
    if (!this.open) return

    const menuRect = this.view.dom.getBoundingClientRect()
    let left = 8
    let top = 8
    if (this.currentTrigger) {
      try {
        const coords = this.view.coordsAtPos(this.currentTrigger.from)
        if (coords) {
          left = Math.max(8, coords.left - menuRect.left)
          top = Math.max(8, coords.bottom - menuRect.top + 4)
        }
      } catch {
        // CM6 can be between construction and layout in jsdom/initial render.
      }
    }
    this.menu.style.left = `${left}px`
    this.menu.style.top = `${top}px`
  }

  private hide(): void {
    this.open = false
    this.loading = false
    this.refreshGeneration += 1
    this.renderMenu()
  }

  private dismiss(): void {
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
