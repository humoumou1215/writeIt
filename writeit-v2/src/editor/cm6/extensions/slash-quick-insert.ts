import type { EditorState, Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import {
  createDocumentOrigin,
  DocumentStore,
  type DocumentLocator,
} from '../../../core/document'

export interface SlashQuickInsertRange {
  readonly from: number
  readonly to: number
}

export interface SlashQuickInsertReplacement {
  readonly text: string
  readonly cursorOffset?: number
}

export type SlashQuickInsertReplacementInput =
  | string
  | SlashQuickInsertReplacement

/**
 * This is intentionally a structural adapter contract. The editor layer does
 * not import the Application command registry; the application can provide
 * any registry with these discovery and execution operations.
 */
export interface SlashQuickInsertCommand {
  readonly id: string
  readonly label: string
  readonly group: string
  readonly keywords: readonly string[]
}

export interface SlashQuickInsertContext {
  readonly source: string
  readonly query: string
  readonly range: SlashQuickInsertRange
  readonly replace: (
    replacement: SlashQuickInsertReplacementInput,
  ) => void | Promise<void>
}

export interface SlashQuickInsertRegistry {
  list(): readonly SlashQuickInsertCommand[]
  isAvailable(
    id: string,
    context: SlashQuickInsertContext,
  ): boolean | Promise<boolean>
  execute(
    id: string,
    context: SlashQuickInsertContext,
  ): unknown | Promise<unknown>
}

export interface SlashTrigger {
  readonly from: number
  readonly to: number
  readonly query: string
}

export interface SlashQuickInsertExtensionOptions {
  readonly store: DocumentStore
  readonly locator: DocumentLocator
  readonly registry: SlashQuickInsertRegistry
}

const MENU_CLASS = 'writeit-slash-menu'
const MENU_OPTION_SELECTOR = '[data-quick-insert-index]'

function triggerKey(
  trigger: SlashTrigger,
  source: string,
): string {
  return `${trigger.from}:${trigger.to}:${trigger.query}:${source}`
}

/**
 * Finds a slash command token immediately before the primary cursor. A slash
 * must start a line or follow whitespace, so URLs and prose such as `a/b` do
 * not unexpectedly open the menu.
 */
export function findSlashTrigger(state: EditorState): SlashTrigger | undefined {
  const selection = state.selection.main
  if (!selection.empty) return undefined

  const line = state.doc.lineAt(selection.head)
  const beforeCursor = state.sliceDoc(line.from, selection.head)
  const match = /(^|[\s])\/([^\s]*)$/.exec(beforeCursor)
  if (!match) return undefined

  const slashOffset = match.index + match[0].indexOf('/')
  return Object.freeze({
    from: line.from + slashOffset,
    to: selection.head,
    query: match[2],
  })
}

function requireReplacement(
  replacement: SlashQuickInsertReplacementInput,
): SlashQuickInsertReplacement {
  if (typeof replacement === 'string') return { text: replacement }
  if (replacement === null || typeof replacement !== 'object') {
    throw new TypeError('Quick insert replacement must be a string or object')
  }
  if (typeof replacement.text !== 'string') {
    throw new TypeError('Quick insert replacement text must be a string')
  }
  if (
    replacement.cursorOffset !== undefined &&
    (!Number.isSafeInteger(replacement.cursorOffset) ||
      replacement.cursorOffset < 0 ||
      replacement.cursorOffset > replacement.text.length)
  ) {
    throw new RangeError(
      'Quick insert replacement cursorOffset must be inside the inserted text',
    )
  }
  return replacement
}

function formatError(error: unknown): string {
  try {
    const text = String(error)
    return text.length > 0 ? text : 'Quick insert command failed'
  } catch {
    return 'Quick insert command failed'
  }
}

class SlashQuickInsertController {
  private readonly menu: HTMLDivElement

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open) return

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
    if (this.optionFromEvent(event) !== undefined) {
      // Keep the CM6 cursor and focus in place while a button is selected.
      event.preventDefault()
    }
  }

  private readonly onClick = (event: MouseEvent): void => {
    const index = this.optionFromEvent(event)
    if (index === undefined) return
    event.preventDefault()
    void this.execute(index)
  }

  private commands: readonly SlashQuickInsertCommand[] = []

  private selectedIndex = 0

  private currentTrigger: SlashTrigger | undefined

  private dismissedKey: string | undefined

  private refreshGeneration = 0

  private open = false

  private destroyed = false

  constructor(
    private readonly view: EditorView,
    private readonly options: SlashQuickInsertExtensionOptions,
  ) {
    const document = view.dom.ownerDocument
    this.menu = document.createElement('div')
    this.menu.className = MENU_CLASS
    this.menu.dataset.slashMenu = 'true'
    this.menu.dataset.quickInsertMenu = 'true'
    this.menu.dataset.show = 'false'
    this.menu.hidden = true
    this.menu.setAttribute('role', 'listbox')
    this.menu.setAttribute('aria-label', 'Quick insert')
    this.menu.addEventListener('mousedown', this.onMouseDown)
    this.menu.addEventListener('click', this.onClick)
    view.dom.addEventListener('keydown', this.onKeyDown, true)
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
    this.menu.removeEventListener('mousedown', this.onMouseDown)
    this.menu.removeEventListener('click', this.onClick)
    this.menu.remove()
  }

  private syncFromEditor(): void {
    const trigger = findSlashTrigger(this.view.state)
    if (!trigger) {
      this.currentTrigger = undefined
      this.dismissedKey = undefined
      this.hide()
      return
    }

    const source = this.view.state.doc.toString()
    const key = triggerKey(trigger, source)
    const previousKey = this.open && this.currentTrigger
      ? triggerKey(this.currentTrigger, source)
      : undefined
    this.currentTrigger = trigger
    if (this.dismissedKey === key) {
      this.hide()
      return
    }

    this.open = true
    this.positionMenu()

    if (previousKey !== key || this.commands.length === 0) {
      this.selectedIndex = 0
      this.refreshCommands(trigger)
    } else {
      this.renderMenu()
    }
  }

  private refreshCommands(trigger: SlashTrigger): void {
    const generation = ++this.refreshGeneration
    const matching = this.options.registry
      .list()
      .filter((command) => this.matchesQuery(command, trigger.query))

    // Render synchronously for synchronous providers. Availability is then
    // resolved without making typing wait for an async provider.
    this.commands = matching
    this.renderMenu()

    const source = this.view.state.doc.toString()
    const context = this.createContext(trigger, source)
    void Promise.all(
      matching.map(async (command) => {
        try {
          return await this.options.registry.isAvailable(command.id, context)
        } catch {
          return false
        }
      }),
    ).then((availability) => {
      if (this.destroyed || generation !== this.refreshGeneration) return
      if (!this.currentTrigger || !this.isCurrentTrigger(trigger)) return
      this.commands = matching.filter((_, index) => availability[index])
      this.selectedIndex = Math.min(
        this.selectedIndex,
        Math.max(0, this.commands.length - 1),
      )
      this.renderMenu()
    })
  }

  private matchesQuery(
    command: SlashQuickInsertCommand,
    query: string,
  ): boolean {
    const normalizedQuery = query.normalize('NFKC').toLocaleLowerCase().trim()
    if (normalizedQuery.length === 0) return true
    return [command.id, command.label, command.group, ...command.keywords]
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  }

  private createContext(
    trigger: SlashTrigger,
    source: string,
    commandId?: string,
  ): SlashQuickInsertContext {
    return {
      source,
      query: trigger.query,
      range: Object.freeze({ from: trigger.from, to: trigger.to }),
      replace: (replacement) =>
        this.replaceTrigger(trigger, replacement, commandId),
    }
  }

  private replaceTrigger(
    trigger: SlashTrigger,
    replacementInput: SlashQuickInsertReplacementInput,
    commandId?: string,
  ): void {
    const replacement = requireReplacement(replacementInput)
    if (!this.isCurrentTrigger(trigger)) {
      throw new Error('Quick insert trigger is no longer active')
    }
    const document = this.options.store.get(this.options.locator)
    if (!document) throw new Error('Quick insert document is no longer loaded')

    const source = document.markdown
    if (this.view.state.doc.toString() !== source) {
      throw new Error('Quick insert editor is not synchronized with DocumentStore')
    }
    if (
      trigger.from < 0 ||
      trigger.to < trigger.from ||
      trigger.to > source.length
    ) {
      throw new RangeError('Quick insert trigger range is outside the source')
    }
    if (source.slice(trigger.from, trigger.to) !== `/${trigger.query}`) {
      throw new Error('Quick insert trigger no longer matches the source')
    }

    const markdown =
      source.slice(0, trigger.from) +
      replacement.text +
      source.slice(trigger.to)
    const next = this.options.store.applyChange(this.options.locator, {
      markdown,
      origin: createDocumentOrigin('command', commandId ?? 'quick-insert'),
      expectedRevision: document.revision,
    })

    const cursorOffset = replacement.cursorOffset ?? replacement.text.length
    const cursor = Math.min(
      trigger.from + cursorOffset,
      next.markdown.length,
    )
    this.view.dispatch({ selection: { anchor: cursor } })
  }

  private isCurrentTrigger(trigger: SlashTrigger): boolean {
    const current = findSlashTrigger(this.view.state)
    return Boolean(
      current &&
        current.from === trigger.from &&
        current.to === trigger.to &&
        current.query === trigger.query,
    )
  }

  private moveSelection(delta: number): void {
    if (this.commands.length === 0) return
    const count = this.commands.length
    this.selectedIndex = (this.selectedIndex + delta + count) % count
    this.renderMenu()
  }

  private async executeSelected(): Promise<void> {
    if (this.commands.length === 0) return
    await this.execute(this.selectedIndex)
  }

  private async execute(index: number): Promise<void> {
    const command = this.commands[index]
    const trigger = this.currentTrigger
    if (!command || !trigger || !this.isCurrentTrigger(trigger)) return

    const source = this.view.state.doc.toString()
    const context = this.createContext(trigger, source, command.id)
    this.hide()
    try {
      await this.options.registry.execute(command.id, context)
    } catch (error) {
      // A provider failure must not damage source or leave a stale menu open.
      // Keep the failure inspectable on the projection for diagnostics/tests.
      this.menu.dataset.error = formatError(error)
    }
  }

  private optionFromEvent(event: MouseEvent): number | undefined {
    const target = event.target as HTMLElement | null
    const option = target?.closest<HTMLElement>(MENU_OPTION_SELECTOR)
    if (!option || !this.menu.contains(option)) return undefined
    const index = Number(option.dataset.quickInsertIndex)
    return Number.isSafeInteger(index) ? index : undefined
  }

  private renderMenu(): void {
    const document = this.menu.ownerDocument
    this.menu.replaceChildren()
    this.menu.dataset.show = this.open ? 'true' : 'false'
    this.menu.hidden = !this.open
    this.menu.removeAttribute('data-error')

    if (!this.open) return

    if (this.commands.length === 0) {
      const group = document.createElement('div')
      group.className = 'writeit-slash-menu__group'
      group.dataset.commandGroup = 'Insert'
      const heading = document.createElement('div')
      heading.className = 'writeit-slash-menu__group-label'
      heading.textContent = 'Insert'
      group.append(heading)
      const empty = document.createElement('div')
      empty.className = 'writeit-slash-menu__empty'
      empty.setAttribute('role', 'status')
      empty.textContent = 'No commands found'
      group.append(empty)
      this.menu.append(group)
    } else {
      const groups = new Map<string, Array<[number, SlashQuickInsertCommand]>>()
      for (const [index, command] of this.commands.entries()) {
        const entries = groups.get(command.group) ?? []
        entries.push([index, command])
        groups.set(command.group, entries)
      }

      for (const [groupName, entries] of groups) {
        const group = document.createElement('div')
        group.className = 'writeit-slash-menu__group'
        group.dataset.commandGroup = groupName
        const heading = document.createElement('div')
        heading.className = 'writeit-slash-menu__group-label'
        heading.textContent = groupName
        group.append(heading)

        for (const [index, command] of entries) {
          const option = document.createElement('button')
          option.type = 'button'
          option.className = 'writeit-slash-menu__option'
          option.id = `writeit-slash-option-${index}`
          option.dataset.quickInsertIndex = String(index)
          option.dataset.commandId = command.id
          option.setAttribute('role', 'option')
          option.setAttribute(
            'aria-selected',
            String(index === this.selectedIndex),
          )
          option.tabIndex = -1
          option.textContent = command.label
          group.append(option)
        }
        this.menu.append(group)
      }
    }

    this.menu.setAttribute(
      'aria-activedescendant',
      this.commands[this.selectedIndex]
        ? `writeit-slash-option-${this.selectedIndex}`
        : '',
    )
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
    this.refreshGeneration += 1
    this.renderMenu()
  }

  private dismiss(): void {
    const trigger = this.currentTrigger
    if (trigger) {
      this.dismissedKey = triggerKey(trigger, this.view.state.doc.toString())
    }
    this.hide()
  }
}

export interface SlashQuickInsertSurface {
  readonly element: HTMLElement
  readonly isOpen: boolean
  update(update: ViewUpdate): void
  destroy(): void
}

export function mountSlashQuickInsertSurface(
  view: EditorView,
  options: SlashQuickInsertExtensionOptions,
): SlashQuickInsertSurface {
  return new SlashQuickInsertController(view, options)
}

/**
 * Installs the slash menu as a CM6 projection extension. It observes editor
 * transactions for trigger/UI state, while actual command replacements go
 * through DocumentStore and are fanned back into CM6 by the normal projection
 * synchronization path.
 */
export function createSlashQuickInsertExtension(
  options: SlashQuickInsertExtensionOptions,
): Extension {
  return ViewPlugin.define(
    (view) => new SlashQuickInsertController(view, options),
  )
}
