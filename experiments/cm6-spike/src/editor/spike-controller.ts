import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { Annotation, EditorState, Prec, StateField, type ChangeSet } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  keymap,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  isSelected,
  normalizeSelection,
  parseClipboardHtml,
  parseClipboardTsv,
  parseTableAt,
  parseTables,
  pasteMatrix,
  replaceTable,
  serializeSelectionHtml,
  serializeSelectionTsv,
  type TableModel,
  type TableSelection,
  updateCell,
} from '../table/core'
import {
  DocumentConflictError,
  DocumentStore,
  fullReplace,
  type DocumentChangedEvent,
  type ViewId,
} from '../core/document-store'

const storeSync = Annotation.define<string>()

interface ProjectionRecord {
  id: ViewId
  documentId: string
  view: EditorView
  unsubscribe: () => void
  revision: number
  stale: boolean
  skipNextOrigin: boolean
  stack: string[]
  tableSelection: Map<string, TableSelection>
}

export interface MountHandle {
  readonly id: ViewId
  readonly documentId: string
  readonly view: EditorView
  destroy(): void
}

export interface SpikeDebugApi {
  inspect(): ReturnType<DocumentStore['diagnostics']>
  source(documentId: string): string
  stale(documentId: string, projectionId?: string): void
  undo(documentId: string): void
  redo(documentId: string): void
  lifecycle(documentId: string, cycles?: number): { before: number; after: number; cycles: number }
  stress(): StressProbeResult
}

export interface StressProbeResult {
  baselineViews: number
  finalViews: number
  document10kMountMs: number
  document10kEditMs: number
  table500x20MountMs: number
  tenProjectionPropagationMs: number
}

export class SpikeController {
  readonly store: DocumentStore
  private readonly views = new Map<ViewId, ProjectionRecord>()
  private readonly mountSequence = new Map<string, number>()

  constructor(store: DocumentStore) {
    this.store = store
  }

  mountHost(documentId: string, parent: HTMLElement, id = `view-${documentId}-tab`): MountHandle {
    return this.mountProjection(documentId, parent, id, [documentId])
  }

  mountProjection(documentId: string, parent: HTMLElement, id: ViewId, stack: string[]): MountHandle {
    if (this.views.has(id)) throw new Error(`duplicate view: ${id}`)
    const snapshot = this.store.get(documentId)
    const tableSelection = new Map<string, TableSelection>()
    const extensions = [
      markdown(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      Prec.high(
        keymap.of([
          { key: 'Backspace', run: () => this.deleteAdjacentEmbed(id, -1) },
          { key: 'Delete', run: () => this.deleteAdjacentEmbed(id, 1) },
        ]),
      ),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => this.onViewUpdate(id, update)),
      StateField.define<DecorationSet>({
        create: (state) => buildDecorations(this, id, documentId, stack, state),
        update: (decorations, transaction) =>
          transaction.docChanged || transaction.selection ? buildDecorations(this, id, documentId, stack, transaction.state) : decorations,
        provide: (field) => EditorView.decorations.from(field),
      }),
    ]
    if (stack.length > 1) {
      extensions.push(keymap.of([{ key: 'Escape', run: () => this.focusProjectionHost(id) }]))
    }
    const view = new EditorView({ state: EditorState.create({ doc: snapshot.markdown, extensions }), parent })
    const record: ProjectionRecord = {
      id,
      documentId,
      view,
      unsubscribe: () => undefined,
      revision: snapshot.revision,
      stale: false,
      skipNextOrigin: false,
      stack,
      tableSelection,
    }
    this.views.set(id, record)
    record.unsubscribe = this.store.subscribe(documentId, id, (event) => this.onDocumentChanged(id, event))
    this.store.note(`ViewMounted ${id} document=${documentId} rev=${snapshot.revision}`)
    return { id, documentId, view, destroy: () => this.destroyView(id) }
  }

