import { Transaction, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import {
  applyTableCommand,
  addTableRow,
  clearTableSelection,
  normalizeTableSelection,
  moveTableColumn,
  moveTableRow,
  parseTableClipboard,
  parseMarkdownTables,
  pasteTableMatrix,
  serializeMarkdownTable,
  serializeTableHtml,
  serializeTableTsv,
  tableSelectionMatrix,
  TABLE_COMMAND_IDS,
  updateTableCell,
  type MarkdownTable,
  type TableCommandId,
} from '../../../../core/table'

export type TableCellMode = 'selected' | 'editing'

interface ActiveTableCell {
  tableFrom: number
  row: number
  column: number
  anchorRow: number
  anchorColumn: number
  mode: TableCellMode
  caret?: number
}

function isPrintableKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey
}

function editableView(view: EditorView): boolean {
  return !view.state.readOnly && view.state.facet(EditorView.editable)
}

/** View-local selection/editing state. It never contains authoritative Markdown. */
export class TableInteractionRuntime {
  private active: ActiveTableCell | undefined

  private dragging = false

  private dragged = false

  private readonly columnWidths = new Map<string, number>()

  constructor(private readonly view: EditorView) {}

  activeFor(table: MarkdownTable): ActiveTableCell | undefined {
    return this.active?.tableFrom === table.range.from ? this.active : undefined
  }

  select(
    table: MarkdownTable,
    row: number,
    column: number,
    mode: TableCellMode,
    caret?: number,
    extend = false,
  ): void {
    const previous = this.activeFor(table)
    this.active = {
      tableFrom: table.range.from,
      row,
      column,
      anchorRow: extend && previous ? previous.anchorRow : row,
      anchorColumn: extend && previous ? previous.anchorColumn : column,
      mode,
      caret,
    }
  }

  beginDrag(table: MarkdownTable, row: number, column: number): void {
    this.dragging = true
    this.dragged = false
    this.select(table, row, column, 'selected')
  }

  extendDrag(table: MarkdownTable, row: number, column: number): boolean {
    if (!this.dragging || !this.activeFor(table)) return false
    this.dragged = true
    this.select(table, row, column, 'selected', undefined, true)
    return true
  }

  endDrag(): void {
    this.dragging = false
  }

  consumeDraggedClick(): boolean {
    const dragged = this.dragged
    this.dragged = false
    return dragged
  }

  clear(): void {
    this.active = undefined
    this.dragging = false
    this.dragged = false
  }

  selectRange(table: MarkdownTable, anchorRow: number, anchorColumn: number, headRow: number, headColumn: number): void {
    this.active = { tableFrom: table.range.from, anchorRow, anchorColumn, row: headRow, column: headColumn, mode: 'selected' }
  }

  columnWidth(table: MarkdownTable, column: number): number | undefined {
    return this.columnWidths.get(`${table.range.from}:${column}`)
  }

  setColumnWidth(table: MarkdownTable, column: number, width: number): void {
    this.columnWidths.set(`${table.range.from}:${column}`, Math.max(88, Math.round(width)))
  }

  focusSource(): void {
    this.clear()
    this.view.focus()
  }

  mutate(table: MarkdownTable, edited: MarkdownTable, userEvent = 'input'): void {
    const current = this.view.state.doc.toString()
    if (current.slice(table.range.from, table.range.to) !== table.source) {
      throw new Error('Table widget source is stale')
    }
    this.view.dispatch({
      changes: {
        from: table.range.from,
        to: table.range.to,
        insert: serializeMarkdownTable(edited),
      },
      annotations: Transaction.userEvent.of(userEvent),
    })
    this.requestActiveFocus()
  }

