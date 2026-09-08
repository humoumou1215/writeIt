import {
  StateEffect,
  type Extension,
  type Range,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import {
  createDocumentOrigin,
  type Revision,
} from '../../../core/document'
import {
  createUnknownReferenceHealth,
  type ReferenceHealthFact,
  type ReferenceHealthService,
  type ReferenceHealthStatus,
} from '../../../core/reference'
import {
  createReferenceOpenRequest,
  createReferenceReselectRequest,
  decideReferenceNavigation,
  findReferenceAtOffset,
  type ReferenceNavigationRequest,
} from '../../../core/reference'
import {
  createWorkspacePath,
} from '../../../core/workspace'
import type { WorkspacePath } from '../../../core/workspace'
import {
  getProjectionMutationCapability,
  type ProjectionMutationCapability,
} from '../projection/mutation-capability'
import { projectMarkdownSource } from '../projection/source-fidelity'
import { stringifyReference } from '../../../core/reference'

export type ReferenceHealthQuery = (
  sourcePath: WorkspacePath,
  source: string,
) => readonly ReferenceHealthFact[] | PromiseLike<readonly ReferenceHealthFact[]>

export interface ReferenceHealthResolverLike {
  resolveSource?: ReferenceHealthQuery
  resolve?: ReferenceHealthQuery
  /** Optional invalidation stream for workspace/content changes. */
  subscribe?: unknown
}

export interface ReferenceReselectionCandidate {
  readonly id?: string
  readonly path: WorkspacePath | string
  readonly label?: string
  readonly detail?: string
  readonly fragment?: string | null
}

export type ReferenceReselectionProvider = (
  request: ReturnType<typeof createReferenceReselectRequest>,
) =>
  | readonly ReferenceReselectionCandidate[]
  | PromiseLike<readonly ReferenceReselectionCandidate[]>

export interface ReferenceNavigationExtensionOptions {
  /** Current source path; a function is useful for an application shell. */
  readonly sourcePath?: WorkspacePath | string | null
  readonly getSourcePath?: () => WorkspacePath | string | null | undefined
  /** Preferred health query; it must return facts for the current source. */
  readonly resolveReferences?: ReferenceHealthQuery
  readonly healthResolver?: ReferenceHealthQuery | ReferenceHealthResolverLike
  readonly resolver?: ReferenceHealthQuery | ReferenceHealthResolverLike
  readonly health?: ReferenceHealthService | ReferenceHealthResolverLike
  /** Open callbacks receive a canonical path first for easy application wiring. */
  readonly onOpen?: (
    path: WorkspacePath,
    fragment: string | null,
    request: ReturnType<typeof createReferenceOpenRequest>,
  ) => void | PromiseLike<void>
  /** Object-shaped callback for callers that prefer one navigation payload. */
  readonly onOpenRequest?: (
    request: ReturnType<typeof createReferenceOpenRequest>,
  ) => void | PromiseLike<void>
  readonly onNavigate?: (
    request: ReferenceNavigationRequest,
  ) => void | PromiseLike<void>
  /** Called for every broken/unknown reference before optional picker UI. */
  readonly onReselect?: (
    request: ReturnType<typeof createReferenceReselectRequest>,
  ) => void | PromiseLike<void>
  readonly onReselectRequest?: (
    request: ReturnType<typeof createReferenceReselectRequest>,
  ) => void | PromiseLike<void>
  readonly onReselectPath?: (
    path: string,
  ) => void | PromiseLike<void>
  /** Optional source-preserving picker for broken references. */
  readonly reselectProvider?: ReferenceReselectionProvider
  readonly getReselectionCandidates?: ReferenceReselectionProvider
  /** Injected by SingleDocumentView; direct mounts can provide it explicitly. */
  readonly mutation?: ProjectionMutationCapability
  readonly tooltip?: boolean
}

interface ReselectionItem extends ReferenceReselectionCandidate {
  readonly id: string
  readonly path: WorkspacePath
  readonly label: string
}

interface ReferenceFactsEffect {
  readonly generation: number
  readonly source: string
  readonly facts: readonly ReferenceHealthFact[]
}

const setReferenceFactsEffect = StateEffect.define<ReferenceFactsEffect>()
const REFERENCE_MARK_SELECTOR = '[data-writeit-reference]'
const RESELECT_MENU_SELECTOR = '[data-reference-reselect-index]'
let tooltipSequence = 0

function formatError(error: unknown): string {
  try {
    const text = String(error)
    return text.length > 0 ? text : 'Reference health failed'
  } catch {
    return 'Reference health failed'
  }
}

function normalizeSourcePath(
  options: ReferenceNavigationExtensionOptions,
): WorkspacePath | undefined {
  const value = options.getSourcePath
    ? options.getSourcePath()
    : options.sourcePath
  if (value === null || value === undefined || value === '') return undefined
  try {
    const path = createWorkspacePath(value)
    return path === '' ? undefined : path
  } catch {
    return undefined
  }
}

function healthSubscriptionFromOptions(
  options: ReferenceNavigationExtensionOptions,
): ((listener: () => void) => () => void) | undefined {
  const candidate =
    options.healthResolver ?? options.resolver ?? options.health
  if (!candidate || typeof candidate === 'function') return undefined
  const subscribe = (candidate as { readonly subscribe?: unknown }).subscribe
  if (typeof subscribe !== 'function') return undefined
  return (listener) =>
    (subscribe as (listener: () => void) => () => void).call(candidate, listener)
}

function resolverFromOptions(
  options: ReferenceNavigationExtensionOptions,
): ReferenceHealthQuery | undefined {
  if (options.resolveReferences) return options.resolveReferences
  const candidate =
    options.healthResolver ?? options.resolver ?? options.health
  if (!candidate) return undefined
  if (typeof candidate === 'function') return candidate
  if (typeof candidate.resolveSource === 'function') {
    return candidate.resolveSource.bind(candidate)
  }
  if ('resolve' in candidate && typeof candidate.resolve === 'function') {
    return candidate.resolve.bind(candidate)
  }
  return undefined
}

function unknownFacts(
  sourcePath: WorkspacePath | undefined,
  source: string,
): readonly ReferenceHealthFact[] {
  // A detached surface has no valid workspace identity. Keep its facts
  // diagnosable without claiming that a real workspace file was checked.
  return createUnknownReferenceHealth(
    sourcePath ?? ('unknown-reference-source.md' as WorkspacePath),
    source,
  )
}

function statusClass(status: ReferenceHealthStatus): string {
  if (status === 'resolved') return 'cm-writeit-reference--resolved'
  if (status === 'unknown') return 'cm-writeit-reference--unknown'
  return 'cm-writeit-reference--broken'
}

function statusLabel(fact: ReferenceHealthFact): string {
  if (fact.status === 'resolved') return 'resolved'
  if (fact.status === 'unknown') return 'not checked'
  return `broken: ${fact.status}`
}

function referenceMark(fact: ReferenceHealthFact): Decoration {
  const classes = [
    'cm-writeit-reference',
    fact.reference.kind === 'embed' ? 'cm-writeit-reference-embed' : 'cm-writeit-reference-link',
    statusClass(fact.status),
    fact.broken ? 'cm-writeit-reference-broken ref-broken' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return Decoration.mark({
    class: classes,
    attributes: {
      'data-writeit-reference': 'true',
      'data-reference-id': fact.id,
      'data-reference-status': fact.status,
      'data-reference-health': fact.status,
      'data-reference-broken': String(fact.broken),
      'data-reference-path': fact.targetPath ?? fact.reference.path,
      'aria-label': `${fact.raw} (${statusLabel(fact)})`,
    },
  })
}

function buildReferenceDecorations(
  source: string,
  facts: readonly ReferenceHealthFact[],
): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const fact of facts) {
    if (
      fact.from < 0 ||
      fact.to <= fact.from ||
      fact.to > source.length ||
      source.slice(fact.from, fact.to) !== fact.raw
    ) {
      continue
    }
    ranges.push({
      from: fact.from,
      to: fact.to,
      value: referenceMark(fact),
    })
  }
  return ranges.length === 0 ? Decoration.none : Decoration.set(ranges, true)
}