  destroyView(id: ViewId): void {
    const record = this.views.get(id)
    if (!record) return
    record.unsubscribe()
    record.view.destroy()
    this.views.delete(id)
    this.store.note(`ViewDestroyed ${id} document=${record.documentId}`)
  }

  destroyAll(): void {
    for (const id of [...this.views.keys()]) this.destroyView(id)
  }

  view(id: ViewId): EditorView | undefined {
    return this.views.get(id)?.view
  }

  projectionIds(documentId: string): string[] {
    return [...this.views.values()].filter((record) => record.documentId === documentId).map((record) => record.id)
  }

  commitTable(viewId: ViewId, documentId: string, model: TableModel): void {
    const current = this.store.get(documentId).markdown
    const fresh = parseTableAt(current, model.start)
    if (!fresh) throw new Error(`table disappeared at ${documentId}:${model.start}`)
    const next = replaceTable(current, { ...model, start: fresh.start, end: fresh.end, source: fresh.source })
    this.store.replace(documentId, next, viewId, 'table-edit')
  }

  setTableSelection(viewId: ViewId, documentId: string, tableStart: number, selection: TableSelection): void {
    const record = this.requireView(viewId)
    if (record.documentId !== documentId) throw new Error(`selection document mismatch: ${viewId}`)
    record.tableSelection.set(tableKey(documentId, tableStart), selection)
  }

  tableSelection(viewId: ViewId, documentId: string, tableStart: number): TableSelection {
    const record = this.views.get(viewId)
    return (
      record?.tableSelection.get(tableKey(documentId, tableStart)) ?? {
        anchorRow: 0,
        anchorColumn: 0,
        headRow: 0,
        headColumn: 0,
      }
    )
  }

  applySource(documentId: string, markdownText: string): void {
    this.store.replace(documentId, markdownText, `source-panel:${documentId}`, 'source-edit')
  }

  save(documentId: string): string {
    return this.store.save(documentId)
  }

  undo(documentId: string): void {
    this.store.undo(documentId, `diagnostics:undo:${documentId}`)
  }

  redo(documentId: string): void {
    this.store.redo(documentId, `diagnostics:redo:${documentId}`)
  }

  debugApi(): SpikeDebugApi {
    return {
      inspect: () => this.store.diagnostics(),
      source: (documentId) => this.store.get(documentId).markdown,
      stale: (documentId, projectionId) => {
        const id = projectionId ?? this.projectionIds(documentId)[0]
        if (!id) throw new Error(`no projection for ${documentId}`)
        this.store.markStale(documentId, id)
        const record = this.views.get(id)
        if (record) record.stale = true
      },
      undo: (documentId) => this.undo(documentId),
      redo: (documentId) => this.redo(documentId),
      lifecycle: (documentId, cycles = 100) => this.lifecycleProbe(documentId, cycles),
      stress: () => this.stressProbe(),
    }
  }

  lifecycleProbe(documentId: string, cycles = 100): { before: number; after: number; cycles: number } {
    const before = this.projectionIds(documentId).length
    const parent = document.createElement('div')
    parent.hidden = true
    document.body.append(parent)
    for (let index = 0; index < cycles; index++) {
      const id = `lifecycle-probe-${documentId}-${index}`
      this.mountProjection(documentId, parent, id, [documentId]).destroy()
    }
    parent.remove()
    const after = this.projectionIds(documentId).length
    this.store.note(`LifecycleProbe ${documentId} cycles=${cycles} views=${before}->${after}`)
    return { before, after, cycles }
  }