  requestActiveFocus(): void {
    // Callers have completed dispatch/renderCellContent. Focus is not a layout
    // measurement: restore it now so the next input cannot hit the source view.
    const active = this.active
    if (!active) return
    const selector = `.cm-writeit-table[data-table-from="${active.tableFrom}"] [data-table-row="${active.row}"][data-table-column="${active.column}"]`
    const cell = this.view.dom.querySelector<HTMLElement>(selector)
    const target = active.mode === 'editing'
      ? cell?.querySelector<HTMLTextAreaElement>('.cm-writeit-table__editor')
      : cell?.querySelector<HTMLButtonElement>('.cm-writeit-table__cell-button')
    target?.focus()
    if (target instanceof HTMLTextAreaElement && active.caret !== undefined) {
      const caret = Math.min(active.caret, target.value.length)
      target.setSelectionRange(caret, caret)
    }
  }
}

const runtimeByView = new WeakMap<EditorView, TableInteractionRuntime>()

function runtimeFor(view: EditorView): TableInteractionRuntime {
  const existing = runtimeByView.get(view)
  if (existing) return existing
  const runtime = new TableInteractionRuntime(view)
  runtimeByView.set(view, runtime)
  return runtime
}

class MarkdownTableWidget extends WidgetType {
  private interaction!: TableInteractionRuntime

  private structuralDrag: { kind: 'row' | 'column'; index: number } | undefined

  constructor(private readonly table: MarkdownTable) {
    super()
  }

  eq(other: WidgetType): boolean {
    return other instanceof MarkdownTableWidget && other.table.source === this.table.source
  }

  toDOM(view: EditorView): HTMLElement {
    this.interaction = runtimeFor(view)
    const document = view.dom.ownerDocument
    const shell = document.createElement('div')
    shell.className = 'cm-writeit-table'
    shell.dataset.tableFrom = String(this.table.range.from)
    shell.dataset.tableTo = String(this.table.range.to)
    shell.dataset.tableReadonly = String(!editableView(view))
    shell.setAttribute('role', 'region')
    shell.setAttribute('aria-label', 'Markdown table')
    if (editableView(view)) shell.append(this.renderToolbar(document))
    const scroller = document.createElement('div')
    scroller.className = 'cm-writeit-table__scroller'
    const grid = document.createElement('table')
    grid.className = 'cm-writeit-table__grid'
    grid.setAttribute('role', 'grid')
    grid.setAttribute('aria-rowcount', String(this.table.rows.length))
    grid.setAttribute('aria-colcount', String(this.table.alignments.length))
    grid.addEventListener('pointerup', () => this.interaction.endDrag())
    grid.addEventListener('pointercancel', () => this.interaction.endDrag())
    const colgroup = document.createElement('colgroup')
    this.table.alignments.forEach((_alignment, column) => {
      const col = document.createElement('col')
      col.dataset.tableColumn = String(column)
      const width = this.interaction.columnWidth(this.table, column)
      if (width !== undefined) col.style.width = `${width}px`
      colgroup.append(col)
    })
    grid.append(colgroup)
    const head = document.createElement('thead')
    head.append(this.renderRow(document, view, 0, true))
    grid.append(head)
    const body = document.createElement('tbody')
    this.table.rows.slice(1).forEach((_row, index) => body.append(this.renderRow(document, view, index + 1, false)))
    grid.append(body)
    scroller.append(grid)
    shell.append(scroller)
    return shell
  }

  ignoreEvent(): boolean {
    // Buttons, textarea, clipboard, resize, and drag/drop are owned by this
    // projection. CM6 must not reinterpret them as source-editor gestures.
    return true
  }

  private renderRow(document: Document, view: EditorView, row: number, header: boolean): HTMLTableRowElement {
    const element = document.createElement('tr')
    element.dataset.tableRow = String(row)
    this.table.rows[row].forEach((cell, column) => {
      const cellElement = document.createElement(header ? 'th' : 'td')
      cellElement.dataset.tableRow = String(row)
      cellElement.dataset.tableColumn = String(column)
      cellElement.setAttribute('role', header ? 'columnheader' : 'gridcell')
      cellElement.setAttribute('aria-rowindex', String(row + 1))
      cellElement.setAttribute('aria-colindex', String(column + 1))
      cellElement.style.textAlign = this.table.alignments[column] ?? 'left'
      this.renderCellContent(document, view, cellElement, row, column, cell.value)
      if (editableView(view)) {
        if (header) this.addColumnControls(document, cellElement, column)
        else if (column === 0) this.addRowControl(document, cellElement, row)
      }
      element.append(cellElement)
    })
    return element
  }

