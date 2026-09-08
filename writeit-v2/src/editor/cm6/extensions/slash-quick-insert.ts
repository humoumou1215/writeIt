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

export interface SlashQuickInsertCommandGroup {
  readonly group: string
  readonly commands: readonly SlashQuickInsertCommand[]
}

function normalizeSlashSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

export function matchesSlashQuickInsertQuery(
  command: SlashQuickInsertCommand,
  query: string,
): boolean {
  const normalizedQuery = normalizeSlashSearchText(query.trim())
  if (normalizedQuery.length === 0) return true
  return normalizeSlashSearchText(
    [command.id, command.label, command.group, ...command.keywords].join(' '),
  ).includes(normalizedQuery)
}

export function filterSlashQuickInsertCommands(
  commands: readonly SlashQuickInsertCommand[],
  query: string,
): readonly SlashQuickInsertCommand[] {
  return commands.filter((command) =>
    matchesSlashQuickInsertQuery(command, query),
  )
}

/**
 * Groups an already filtered command list without sorting it. Map insertion
 * order preserves provider registration order, and command order within each
 * group remains the registry order.
 */
export function groupSlashQuickInsertCommands(
  commands: readonly SlashQuickInsertCommand[],
): readonly SlashQuickInsertCommandGroup[] {
  const groups = new Map<string, SlashQuickInsertCommand[]>()
  for (const command of commands) {
    const entries = groups.get(command.group) ?? []
    entries.push(command)
    groups.set(command.group, entries)
  }

  return Object.freeze(
    [...groups].map(([group, entries]) =>
      Object.freeze({
        group,
        commands: Object.freeze([...entries]),
      }),
    ),
  )
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
  readonly registry: SlashQuickInsertRegistry
  /** Optional for direct surface mounts; SingleDocumentView injects it via CM6. */
  readonly mutation?: ProjectionMutationCapability
}