  stressProbe(): StressProbeResult {
    const baselineViews = this.views.size
    const parent = document.createElement('div')
    parent.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:800px;overflow:auto'
    document.body.append(parent)
    const largeId = 'stress-10k.md'
    const tableId = 'stress-500x20.md'
    const multiId = 'stress-multi.md'
    this.store.seed(largeId, Array.from({ length: 10_000 }, (_, index) => `line ${index}`).join('\n'))
    this.store.seed(tableId, makeStressTable(500, 20))
    this.store.seed(multiId, 'shared')

    const largeMountStart = performance.now()
    const largeView = this.mountProjection(largeId, parent, 'stress-large', [largeId])
    const document10kMountMs = performance.now() - largeMountStart
    const mountStart = performance.now()
    largeView.view.dispatch({ changes: { from: largeView.view.state.doc.length, insert: '\nprobe' } })
    const document10kEditMs = performance.now() - mountStart
    largeView.destroy()

    const tableStart = performance.now()
    const tableView = this.mountProjection(tableId, parent, 'stress-table', [tableId])
    const table500x20MountMs = performance.now() - tableStart
    tableView.destroy()

    const multiViews: MountHandle[] = []
    for (let index = 0; index < 10; index++) {
      multiViews.push(this.mountProjection(multiId, parent, `stress-multi-${index}`, [multiId]))
    }
    const propagationStart = performance.now()
    this.store.replace(multiId, 'shared X', 'stress-origin', 'stress-propagation')
    const tenProjectionPropagationMs = performance.now() - propagationStart
    for (const handle of multiViews) handle.destroy()
    parent.remove()
    this.store.remove(largeId)
    this.store.remove(tableId)
    this.store.remove(multiId)
    const finalViews = this.views.size
    this.store.note(`StressProbe views=${baselineViews}->${finalViews} table500x20=${table500x20MountMs.toFixed(1)}ms multi10=${tenProjectionPropagationMs.toFixed(1)}ms`)
    return { baselineViews, finalViews, document10kMountMs, document10kEditMs, table500x20MountMs, tenProjectionPropagationMs }
  }

  private onViewUpdate(id: ViewId, update: ViewUpdate): void {
    if (!update.docChanged) return
    if (update.transactions.some((transaction) => transaction.annotation(storeSync))) return
    const record = this.views.get(id)
    if (!record) return
    record.skipNextOrigin = true
    try {
      this.store.applyChanges(
        record.documentId,
        { fromRevision: record.revision, changes: update.changes },
        id,
        'typing',
      )
    } catch (error) {
      record.skipNextOrigin = false
      if (error instanceof DocumentConflictError) {
        const current = this.store.get(record.documentId).markdown
        record.view.dispatch({ changes: fullReplace(record.view.state.doc.toString(), current), annotations: storeSync.of('conflict-recovery') })
        record.revision = this.store.get(record.documentId).revision
        record.stale = false
      } else {
        throw error
      }
    }
  }

  private onDocumentChanged(id: ViewId, event: DocumentChangedEvent): void {
    const record = this.views.get(id)
    if (!record) return
    record.revision = event.toRevision
    record.stale = false
    if (event.origin === id && record.skipNextOrigin) {
      record.skipNextOrigin = false
      return
    }
    const current = record.view.state.doc.toString()
    if (current === event.after) return
    try {
      const changes: ChangeSet = current === event.before ? event.changes : fullReplace(current, event.after)
      record.view.dispatch({ changes, annotations: storeSync.of(event.origin) })
    } catch (error) {
      record.stale = true
      this.store.note(`ProjectionStale ${id}: ${String(error)}`)
      throw error
    }
  }

  private requireView(id: ViewId): ProjectionRecord {
    const record = this.views.get(id)
    if (!record) throw new Error(`unknown view: ${id}`)
    return record
  }

  private focusProjectionHost(id: ViewId): boolean {
    const marker = id.lastIndexOf('/embed-')
    if (marker < 0) return false
    const hostId = id.slice(0, marker)
    const host = this.views.get(hostId)
    if (!host) return false
    host.view.focus()
    this.store.note(`EmbedEscape ${id} -> ${hostId}`)
    return true
  }