function tooltipText(fact: ReferenceHealthFact): string {
  if (fact.status !== 'resolved') {
    return `⚠️ ${fact.message ?? `Reference is ${fact.status}`}. Click to reselect.`
  }
  const target = fact.targetPath ?? fact.reference.path
  if (fact.fragmentTarget?.kind === 'object') {
    return `🔗 ${fact.fragmentTarget.label} (${target}) — click to jump.`
  }
  if (fact.reference.fragment !== null) {
    return `📄 ${target} — click to jump to “${fact.reference.fragment}”.`
  }
  return `📄 ${target} — click to open.`
}

function elementFromTarget(
  target: EventTarget | null,
): HTMLElement | undefined {
  if (!target) return undefined
  const value = target as {
    closest?: (selector: string) => Element | null
    parentElement?: HTMLElement | null
  }
  if (typeof value.closest === 'function') {
    return value.closest(REFERENCE_MARK_SELECTOR) as HTMLElement | null ?? undefined
  }
  return value.parentElement ?? undefined
}

function normalizeReselectionItems(
  values: readonly ReferenceReselectionCandidate[],
): readonly ReselectionItem[] {
  if (!Array.isArray(values)) {
    throw new TypeError('Reference re-selection provider must return an array')
  }
  const items: ReselectionItem[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (value === null || typeof value !== 'object') continue
    let path: WorkspacePath
    try {
      path = createWorkspacePath(value.path)
    } catch {
      continue
    }
    if (path === '') continue
    const fragment = value.fragment ?? null
    const key = `${path}#${fragment ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(Object.freeze({
      id: value.id ?? `reference-reselect:${key}`,
      path,
      label: value.label ?? path,
      ...(value.detail === undefined ? {} : { detail: value.detail }),
      ...(fragment === null ? {} : { fragment }),
    }))
  }
  return Object.freeze(items)
}

function isCurrentFact(
  facts: readonly ReferenceHealthFact[],
  fact: ReferenceHealthFact,
): boolean {
  return facts.some(
    (candidate) =>
      candidate.id === fact.id &&
      candidate.from === fact.from &&
      candidate.to === fact.to &&
      candidate.raw === fact.raw,
  )
}

/**
 * CM6-only reference navigation projection. It decorates source-backed
 * tokens, delegates health to Core, and never parses or serializes a second
 * Markdown document.
 */
export class ReferenceNavigationController {
  decorations: DecorationSet = Decoration.none

  private factsValue: readonly ReferenceHealthFact[] = Object.freeze([])
  private currentSourcePath: WorkspacePath | undefined
  private healthGeneration = 0
  private reselectGeneration = 0
  private destroyed = false
  private readonly resolver: ReferenceHealthQuery | undefined
  private readonly unsubscribeHealth: (() => void) | undefined
  private readonly mutation: ProjectionMutationCapability | undefined
  private readonly tooltipElement: HTMLDivElement
  private readonly reselectMenuElement: HTMLDivElement
  private activeTooltipFact: ReferenceHealthFact | undefined
  private reselectItems: readonly ReselectionItem[] = Object.freeze([])
  private reselectFact: ReferenceHealthFact | undefined
  private reselectSelectedIndex = 0

  private readonly onClick = (event: MouseEvent): void => {
    const fact = this.factFromEvent(event)
    if (!fact) return
    event.preventDefault()
    event.stopPropagation()
    const decision = decideReferenceNavigation(fact)
    if (decision.action === 'open') {
      const request = createReferenceOpenRequest(fact)
      this.invoke(() => this.options.onNavigate?.(request))
      this.invoke(() =>
        this.options.onOpenRequest?.(request),
      )
      this.invoke(() => this.options.onOpen?.(request.path, request.fragment, request))
      return
    }

    const request = createReferenceReselectRequest(fact)
    this.invoke(() => this.options.onNavigate?.(request))
    this.invoke(() => this.options.onReselectRequest?.(request))
    this.invoke(() => this.options.onReselect?.(request))
    this.invoke(() => this.options.onReselectPath?.(request.path))
    void this.openReselection(request)
  }

  private readonly onMouseOver = (event: MouseEvent): void => {
    if (this.options.tooltip === false) return
    const element = elementFromTarget(event.target)
    if (!element) return
    const fact = this.factFromElement(element)
    if (!fact || this.activeTooltipFact?.id === fact.id) return
    const related = elementFromTarget(event.relatedTarget)
    if (related && this.factFromElement(related)?.id === fact.id) return
    this.showTooltip(fact, event)
  }

  private readonly onMouseOut = (event: MouseEvent): void => {
    const element = elementFromTarget(event.target)
    if (!element) return
    const fact = this.factFromElement(element)
    if (!fact) return
    const related = elementFromTarget(event.relatedTarget)
    if (related && this.factFromElement(related)?.id === fact.id) return
    this.hideTooltip()
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.activeTooltipFact) return
    this.positionTooltip(event)
  }

  private readonly onReselectMouseDown = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null
    if (target?.closest(RESELECT_MENU_SELECTOR)) event.preventDefault()
  }

  private readonly onReselectClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null
    const option = target?.closest<HTMLElement>(RESELECT_MENU_SELECTOR)
    if (!option || !this.reselectMenuElement.contains(option)) return
    const index = Number(option.dataset.referenceReselectIndex)
    if (!Number.isSafeInteger(index)) return
    event.preventDefault()
    void this.applyReselection(index)
  }

  private readonly onReselectKeyDown = (event: KeyboardEvent): void => {
    if (!this.reselectFact || this.reselectItems.length === 0 || event.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      this.reselectSelectedIndex =
        (this.reselectSelectedIndex + delta + this.reselectItems.length) %
        this.reselectItems.length
      this.renderReselection()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void this.applyReselection(this.reselectSelectedIndex)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      this.hideReselection()
    }
  }

  constructor(
    private readonly view: EditorView,
    private readonly options: ReferenceNavigationExtensionOptions,
  ) {
    this.resolver = resolverFromOptions(options)
    const subscribeHealth = healthSubscriptionFromOptions(options)
    this.unsubscribeHealth = subscribeHealth
      ? subscribeHealth(() => {
          if (!this.destroyed) this.refreshFromSource()
        })
      : undefined
    this.mutation =
      options.mutation ?? getProjectionMutationCapability(view.state)
    const document = view.dom.ownerDocument

    this.tooltipElement = document.createElement('div')
    this.tooltipElement.className = 'writeit-reference-tooltip ref-tooltip'
    this.tooltipElement.dataset.show = 'false'
    this.tooltipElement.hidden = true
    this.tooltipElement.setAttribute('role', 'tooltip')
    tooltipSequence += 1
    this.tooltipElement.id = `writeit-reference-tooltip-${tooltipSequence}`

    this.reselectMenuElement = document.createElement('div')
    this.reselectMenuElement.className = 'writeit-reference-reselect-menu'
    this.reselectMenuElement.dataset.show = 'false'
    this.reselectMenuElement.hidden = true
    this.reselectMenuElement.setAttribute('role', 'listbox')
    this.reselectMenuElement.setAttribute('aria-label', 'Choose a reference target')
    this.reselectMenuElement.addEventListener('mousedown', this.onReselectMouseDown)
    this.reselectMenuElement.addEventListener('click', this.onReselectClick)

    document.body.append(this.tooltipElement, this.reselectMenuElement)
    view.dom.addEventListener('click', this.onClick, true)
    view.dom.addEventListener('mouseover', this.onMouseOver)
    view.dom.addEventListener('mouseout', this.onMouseOut)
    view.dom.addEventListener('mousemove', this.onMouseMove)
    this.refreshFromSource()
  }

  get facts(): readonly ReferenceHealthFact[] {
    return this.factsValue
  }

  get element(): HTMLElement {
    return this.tooltipElement
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }

  update(update: ViewUpdate): void {
    if (this.destroyed) return
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (!effect.is(setReferenceFactsEffect)) continue
        const value = effect.value
        if (
          value.generation !== this.healthGeneration ||
          value.source !== this.view.state.doc.toString()
        ) {
          continue
        }
        this.factsValue = Object.freeze([...value.facts])
        this.decorations = buildReferenceDecorations(value.source, this.factsValue)
        this.view.dom.removeAttribute('data-reference-health-error')
        this.updateHealthDataset(false)
      }
    }
    if (update.docChanged) this.refreshFromSource()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.unsubscribeHealth?.()
    this.healthGeneration += 1
    this.reselectGeneration += 1
    this.hideTooltip()
    this.hideReselection()
    this.view.dom.removeEventListener('click', this.onClick, true)
    this.view.dom.removeEventListener('mouseover', this.onMouseOver)
    this.view.dom.removeEventListener('mouseout', this.onMouseOut)
    this.view.dom.removeEventListener('mousemove', this.onMouseMove)
    this.reselectMenuElement.removeEventListener('mousedown', this.onReselectMouseDown)
    this.reselectMenuElement.removeEventListener('click', this.onReselectClick)
    this.tooltipElement.remove()
    this.reselectMenuElement.remove()
    delete this.view.dom.dataset.referenceHealth
    delete this.view.dom.dataset.referenceCount
    delete this.view.dom.dataset.referenceBrokenCount
    delete this.view.dom.dataset.referenceHealthError
  }

  private refreshFromSource(): void {
    const source = this.view.state.doc.toString()
    const sourcePath = normalizeSourcePath(this.options)
    const generation = ++this.healthGeneration
    this.currentSourcePath = sourcePath
    this.factsValue = unknownFacts(sourcePath, source)
    this.decorations = buildReferenceDecorations(source, this.factsValue)
    this.updateHealthDataset(this.resolver !== undefined)
    this.view.dom.removeAttribute('data-reference-health-error')
    this.hideTooltip()
    this.hideReselection()

    if (!this.resolver || sourcePath === undefined) return
    void Promise.resolve(this.resolver(sourcePath, source))
      .then((facts) => {
        if (!Array.isArray(facts)) {
          throw new TypeError('Reference health resolver must return an array')
        }
        if (
          this.destroyed ||
          generation !== this.healthGeneration ||
          source !== this.view.state.doc.toString() ||
          sourcePath !== this.currentSourcePath
        ) {
          return
        }
        const normalized = facts.filter((fact) =>
          fact.from >= 0 &&
          fact.to > fact.from &&
          fact.to <= source.length &&
          source.slice(fact.from, fact.to) === fact.raw,
        )
        this.view.dispatch({
          effects: setReferenceFactsEffect.of({
            generation,
            source,
            facts: Object.freeze(normalized),
          }),
        })
      })
      .catch((error: unknown) => {
        if (
          this.destroyed ||
          generation !== this.healthGeneration ||
          source !== this.view.state.doc.toString()
        ) {
          return
        }
        this.view.dom.dataset.referenceHealth = 'error'
        this.view.dom.dataset.referenceHealthError = formatError(error)
      })
  }

  private updateHealthDataset(pending: boolean): void {
    this.view.dom.dataset.referenceHealth = pending ? 'pending' : 'ready'
    this.view.dom.dataset.referenceCount = String(this.factsValue.length)
    this.view.dom.dataset.referenceBrokenCount = String(
      this.factsValue.filter((fact) => fact.broken).length,
    )
  }

  private factFromElement(element: HTMLElement): ReferenceHealthFact | undefined {
    const id = element.dataset.referenceId
    if (id) return this.factsValue.find((fact) => fact.id === id)
    return undefined
  }

  private factFromEvent(event: MouseEvent): ReferenceHealthFact | undefined {
    const element = elementFromTarget(event.target)
    const fromElement = element ? this.factFromElement(element) : undefined
    if (fromElement) return fromElement
    const target = event.target as Node | null
    if (!target || !this.view.dom.contains(target)) return undefined
    let position: number
    try {
      position = this.view.posAtDOM(target, 0)
    } catch {
      return undefined
    }
    return findReferenceAtOffset(this.factsValue, position)
  }

  private showTooltip(fact: ReferenceHealthFact, event: MouseEvent): void {
    if (this.options.tooltip === false) return
    this.activeTooltipFact = fact
    this.tooltipElement.textContent = tooltipText(fact)
    this.tooltipElement.dataset.referenceTooltip = 'true'
    this.tooltipElement.dataset.referenceId = fact.id
    this.tooltipElement.dataset.referenceStatus = fact.status
    this.tooltipElement.hidden = false
    this.tooltipElement.dataset.show = 'true'
    this.positionTooltip(event)
  }

  private positionTooltip(event: MouseEvent): void {
    const window = this.view.dom.ownerDocument.defaultView
    const width = window?.innerWidth ?? 1024
    const height = window?.innerHeight ?? 768
    const tooltipWidth = 320
    const left = Math.max(8, Math.min(event.clientX + 12, width - tooltipWidth - 8))
    const top = Math.max(8, Math.min(event.clientY + 18, height - 64))
    this.tooltipElement.style.left = `${left}px`
    this.tooltipElement.style.top = `${top}px`
  }

  private hideTooltip(): void {
    this.activeTooltipFact = undefined
    this.tooltipElement.hidden = true
    this.tooltipElement.dataset.show = 'false'
    delete this.tooltipElement.dataset.referenceTooltip
    delete this.tooltipElement.dataset.referenceId
    delete this.tooltipElement.dataset.referenceStatus
  }

  private invoke(task: () => void | PromiseLike<void> | undefined): void {
    try {
      const result = task()
      if (result && typeof result.then === 'function') {
        void Promise.resolve(result).catch((error: unknown) => {
          this.view.dom.dataset.referenceNavigationError = formatError(error)
        })
      }
    } catch (error) {
      this.view.dom.dataset.referenceNavigationError = formatError(error)
    }
  }

  private async openReselection(
    request: ReturnType<typeof createReferenceReselectRequest>,
  ): Promise<void> {
    const provider = this.options.reselectProvider ?? this.options.getReselectionCandidates
    if (!provider) return
    const generation = ++this.reselectGeneration
    try {
      const items = normalizeReselectionItems(await provider(request))
      if (
        this.destroyed ||
        generation !== this.reselectGeneration ||
        !isCurrentFact(this.factsValue, request.fact)
      ) {
        return
      }
      this.reselectItems = items
      this.reselectFact = request.fact
      this.reselectSelectedIndex = 0
      this.renderReselection()
    } catch (error) {
      if (this.destroyed || generation !== this.reselectGeneration) return
      this.view.dom.dataset.referenceNavigationError = formatError(error)
      this.hideReselection()
    }
  }

  private renderReselection(): void {
    const fact = this.reselectFact
    if (!fact || this.reselectItems.length === 0) {
      this.hideReselection()
      return
    }
    const document = this.reselectMenuElement.ownerDocument
    this.reselectMenuElement.replaceChildren()
    this.reselectMenuElement.dataset.referenceId = fact.id
    this.reselectMenuElement.dataset.referenceReselectCount = String(this.reselectItems.length)
    this.reselectMenuElement.hidden = false
    this.reselectMenuElement.dataset.referenceReselectMenu = 'true'
    this.reselectMenuElement.dataset.referenceReselect = 'true'
    this.reselectMenuElement.dataset.show = 'true'
    document.addEventListener('keydown', this.onReselectKeyDown, true)

    const heading = document.createElement('div')
    heading.className = 'writeit-reference-reselect-menu__heading'
    heading.textContent = `Replace ${fact.raw}`
    this.reselectMenuElement.append(heading)

    for (const [index, item] of this.reselectItems.entries()) {
      const option = document.createElement('button')
      option.type = 'button'
      option.className = 'writeit-reference-reselect-menu__option'
      option.dataset.referenceReselectIndex = String(index)
      option.dataset.referenceReselectId = item.id
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', String(index === this.reselectSelectedIndex))
      option.tabIndex = -1
      const label = document.createElement('span')
      label.className = 'writeit-reference-reselect-menu__label'
      label.textContent = item.label
      option.append(label)
      const detail = document.createElement('span')
      detail.className = 'writeit-reference-reselect-menu__detail'
      detail.textContent = item.detail ?? `${item.path}${item.fragment ? `#${item.fragment}` : ''}`
      option.append(detail)
      this.reselectMenuElement.append(option)
    }

    const rect = this.rangeRect(fact.from, fact.to)
    if (rect) {
      const window = this.view.dom.ownerDocument.defaultView
      const width = window?.innerWidth ?? 1024
      const height = window?.innerHeight ?? 768
      const menuWidth = 300
      const left = Math.max(8, Math.min(rect.left, width - menuWidth - 8))
      const measuredHeight = this.reselectMenuElement.getBoundingClientRect().height
      const below = rect.bottom + 6
      const above = rect.top - measuredHeight - 6
      const top =
        below + measuredHeight <= height - 8
          ? below
          : Math.max(8, above)
      this.reselectMenuElement.style.left = `${left}px`
      this.reselectMenuElement.style.top = `${top}px`
    }
  }

  private rangeRect(from: number, to: number): DOMRect | undefined {
    try {
      const start = this.view.coordsAtPos(from)
      const end = this.view.coordsAtPos(Math.max(from, to))
      if (!start || !end) return undefined
      return {
        left: Math.min(start.left, end.left),
        right: Math.max(start.right, end.right),
        top: Math.min(start.top, end.top),
        bottom: Math.max(start.bottom, end.bottom),
        width: Math.max(start.right, end.right) - Math.min(start.left, end.left),
        height: Math.max(start.bottom, end.bottom) - Math.min(start.top, end.top),
        x: Math.min(start.left, end.left),
        y: Math.min(start.top, end.top),
        toJSON: () => ({}),
      } as DOMRect
    } catch {
      return undefined
    }
  }

  private hideReselection(): void {
    this.reselectGeneration += 1
    this.view.dom.ownerDocument.removeEventListener('keydown', this.onReselectKeyDown, true)
    this.reselectItems = Object.freeze([])
    this.reselectFact = undefined
    this.reselectMenuElement.replaceChildren()
    this.reselectMenuElement.hidden = true
    this.reselectMenuElement.dataset.show = 'false'
    delete this.reselectMenuElement.dataset.referenceReselectMenu
    delete this.reselectMenuElement.dataset.referenceReselect
    delete this.reselectMenuElement.dataset.referenceId
  }

  private async applyReselection(index: number): Promise<void> {
    const item = this.reselectItems[index]
    const fact = this.reselectFact
    if (!item || !fact || this.destroyed) return
    const source = this.view.state.doc.toString()
    if (source.slice(fact.from, fact.to) !== fact.raw) {
      this.hideReselection()
      return
    }

    try {
      const mutation = this.mutation
      if (!mutation) {
        throw new Error('Reference re-selection requires an editable projection')
      }
      const document = mutation.snapshot()
      if (projectMarkdownSource(document.markdown).projected !== source) {
        throw new Error('Reference editor is not synchronized with DocumentStore')
      }
      const insert = stringifyReference({
        kind: fact.reference.kind,
        path: item.path,
        fragment: item.fragment ?? null,
        readonly: fact.reference.readonly,
      })
      const markdown = source.slice(0, fact.from) + insert + source.slice(fact.to)
      mutation.applyChange({
        markdown,
        origin: createDocumentOrigin('reference-reselect', fact.id),
        expectedRevision: document.revision as Revision,
      })
      this.hideReselection()
      const cursor = Math.min(fact.from + insert.length, this.view.state.doc.length)
      this.view.dispatch({ selection: { anchor: cursor } })
    } catch (error) {
      this.view.dom.dataset.referenceNavigationError = formatError(error)
    }
  }
}

export interface ReferenceNavigationSurface {
  readonly facts: readonly ReferenceHealthFact[]
  readonly element: HTMLElement
  readonly isDestroyed: boolean
  destroy(): void
}

/** Mounts a standalone controller for tests/adapters that do not use a plugin. */
export function mountReferenceNavigationSurface(
  view: EditorView,
  options: ReferenceNavigationExtensionOptions,
): ReferenceNavigationController {
  return new ReferenceNavigationController(view, options)
}

/** Installs source reference marks, click navigation, health and tooltip UI. */
export function createReferenceNavigationExtension(
  options: ReferenceNavigationExtensionOptions,
): Extension {
  return ViewPlugin.define(
    (view) => new ReferenceNavigationController(view, options),
    { decorations: (controller) => controller.decorations },
  )
}