  private renderToolbar(document: Document): HTMLDivElement {
    const toolbar = document.createElement('div')
    toolbar.className = 'cm-writeit-table__toolbar'
    toolbar.setAttribute('aria-label', 'Table actions')
    const actions: readonly [TableCommandId, string][] = [
      [TABLE_COMMAND_IDS.addRowAfter, '+ Row'],
      [TABLE_COMMAND_IDS.deleteRow, '− Row'],
      [TABLE_COMMAND_IDS.addColumnAfter, '+ Column'],
      [TABLE_COMMAND_IDS.deleteColumn, '− Column'],
      [TABLE_COMMAND_IDS.moveRowUp, 'Row ↑'],
      [TABLE_COMMAND_IDS.moveRowDown, 'Row ↓'],
      [TABLE_COMMAND_IDS.moveColumnLeft, 'Column ←'],
      [TABLE_COMMAND_IDS.moveColumnRight, 'Column →'],
    ]
    actions.forEach(([id, label]) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.tableCommand = id
      button.textContent = label
      button.addEventListener('click', () => this.executeCommand(id))
      toolbar.append(button)
    })
    return toolbar
  }

  private addRowControl(document: Document, cell: HTMLTableCellElement, row: number): void {
    const grip = document.createElement('button')
    grip.type = 'button'
    grip.className = 'cm-writeit-table__row-grip'
    grip.draggable = true
    grip.dataset.tableRowGrip = String(row)
    grip.setAttribute('aria-label', `Select or move row ${row + 1}`)
    grip.textContent = '⋮⋮'
    grip.addEventListener('click', () => {
      this.interaction.selectRange(this.table, row, 0, row, this.table.alignments.length - 1)
      this.applySelectionDom(cell.closest('table'))
    })
    grip.addEventListener('dragstart', (event) => {
      this.structuralDrag = { kind: 'row', index: row }
      event.dataTransfer?.setData('text/plain', `writeit-row:${row}`)
    })
    grip.addEventListener('dragover', (event) => {
      if (this.structuralDrag?.kind !== 'row') return
      event.preventDefault()
      cell.closest('tr')?.classList.add('cm-writeit-table__drop-target')
    })
    grip.addEventListener('dragleave', () => cell.closest('tr')?.classList.remove('cm-writeit-table__drop-target'))
    grip.addEventListener('drop', (event) => {
      event.preventDefault()
      cell.closest('tr')?.classList.remove('cm-writeit-table__drop-target')
      const drag = this.structuralDrag
      this.structuralDrag = undefined
      if (!drag || drag.kind !== 'row' || drag.index === row) return
      this.interaction.select(this.table, row, 0, 'selected')
      this.interaction.mutate(this.table, moveTableRow(this.table, drag.index, row), 'input.table.reorder')
    })
    grip.addEventListener('dragend', () => { this.structuralDrag = undefined })
    cell.append(grip)
  }

  private addColumnControls(document: Document, cell: HTMLTableCellElement, column: number): void {
    const grip = document.createElement('button')
    grip.type = 'button'
    grip.className = 'cm-writeit-table__column-grip'
    grip.draggable = true
    grip.dataset.tableColumnGrip = String(column)
    grip.setAttribute('aria-label', `Select or move column ${column + 1}`)
    grip.textContent = '•••'
    grip.addEventListener('click', () => {
      this.interaction.selectRange(this.table, 0, column, this.table.rows.length - 1, column)
      this.applySelectionDom(cell.closest('table'))
    })
    grip.addEventListener('dragstart', (event) => {
      this.structuralDrag = { kind: 'column', index: column }
      event.dataTransfer?.setData('text/plain', `writeit-column:${column}`)
    })
    grip.addEventListener('dragover', (event) => {
      if (this.structuralDrag?.kind !== 'column') return
      event.preventDefault()
      cell.classList.add('cm-writeit-table__drop-target')
    })
    grip.addEventListener('dragleave', () => cell.classList.remove('cm-writeit-table__drop-target'))
    grip.addEventListener('drop', (event) => {
      event.preventDefault()
      cell.classList.remove('cm-writeit-table__drop-target')
      const drag = this.structuralDrag
      this.structuralDrag = undefined
      if (!drag || drag.kind !== 'column' || drag.index === column) return
      this.interaction.select(this.table, 0, column, 'selected')
      this.interaction.mutate(this.table, moveTableColumn(this.table, drag.index, column), 'input.table.reorder')
    })
    grip.addEventListener('dragend', () => { this.structuralDrag = undefined })
    cell.append(grip)

    const resize = document.createElement('span')
    resize.className = 'cm-writeit-table__resize-handle'
    resize.dataset.tableResizeColumn = String(column)
    resize.setAttribute('role', 'separator')
    resize.setAttribute('aria-orientation', 'vertical')
    resize.setAttribute('aria-label', `Resize column ${column + 1}`)
    resize.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = cell.getBoundingClientRect().width || this.interaction.columnWidth(this.table, column) || 112
      const col = cell.closest('table')?.querySelector<HTMLTableColElement>(`col[data-table-column="${column}"]`)
      const move = (moveEvent: PointerEvent) => {
        const width = Math.max(88, startWidth + moveEvent.clientX - startX)
        this.interaction.setColumnWidth(this.table, column, width)
        if (col) col.style.width = `${Math.round(width)}px`
      }
      const end = () => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', end)
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', end)
    })
    cell.append(resize)
  }

  private executeCommand(commandId: TableCommandId): void {
    const active = this.interaction.activeFor(this.table)
    const target = {
      row: active?.row ?? Math.min(1, this.table.rows.length - 1),
      column: active?.column ?? 0,
    }
    const edited = applyTableCommand(this.table, commandId, target)
    if (edited !== this.table) this.interaction.mutate(this.table, edited, 'input.table.command')
  }

  private renderCellContent(
    document: Document,
    view: EditorView,
    cellElement: HTMLTableCellElement,
    row: number,
    column: number,
    value: string,
  ): void {
    const active = this.interaction.activeFor(this.table)
    const bounds = active ? normalizeTableSelection({
      anchorRow: active.anchorRow,
      anchorColumn: active.anchorColumn,
      headRow: active.row,
      headColumn: active.column,
    }) : undefined
    const isSelected = bounds !== undefined && row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right
    const isActive = active?.row === row && active.column === column
    const mode = isActive ? active.mode : isSelected ? 'selected' : undefined
    cellElement.dataset.tableMode = mode ?? 'idle'
    cellElement.setAttribute('aria-selected', String(isSelected))
    if (mode === 'editing' && editableView(view)) {
      const editor = document.createElement('textarea')
      editor.className = 'cm-writeit-table__editor'
      editor.value = value
      editor.rows = Math.max(1, value.split('\n').length)
      editor.setAttribute('aria-label', `Edit row ${row + 1}, column ${column + 1}`)
      let composing = false
      editor.addEventListener('compositionstart', () => { composing = true })
      editor.addEventListener('compositionend', () => {
        composing = false
        this.commitEditor(editor, row, column)
      })
      editor.addEventListener('input', () => {
        if (!composing) this.commitEditor(editor, row, column)
      })
      editor.addEventListener('keydown', (event) => {
        if (composing || event.isComposing) return
        event.stopPropagation()
        if (event.key === 'Tab') {
          event.preventDefault()
          this.commitEditor(editor, row, column, false)
          this.navigate(row, column, event.shiftKey ? -1 : 1, 'tab')
        } else if (event.key === 'Enter') {
          // Keep logical cell newlines inside the textarea. Without handling
          // the key explicitly a browser/CM6 parent may receive Enter after
          // the widget re-renders and insert a physical line after the table.
          event.preventDefault()
          const start = editor.selectionStart
          const end = editor.selectionEnd
          editor.setRangeText('\n', start, end, 'end')
          this.commitEditor(editor, row, column)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          this.interaction.select(this.table, row, column, 'selected')
          this.interaction.requestActiveFocus()
        }
      })
      cellElement.append(editor)
      return
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-writeit-table__cell-button'
    button.disabled = !editableView(view)
    button.dataset.tableValue = value
    button.setAttribute('aria-label', `Select row ${row + 1}, column ${column + 1}`)
    value.split('\n').forEach((line, index) => {
      if (index > 0) button.append(document.createElement('br'))
      button.append(document.createTextNode(line || '\u00a0'))
    })
    button.addEventListener('pointerdown', (event) => {
      if (event.button === 0 && !event.shiftKey) this.interaction.beginDrag(this.table, row, column)
    })
    button.addEventListener('pointerenter', () => {
      if (this.interaction.extendDrag(this.table, row, column)) this.applySelectionDom(cellElement.closest('table'))
    })
    button.addEventListener('click', (event) => {
      if (this.interaction.consumeDraggedClick()) return
      this.interaction.select(this.table, row, column, 'selected', undefined, event.shiftKey)
      this.applySelectionDom(cellElement.closest('table'))
      button.focus()
    })
    button.addEventListener('dblclick', (event) => {
      event.preventDefault()
      this.interaction.select(this.table, row, column, 'editing', value.length)
      cellElement.replaceChildren()
      this.renderCellContent(document, view, cellElement, row, column, value)
      this.interaction.requestActiveFocus()
    })
    button.addEventListener('keydown', (event) => this.onSelectedKeyDown(event, row, column))
    button.addEventListener('copy', (event) => this.copySelection(event))
    button.addEventListener('cut', (event) => {
      this.copySelection(event)
      const selection = this.currentSelection()
      if (selection) this.interaction.mutate(this.table, clearTableSelection(this.table, selection), 'delete.cut')
    })
    button.addEventListener('paste', (event) => this.pasteSelection(event))
    cellElement.append(button)
  }

  private onSelectedKeyDown(event: KeyboardEvent, row: number, column: number): void {
    if (event.isComposing) return
    if (isPrintableKey(event)) {
      event.preventDefault()
      this.interaction.select(this.table, row, column, 'editing', event.key.length)
      this.interaction.mutate(this.table, updateTableCell(this.table, row, column, event.key), 'input.type')
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      this.navigateVertical(row, column)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      this.navigate(row, column, event.shiftKey ? -1 : 1, 'tab')
      return
    }
    const arrows: Record<string, readonly [number, number]> = {
      ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0],
    }
    const delta = arrows[event.key]
    if (delta) {
      event.preventDefault()
      this.interaction.select(
        this.table,
        Math.max(0, Math.min(this.table.rows.length - 1, row + delta[0])),
        Math.max(0, Math.min(this.table.alignments.length - 1, column + delta[1])),
        'selected',
        undefined,
        event.shiftKey,
      )
      this.interaction.requestActiveFocus()
    } else if (event.key === 'Escape') {
      this.interaction.focusSource()
    }
  }

  private navigateVertical(row: number, column: number): void {
    if (row < this.table.rows.length - 1) {
      this.interaction.select(this.table, row + 1, column, 'selected')
      this.interaction.requestActiveFocus()
      return
    }
    this.interaction.select(this.table, row + 1, column, 'selected')
    this.interaction.mutate(this.table, addTableRow(this.table, this.table.rows.length - 1), 'input.table')
  }

  private navigate(row: number, column: number, direction: -1 | 1, source: string): void {
    const width = this.table.alignments.length
    const flat = row * width + column + direction
    if (flat < 0) {
      this.interaction.select(this.table, 0, 0, 'selected')
      this.interaction.requestActiveFocus()
    } else if (flat >= this.table.rows.length * width) {
      this.interaction.select(this.table, this.table.rows.length, 0, 'selected')
      this.interaction.mutate(this.table, addTableRow(this.table, this.table.rows.length - 1), `input.${source}`)
    } else {
      this.interaction.select(this.table, Math.floor(flat / width), flat % width, 'selected')
      this.interaction.requestActiveFocus()
    }
  }

  private commitEditor(editor: HTMLTextAreaElement, row: number, column: number, focus = true): void {
    const value = editor.value.replace(/\r\n?/gu, '\n')
    if (value === this.table.rows[row][column].value) return
    this.interaction.select(this.table, row, column, 'editing', editor.selectionStart)
    this.interaction.mutate(this.table, updateTableCell(this.table, row, column, value), 'input.type')
    if (focus) this.interaction.requestActiveFocus()
  }

  private applySelectionDom(table: HTMLTableElement | null): void {
    const active = this.interaction.activeFor(this.table)
    const bounds = active ? normalizeTableSelection({
      anchorRow: active.anchorRow,
      anchorColumn: active.anchorColumn,
      headRow: active.row,
      headColumn: active.column,
    }) : undefined
    table?.querySelectorAll<HTMLElement>('th[data-table-column],td[data-table-column]').forEach((cell) => {
      const row = Number(cell.dataset.tableRow)
      const column = Number(cell.dataset.tableColumn)
      const selected = bounds !== undefined && row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right
      const head = row === active?.row && column === active?.column
      cell.dataset.tableMode = head ? active?.mode ?? 'selected' : selected ? 'selected' : 'idle'
      cell.setAttribute('aria-selected', String(selected))
    })
  }

  private currentSelection() {
    const active = this.interaction.activeFor(this.table)
    return active ? {
      anchorRow: active.anchorRow,
      anchorColumn: active.anchorColumn,
      headRow: active.row,
      headColumn: active.column,
    } : undefined
  }

  private copySelection(event: ClipboardEvent): void {
    const selection = this.currentSelection()
    if (!selection || !event.clipboardData) return
    const matrix = tableSelectionMatrix(this.table, selection)
    event.preventDefault()
    event.clipboardData.setData('text/plain', serializeTableTsv(matrix))
    event.clipboardData.setData('text/html', serializeTableHtml(matrix))
  }

  private pasteSelection(event: ClipboardEvent): void {
    const selection = this.currentSelection()
    if (!selection || !event.clipboardData) return
    try {
      const matrix = parseTableClipboard({
        html: event.clipboardData.getData('text/html') || undefined,
        text: event.clipboardData.getData('text/plain'),
      })
      event.preventDefault()
      this.interaction.mutate(this.table, pasteTableMatrix(this.table, selection, matrix.rows), 'input.paste')
    } catch {
      // Malformed clipboard data remains available to the browser; source is untouched.
    }
  }
}