  private deleteAdjacentEmbed(id: ViewId, direction: -1 | 1): boolean {
    const record = this.views.get(id)
    if (!record || !record.view.state.selection.main.empty) return false
    const position = record.view.state.selection.main.head
    const source = record.view.state.doc.toString()
    const embeds = /!\[\[([^\]]+)\]\]/g
    let match: RegExpExecArray | null
    while ((match = embeds.exec(source))) {
      const from = match.index
      const to = from + match[0].length
      const adjacent = direction < 0 ? to === position : from === position
      if (!adjacent) continue
      record.view.dispatch({ changes: { from, to, insert: '' } })
      this.store.note(`EmbedReferenceDeleted ${record.documentId} ${match[1].trim()} origin=${id}`)
      return true
    }
    return false
  }

  nextEmbedId(hostId: string, target: string, start: number): string {
    const key = `${hostId}/embed-${target}-${start}`
    const next = (this.mountSequence.get(key) ?? 0) + 1
    this.mountSequence.set(key, next)
    return `${key}#${next}`
  }
}

class TableWidget extends WidgetType {
  constructor(
    private readonly controller: SpikeController,
    private readonly hostViewId: string,
    private readonly documentId: string,
    private readonly model: TableModel,
  ) {
    super()
  }

  eq(other: TableWidget): boolean {
    return other instanceof TableWidget && other.documentId === this.documentId && other.model.start === this.model.start && tableSignature(other.model) === tableSignature(this.model)
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm6-table-widget'
    wrapper.setAttribute('contenteditable', 'false')
    wrapper.dataset.tableStart = String(this.model.start)
    const toolbar = document.createElement('div')
    toolbar.className = 'table-toolbar'
    toolbar.innerHTML = '<span>Markdown Table</span><button data-action="add-row">+ row</button><button data-action="delete-row">− row</button><button data-action="add-column">+ column</button><button data-action="delete-column">− column</button>'
    toolbar.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const action = target.dataset.action
      if (!action) return
      const selection = this.controller.tableSelection(this.hostViewId, this.documentId, this.model.start)
      const next = action === 'add-row'
        ? addRow(this.model, normalizeSelection(selection).bottom)
        : action === 'delete-row'
          ? deleteRow(this.model, normalizeSelection(selection).bottom)
          : action === 'add-column'
            ? addColumn(this.model, normalizeSelection(selection).right)
            : deleteColumn(this.model, normalizeSelection(selection).right)
      this.controller.commitTable(this.hostViewId, this.documentId, next)
    })
    wrapper.append(toolbar)

    const table = document.createElement('table')
    table.setAttribute('aria-label', 'Markdown table')
    const tbody = document.createElement('tbody')
    let dragging = false
    let dragged = false
    const selection = this.controller.tableSelection(this.hostViewId, this.documentId, this.model.start)
    const paintSelection = (): void => {
      const selected = this.controller.tableSelection(this.hostViewId, this.documentId, this.model.start)
      for (const cellInput of table.querySelectorAll<HTMLInputElement>('input[data-row][data-column]')) {
        cellInput.parentElement?.classList.toggle(
          'table-selected-cell',
          isSelected(selected, Number(cellInput.dataset.row), Number(cellInput.dataset.column)),
        )
      }
    }
    this.model.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr')
      row.forEach((cell, columnIndex) => {
        const td = document.createElement('td')
        const input = document.createElement('input')
        input.value = cell.value
        input.dataset.row = String(rowIndex)
        input.dataset.column = String(columnIndex)
        input.setAttribute('aria-label', `row ${rowIndex + 1} column ${columnIndex + 1}`)
        if (rowIndex === 0) input.classList.add('table-header-cell')
        if (isSelected(selection, rowIndex, columnIndex)) td.classList.add('table-selected-cell')
        input.addEventListener('click', (event) => {
          if (dragged) {
            dragged = false
            paintSelection()
            return
          }
          const extend = (event as MouseEvent).shiftKey
          const previous = this.controller.tableSelection(this.hostViewId, this.documentId, this.model.start)
          this.controller.setTableSelection(this.hostViewId, this.documentId, this.model.start, {
            anchorRow: extend ? previous.anchorRow : rowIndex,
            anchorColumn: extend ? previous.anchorColumn : columnIndex,
            headRow: rowIndex,
            headColumn: columnIndex,
          })
          paintSelection()
        })
        input.addEventListener('change', (event) => {
          event.stopPropagation()
          const changedRow = Number(input.dataset.row)
          const changedColumn = Number(input.dataset.column)
          this.commitCell(changedRow, changedColumn, input.value)
        })
        input.addEventListener('input', (event) => event.stopPropagation())
        input.addEventListener('compositionstart', () => {
          input.dataset.composing = 'true'
          this.controller.store.note(`CompositionStart ${this.documentId} r${rowIndex}c${columnIndex}`)
        })
        input.addEventListener('compositionupdate', () => {
          this.controller.store.note(`CompositionUpdate ${this.documentId} r${rowIndex}c${columnIndex}`)
        })
        input.addEventListener('compositionend', () => {
          delete input.dataset.composing
          this.controller.store.note(`CompositionEnd ${this.documentId} r${rowIndex}c${columnIndex}`)
        })
        input.addEventListener('keydown', (event) => {
          event.stopPropagation()
          this.onCellKeyDown(event, rowIndex, columnIndex, table)
        })
        td.append(input)
        tr.append(td)
      })
      tbody.append(tr)
    })
    table.append(tbody)
    const cellFromPointer = (event: PointerEvent): { row: number; column: number } | null => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-row][data-column]')
      if (!input) return null
      return { row: Number(input.dataset.row), column: Number(input.dataset.column) }
    }
    table.addEventListener('pointerdown', (event) => {
      const cell = cellFromPointer(event)
      if (!cell) return
      dragging = true
      dragged = false
      this.controller.setTableSelection(this.hostViewId, this.documentId, this.model.start, {
        anchorRow: cell.row,
        anchorColumn: cell.column,
        headRow: cell.row,
        headColumn: cell.column,
      })
      paintSelection()
    })
    table.addEventListener('pointerover', (event) => {
      if (!dragging) return
      const cell = cellFromPointer(event)
      if (!cell) return
      const current = this.controller.tableSelection(this.hostViewId, this.documentId, this.model.start)
      if (cell.row === current.headRow && cell.column === current.headColumn) return
      dragged = true
      this.controller.setTableSelection(this.hostViewId, this.documentId, this.model.start, {
        ...current,
        headRow: cell.row,
        headColumn: cell.column,
      })
      paintSelection()
    })
    const stopDragging = (): void => {
      dragging = false
    }
    table.addEventListener('pointerup', stopDragging)
    table.addEventListener('pointercancel', stopDragging)
    table.addEventListener('copy', (event) => {
      const clipboard = (event as ClipboardEvent).clipboardData
      if (!clipboard) return
      const selected = this.controller.tableSelection(this.hostViewId, this.documentId, this.model.start)
      clipboard.setData('text/plain', serializeSelectionTsv(this.model, selected))
      clipboard.setData('text/html', serializeSelectionHtml(this.model, selected))
      event.preventDefault()
    })
    table.addEventListener('paste', (event) => {
      const clipboard = (event as ClipboardEvent).clipboardData
      if (!clipboard) return
      const html = clipboard.getData('text/html')
      const text = clipboard.getData('text/plain')
      const matrix = html ? parseClipboardHtml(html).rows : parseClipboardTsv(text).rows
      const selected = this.controller.tableSelection(this.hostViewId, this.documentId, this.model.start)
      this.controller.commitTable(this.hostViewId, this.documentId, pasteMatrix(this.model, selected, matrix))
      event.preventDefault()
    })
    wrapper.append(table)
    return wrapper
  }

  ignoreEvent(): boolean {
    return true
  }

  private onCellKeyDown(event: KeyboardEvent, row: number, column: number, table: HTMLTableElement): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      const input = event.target as HTMLInputElement
      const current = this.controller.store.get(this.documentId).markdown
      const fresh = parseTableAt(current, this.model.start)
      const committedValue = fresh?.rows[row]?.[column]?.value
      if (fresh && committedValue !== input.value) this.commitCell(row, column, input.value)
      if (event.shiftKey) this.controller.redo(this.documentId)
      else this.controller.undo(this.documentId)
      event.preventDefault()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
      const input = event.target as HTMLInputElement
      const current = this.controller.store.get(this.documentId).markdown
      const fresh = parseTableAt(current, this.model.start)
      const committedValue = fresh?.rows[row]?.[column]?.value
      if (fresh && committedValue !== input.value) this.commitCell(row, column, input.value)
      this.controller.redo(this.documentId)
      event.preventDefault()
      return
    }
    const rows = this.model.rows.length
    const columns = this.model.alignment.length
    let nextRow = row
    let nextColumn = column
    if (event.key === 'ArrowUp') nextRow = Math.max(0, row - 1)
    else if (event.key === 'ArrowDown') nextRow = Math.min(rows - 1, row + 1)
    else if (event.key === 'ArrowLeft') nextColumn = Math.max(0, column - 1)
    else if (event.key === 'ArrowRight') nextColumn = Math.min(columns - 1, column + 1)
    else if (event.key === 'Tab') {
      const direction = event.shiftKey ? -1 : 1
      const linear = row * columns + column + direction
      const wrapped = (linear + rows * columns) % (rows * columns)
      nextRow = Math.floor(wrapped / columns)
      nextColumn = wrapped % columns
    } else if (event.key === 'Enter') {
      const input = event.target as HTMLInputElement
      this.commitCell(Number(input.dataset.row), Number(input.dataset.column), input.value)
      event.preventDefault()
      return
    } else {
      return
    }
    event.preventDefault()
    const target = table.querySelector<HTMLInputElement>(`input[data-row="${nextRow}"][data-column="${nextColumn}"]`)
    target?.focus()
    this.controller.setTableSelection(this.hostViewId, this.documentId, this.model.start, {
      anchorRow: nextRow,
      anchorColumn: nextColumn,
      headRow: nextRow,
      headColumn: nextColumn,
    })
  }

  private commitCell(row: number, column: number, value: string): void {
    const current = this.controller.store.get(this.documentId).markdown
    const fresh = parseTableAt(current, this.model.start)
    if (!fresh) throw new Error(`table disappeared at ${this.documentId}:${this.model.start}`)
    this.controller.commitTable(this.hostViewId, this.documentId, updateCell(fresh, row, column, value))
  }
}