const MENU_CLASS = 'writeit-slash-menu'
const MENU_OPTION_SELECTOR = '[data-quick-insert-index]'
const MENU_GROUP_SELECTOR = '[data-quick-insert-group-selector]'

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

    if (event.key === 'Tab') {
      // Group navigation is owned by the open popup. Keep Tab from moving
      // focus out of the CM6 projection while a quick-insert session is live.
      event.preventDefault()
      event.stopPropagation()
      this.moveGroup(event.shiftKey ? -1 : 1)
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
      this.groupFromEvent(event) !== undefined
    ) {
      // Keep the CM6 cursor and focus in place while a popup control is
      // selected. The click handler still receives the ensuing click event.
      event.preventDefault()
    }
  }

  private readonly onClick = (event: MouseEvent): void => {
    const groupIndex = this.groupFromEvent(event)
    if (groupIndex !== undefined) {
      event.preventDefault()
      this.selectGroup(groupIndex)
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
    this.hide()
  }

  private readonly onCompositionEnd = (): void => {
    this.composing = false
    this.compositionEndPending = true
    this.syncFromEditor()
    this.reconcileCompositionEnd()
    // The DOM compositionend can precede CM6's composition transaction. A
    // microtask re-checks the settled editor state without inventing a timer
    // as a synchronization protocol.
    if (this.compositionEndPending) {
      queueMicrotask(() => {
        if (!this.destroyed) this.reconcileCompositionEnd()
      })
    }
  }

  private commands: readonly SlashQuickInsertCommand[] = []

  private groups: readonly SlashQuickInsertCommandGroup[] = []

  private activeGroup: string | undefined

  /** Index within the active group, never within another group's commands. */
  private selectedIndex = 0

  private currentTrigger: SlashTrigger | undefined

  private dismissedKey: string | undefined

  private refreshGeneration = 0

  private compositionEndPending = false

  private mutationGeneration = 0

  private pendingMutationToken: number | undefined

  private open = false

  private composing = false

  private destroyed = false

  private readonly mutation: ProjectionMutationCapability | undefined

  constructor(
    private readonly view: EditorView,
    private readonly options: SlashQuickInsertExtensionOptions,
  ) {
    this.mutation =
      options.mutation ?? getProjectionMutationCapability(view.state)
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

    if (previousKey !== key || this.commands.length === 0) {
      // A newly opened session starts at the first registered group. While a
      // query changes, retain the active group when it still has matches so a
      // global filter does not unexpectedly move the user's context.
      this.refreshCommands(trigger, previousKey === undefined)
    } else {
      this.renderMenu()
    }
  }

  private refreshCommands(
    trigger: SlashTrigger,
    resetGroup: boolean,
  ): void {
    const generation = ++this.refreshGeneration
    const matching = filterSlashQuickInsertCommands(
      this.options.registry.list(),
      trigger.query,
    )

    // Render synchronously for synchronous providers. Availability is then
    // resolved without making typing wait for an async provider.
    this.commands = matching
    this.updateGroups(resetGroup)
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
      if (!this.composing && !this.view.composing) this.open = true
      this.commands = matching.filter((_, index) => availability[index])
      this.updateGroups(false)
      this.renderMenu()
    })
  }

  private updateGroups(resetGroup: boolean): void {
    const previousGroup = resetGroup ? undefined : this.activeGroup
    this.groups = groupSlashQuickInsertCommands(this.commands)
    const nextGroup = this.groups.find(
      (group) => group.group === previousGroup,
    ) ?? this.groups[0]
    const groupChanged = nextGroup?.group !== this.activeGroup
    this.activeGroup = nextGroup?.group

    if (resetGroup || groupChanged) {
      this.selectedIndex = 0
      return
    }

    const commandCount = nextGroup?.commands.length ?? 0
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, commandCount - 1),
    )
  }

  private activeGroupEntries(): readonly SlashQuickInsertCommand[] {
    return (
      this.groups.find((group) => group.group === this.activeGroup)?.commands ??
      []
    )
  }

  private createContext(
    trigger: SlashTrigger,
    source: string,
    commandId?: string,
    expectedRevision?: Revision,
    mutationToken?: number,
  ): SlashQuickInsertContext {
    return {
      source,
      query: trigger.query,
      range: Object.freeze({ from: trigger.from, to: trigger.to }),
      replace: (replacement) =>
        this.replaceTrigger(
          trigger,
          replacement,
          commandId,
          expectedRevision,
          mutationToken,
        ),
    }
  }

  private requireMutation(): ProjectionMutationCapability {
    if (!this.mutation) {
      throw new Error(
        'Quick insert surface is not bound to a live editable projection',
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
      throw new Error('Quick insert mutation capability is no longer active')
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
    trigger: SlashTrigger,
    source: string,
  ) {
    if (!this.isCurrentTrigger(trigger)) {
      throw new Error('Quick insert trigger is no longer active')
    }
    if (this.view.state.doc.toString() !== source) {
      throw new Error('Quick insert editor changed before apply')
    }
    const document = this.requireMutation().snapshot()
    if (projectMarkdownSource(document.markdown).projected !== source) {
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
    return document
  }

  private replaceTrigger(
    trigger: SlashTrigger,
    replacementInput: SlashQuickInsertReplacementInput,
    commandId?: string,
    expectedRevision?: Revision,
    mutationToken?: number,
  ): void {
    const replacement = requireReplacement(replacementInput)
    if (mutationToken === undefined || expectedRevision === undefined) {
      throw new Error('Quick insert mutation capability is not active')
    }
    this.requireMutationToken(mutationToken)
    const source = this.view.state.doc.toString()
    const document = this.snapshotForMutation(trigger, source)
    if (document.revision !== expectedRevision) {
      throw new Error('Quick insert source changed before apply')
    }

    const markdown =
      source.slice(0, trigger.from) +
      replacement.text +
      source.slice(trigger.to)
    this.requireMutation().applyChange({
      markdown,
      origin: createDocumentOrigin('command', commandId ?? 'quick-insert'),
      expectedRevision,
    })
    this.consumeMutationToken(mutationToken)

    const cursorOffset = replacement.cursorOffset ?? replacement.text.length
    const cursor = Math.min(
      trigger.from + cursorOffset,
      this.view.state.doc.length,
    )
    if (!this.destroyed) this.view.dispatch({ selection: { anchor: cursor } })
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
    const commands = this.activeGroupEntries()
    if (commands.length === 0) return
    this.selectedIndex =
      (this.selectedIndex + delta + commands.length) % commands.length
    this.renderMenu()
  }

  private moveGroup(delta: number): void {
    if (this.groups.length === 0) return
    const currentIndex = Math.max(
      0,
      this.groups.findIndex((group) => group.group === this.activeGroup),
    )
    const nextIndex =
      (currentIndex + delta + this.groups.length) % this.groups.length
    this.activeGroup = this.groups[nextIndex]?.group
    this.selectedIndex = 0
    this.renderMenu()
  }

  private selectGroup(index: number): void {
    const group = this.groups[index]
    if (!group) return
    this.activeGroup = group.group
    this.selectedIndex = 0
    this.renderMenu()
  }

  private async executeSelected(): Promise<void> {
    const command = this.activeGroupEntries()[this.selectedIndex]
    if (!command) return
    const index = this.commands.indexOf(command)
    if (index < 0) return
    await this.execute(index)
  }

  private async execute(index: number): Promise<void> {
    const command = this.commands[index]
    const trigger = this.currentTrigger
    if (
      !command ||
      !trigger ||
      !this.isCurrentTrigger(trigger) ||
      !this.activeGroupEntries().includes(command)
    ) {
      return
    }

    const source = this.view.state.doc.toString()
    let mutationToken: number | undefined
    try {
      const document = this.snapshotForMutation(trigger, source)
      mutationToken = this.beginMutation()
      const context = this.createContext(
        trigger,
        source,
        command.id,
        document.revision,
        mutationToken,
      )
      this.hide()
      await this.options.registry.execute(command.id, context)
    } catch (error) {
      // A provider failure must not damage source or leave a stale menu open.
      // Keep the failure inspectable on the projection for diagnostics/tests.
      if (!this.destroyed) this.menu.dataset.error = formatError(error)
    } finally {
      if (mutationToken !== undefined) {
        this.invalidatePendingMutation()
      }
    }
  }

  private optionFromEvent(event: MouseEvent): number | undefined {
    const target = event.target as HTMLElement | null
    const option = target?.closest<HTMLElement>(MENU_OPTION_SELECTOR)
    if (!option || !this.menu.contains(option)) return undefined
    const index = Number(option.dataset.quickInsertIndex)
    return Number.isSafeInteger(index) ? index : undefined
  }

  private groupFromEvent(event: MouseEvent): number | undefined {
    const target = event.target as HTMLElement | null
    const selector = target?.closest<HTMLElement>(MENU_GROUP_SELECTOR)
    if (!selector || !this.menu.contains(selector)) return undefined
    const groupName = selector.dataset.commandGroup
    if (!groupName) return undefined
    const index = this.groups.findIndex((group) => group.group === groupName)
    return index >= 0 ? index : undefined
  }

  private renderMenu(): void {
    const document = this.menu.ownerDocument
    this.menu.replaceChildren()
    this.menu.dataset.show = this.open ? 'true' : 'false'
    this.menu.hidden = !this.open
    this.menu.dataset.activeGroup = this.activeGroup ?? ''
    this.menu.dataset.groupCount = String(this.groups.length)
    this.menu.removeAttribute('data-error')

    if (!this.open) {
      this.popup.hide()
      return
    }

    if (this.groups.length === 0) {
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
      const groupSelectorBar = document.createElement('div')
      groupSelectorBar.className = 'writeit-slash-menu__group-selector-bar'
      groupSelectorBar.setAttribute('role', 'tablist')
      groupSelectorBar.setAttribute('aria-label', 'Quick insert groups')

      for (const [index, group] of this.groups.entries()) {
        const selector = document.createElement('button')
        selector.type = 'button'
        selector.className = 'writeit-slash-menu__group-selector'
        selector.id = `writeit-slash-group-selector-${index}`
        selector.dataset.quickInsertGroupSelector = 'true'
        selector.dataset.commandGroup = group.group
        selector.setAttribute('role', 'tab')
        selector.setAttribute(
          'aria-selected',
          String(group.group === this.activeGroup),
        )
        selector.setAttribute(
          'aria-controls',
          `writeit-slash-group-content-${index}`,
        )
        selector.tabIndex = -1
        selector.textContent = group.group
        groupSelectorBar.append(selector)
      }
      this.menu.append(groupSelectorBar)

      const activeGroupIndex = this.groups.findIndex(
        (group) => group.group === this.activeGroup,
      )
      const activeGroup = this.groups[activeGroupIndex]
      if (activeGroup) {
        const group = document.createElement('div')
        group.className = 'writeit-slash-menu__group'
        group.id = `writeit-slash-group-content-${activeGroupIndex}`
        group.dataset.commandGroup = activeGroup.group
        group.dataset.quickInsertGroupContent = 'true'
        group.setAttribute('role', 'tabpanel')
        group.setAttribute(
          'aria-labelledby',
          `writeit-slash-group-selector-${activeGroupIndex}`,
        )
        const heading = document.createElement('div')
        heading.className = 'writeit-slash-menu__group-label'
        heading.textContent = activeGroup.group
        group.append(heading)

        for (const [localIndex, command] of activeGroup.commands.entries()) {
          const index = this.commands.indexOf(command)
          const option = document.createElement('button')
          option.type = 'button'
          option.className = 'writeit-slash-menu__option'
          option.id = `writeit-slash-option-${index}`
          option.dataset.quickInsertIndex = String(index)
          option.dataset.commandId = command.id
          option.setAttribute('role', 'option')
          option.setAttribute(
            'aria-selected',
            String(localIndex === this.selectedIndex),
          )
          option.tabIndex = -1
          option.textContent = command.label
          group.append(option)
        }
        this.menu.append(group)
      }
    }

    const selectedCommand = this.activeGroupEntries()[this.selectedIndex]
    const selectedIndex = selectedCommand
      ? this.commands.indexOf(selectedCommand)
      : -1
    this.menu.setAttribute(
      'aria-activedescendant',
      selectedIndex >= 0 ? `writeit-slash-option-${selectedIndex}` : '',
    )
    this.popup.reposition()
    this.popup.ensureOptionVisible(
      selectedIndex >= 0
        ? this.menu.querySelector<HTMLElement>(
            `[data-quick-insert-index="${selectedIndex}"]`,
          )
        : undefined,
    )
  }

  private hide(): void {
    this.open = false
    this.refreshGeneration += 1
    this.renderMenu()
  }

  private dismiss(): void {
    this.invalidatePendingMutation()
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