export function tableDecorationRanges(
  markdownSource: string,
): readonly Range<Decoration>[] {
  return parseMarkdownTables(markdownSource).map((table) => ({
    from: table.range.from,
    to: table.range.to,
    value: Decoration.replace({ widget: new MarkdownTableWidget(table), block: true, inclusive: false }),
  }))
}

export function tableSourceRanges(markdownSource: string): readonly { from: number; to: number }[] {
  return parseMarkdownTables(markdownSource).map((table) => table.range)
}

function activeCommandContext(view: EditorView): {
  table: MarkdownTable
  target: { row: number; column: number }
  runtime: TableInteractionRuntime
} | null {
  if (!view.dom.querySelector('.cm-writeit-table')) return null
  const runtime = runtimeByView.get(view)
  if (!runtime) return null
  const tables = parseMarkdownTables(view.state.doc.toString())
  const table = tables.find((candidate) => runtime.activeFor(candidate) !== undefined)
  if (!table) return null
  const active = runtime.activeFor(table)!
  return { table, target: { row: active.row, column: active.column }, runtime }
}

export function canExecuteActiveTableCommand(view: EditorView, commandId: TableCommandId): boolean {
  const context = activeCommandContext(view)
  return context !== null && applyTableCommand(context.table, commandId, context.target) !== context.table
}

export function executeActiveTableCommand(view: EditorView, commandId: TableCommandId): boolean {
  const context = activeCommandContext(view)
  if (!context) return false
  const edited = applyTableCommand(context.table, commandId, context.target)
  if (edited === context.table) return false
  context.runtime.mutate(context.table, edited, 'input.table.command')
  return true
}