class EmbedWidget extends WidgetType {
  private childId: string | null = null

  constructor(
    private readonly controller: SpikeController,
    private readonly hostViewId: string,
    private readonly target: string,
    private readonly start: number,
    private readonly stack: string[],
  ) {
    super()
  }

  eq(other: EmbedWidget): boolean {
    return other instanceof EmbedWidget && other.target === this.target && other.start === this.start && other.hostViewId === this.hostViewId
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm6-embed-projection'
    wrapper.dataset.target = this.target
    const label = document.createElement('div')
    label.className = 'embed-label'
    label.textContent = `Editable Projection · ${this.target}`
    wrapper.append(label)
    if (this.stack.includes(this.target)) {
      const circular = document.createElement('div')
      circular.className = 'embed-circular'
      circular.textContent = `Circular embed: ${this.stack.join(' → ')} → ${this.target}`
      wrapper.append(circular)
      return wrapper
    }
    if (!this.controller.store.has(this.target)) {
      const missing = document.createElement('div')
      missing.className = 'embed-missing'
      missing.textContent = `Missing document: ${this.target}`
      wrapper.append(missing)
      return wrapper
    }
    const mount = document.createElement('div')
    mount.className = 'embed-editor-mount'
    wrapper.append(mount)
    this.childId = this.controller.nextEmbedId(this.hostViewId, this.target, this.start)
    this.controller.mountProjection(this.target, mount, this.childId, [...this.stack, this.target])
    return wrapper
  }

  destroy(): void {
    if (this.childId) this.controller.destroyView(this.childId)
    this.childId = null
  }

  ignoreEvent(): boolean {
    return true
  }
}

class MermaidWidget extends WidgetType {
  constructor(private readonly source: string) {
    super()
  }

  eq(other: MermaidWidget): boolean {
    return other instanceof MermaidWidget && other.source === this.source
  }

  toDOM(): HTMLElement {
    const element = document.createElement('div')
    element.className = 'cm6-mermaid-widget'
    element.textContent = `Mermaid preview · ${this.source.split('\n').slice(1, -1).join(' ').trim()}`
    return element
  }

  ignoreEvent(): boolean {
    return false
  }
}

function buildDecorations(
  controller: SpikeController,
  viewId: string,
  documentId: string,
  stack: string[],
  state: EditorState,
): DecorationSet {
  const text = state.doc.toString()
  const cursor = state.selection.main.head
  const replacements: Array<{ from: number; to: number; decoration: Decoration }> = []
  const tables = parseTables(text)
  for (const model of tables) {
    if (cursor > model.start && cursor < model.end) continue
    replacements.push({
      from: model.start,
      to: model.end,
      decoration: Decoration.replace({ widget: new TableWidget(controller, viewId, documentId, model), block: true }),
    })
  }
  const tableRanges = replacements.map(({ from, to }) => ({ from, to }))
  const mermaid = /```mermaid\s*\n[\s\S]*?\n```/g
  let match: RegExpExecArray | null
  while ((match = mermaid.exec(text))) {
    const from = match.index
    const to = from + match[0].length
    if (cursor > from && cursor < to || overlaps(tableRanges, from, to)) continue
    replacements.push({ from, to, decoration: Decoration.replace({ widget: new MermaidWidget(match[0]), block: true }) })
  }
  const embed = /!\[\[([^\]]+)\]\]/g
  while ((match = embed.exec(text))) {
    const from = match.index
    const to = from + match[0].length
    if (cursor > from && cursor < to || overlaps(tableRanges, from, to)) continue
    replacements.push({
      from,
      to,
      decoration: Decoration.replace({ widget: new EmbedWidget(controller, viewId, match[1].trim(), from, stack), block: true }),
    })
  }
  const marks: Array<{ from: number; to: number; decoration: Decoration }> = []
  const bold = /\*\*([^*\n]+)\*\*/g
  while ((match = bold.exec(text))) {
    const from = match.index
    const to = from + match[0].length
    if (!overlaps(replacements.map(({ from: start, to: end }) => ({ from: start, to: end })), from, to)) {
      marks.push({ from, to, decoration: Decoration.mark({ class: 'cm6-bold-preview' }) })
    }
  }
  const ranges = [...replacements, ...marks].sort((a, b) => a.from - b.from || a.to - b.to)
  return Decoration.set(ranges.map((range) => range.decoration.range(range.from, range.to)), true)
}

function overlaps(ranges: Array<{ from: number; to: number }>, from: number, to: number): boolean {
  return ranges.some((range) => from < range.to && to > range.from)
}

function tableKey(documentId: string, start: number): string {
  return `${documentId}:${start}`
}

function tableSignature(model: TableModel): string {
  return JSON.stringify({ rows: model.rows, alignment: model.alignment })
}

function makeStressTable(rows: number, columns: number): string {
  const header = `| ${Array.from({ length: columns }, (_, index) => `H${index}`).join(' | ')} |`
  const divider = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`
  const body = Array.from({ length: rows }, (_, row) => `| ${Array.from({ length: columns }, (_, column) => `${row}-${column}`).join(' | ')} |`)
  return [header, divider, ...body].join('\n') + '\n'
}

export function installDebugApi(controller: SpikeController): void {
  ;(window as unknown as { __cm6Spike?: SpikeDebugApi }).__cm6Spike = controller.debugApi()
}

export { redo, undo }
