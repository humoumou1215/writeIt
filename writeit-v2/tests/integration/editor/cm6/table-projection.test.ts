// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  createDocumentId,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import { mountSingleDocumentView } from '../../../../src/editor/cm6'
import { TABLE_COMMAND_IDS } from '../../../../src/core/table'

const markdown = '| Name | Note |\n| --- | --- |\n| Alice | first<br>second |\n| Bob | third |\n'

function mount(source = markdown) {
  document.body.replaceChildren()
  const store = new DocumentStore()
  const id = createDocumentId('table-projection')
  const locator = documentById(id)
  store.load({ id, path: createDocumentPath('table.md'), markdown: source })
  const projection = mountSingleDocumentView({
    store,
    locator,
    parent: document.body,
    projectionId: 'table-editor',
    editable: true,
    presentationMode: 'live-preview',
  })
  return { store, locator, projection }
}

function cell(row: number, column: number): HTMLTableCellElement {
  const found = document.querySelector<HTMLTableCellElement>(
    `.cm-writeit-table [data-table-row="${row}"][data-table-column="${column}"]`,
  )
  if (!found) throw new Error(`Missing table cell ${row}:${column}`)
  return found
}

function clipboardEvent(type: 'copy' | 'cut' | 'paste', initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (format: string) => values.get(format) ?? '',
      setData: (format: string, value: string) => { values.set(format, value) },
    },
  })
  return { event, values }
}

describe('CM6 table projection', () => {
  it('projects valid tables and keeps logical breaks visible', () => {
    const { projection } = mount()
    expect(document.querySelector('.cm-writeit-table')).not.toBeNull()
    expect(cell(1, 1).querySelectorAll('br')).toHaveLength(1)
    expect(cell(1, 1).textContent).toBe('firstsecond')
    projection.destroy()
  })

  it('single-click selects without a caret and printable input replaces the cell', () => {
    const { store, locator, projection } = mount()
    const button = cell(1, 0).querySelector<HTMLButtonElement>('button')!
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(cell(1, 0).dataset.tableMode).toBe('selected')
    expect(cell(1, 0).querySelector('textarea')).toBeNull()
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', bubbles: true }))
    expect(store.get(locator)?.markdown).toContain('| Z | first<br>second |')
    expect(store.getRevision(locator)).toBe(1)
    projection.destroy()
  })

  it('double-click enters text editing and Enter becomes a persisted logical break', () => {
    const { store, locator, projection } = mount()
    const button = cell(2, 1).querySelector<HTMLButtonElement>('button')!
    button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    const editor = cell(2, 1).querySelector<HTMLTextAreaElement>('textarea')!
    expect(editor).not.toBeNull()
    editor.value = 'third\nline'
    editor.setSelectionRange(editor.value.length, editor.value.length)
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLineBreak' }))
    expect(store.get(locator)?.markdown).toContain('| Bob | third<br>line |')
    projection.destroy()
  })

  it('selected Enter moves vertically and appends a row at the final data row', () => {
    const { store, locator, projection } = mount()
    const button = cell(2, 0).querySelector<HTMLButtonElement>('button')!
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(store.get(locator)?.markdown).toContain('|  |  |')
    expect(document.querySelector('[data-table-row="3"][data-table-column="0"]')).not.toBeNull()
    projection.destroy()
  })

  it('switches to exact Raw Source and safely restores the widget', () => {
    const { store, locator, projection } = mount()
    projection.setPresentationMode('source')
    expect(document.querySelector('.cm-writeit-table')).toBeNull()
    expect(projection.view.state.doc.toString()).toBe(markdown)
    projection.setPresentationMode('live-preview')
    expect(document.querySelector('.cm-writeit-table')).not.toBeNull()
    expect(store.get(locator)?.markdown).toBe(markdown)
    expect(store.getRevision(locator)).toBe(0)
    projection.destroy()
  })

  it('leaves malformed tables as source text', () => {
    const malformed = '| A | B |\n| -- | --- |\n| one | two |\n'
    const { projection } = mount(malformed)
    expect(document.querySelector('.cm-writeit-table')).toBeNull()
    expect(projection.view.state.doc.toString()).toBe(malformed)
    projection.destroy()
  })

  it('extends a rectangle with Shift-click and copies TSV plus safe HTML', () => {
    const { projection } = mount()
    cell(1, 0).querySelector<HTMLButtonElement>('button')!.click()
    cell(2, 1).querySelector<HTMLButtonElement>('button')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, shiftKey: true }),
    )
    expect(document.querySelectorAll('.cm-writeit-table [aria-selected="true"]')).toHaveLength(4)
    const copied = clipboardEvent('copy')
    cell(2, 1).querySelector<HTMLButtonElement>('button')!.dispatchEvent(copied.event)
    expect(copied.values.get('text/plain')).toBe('Alice\t"first\nsecond"\nBob\tthird')
    expect(copied.values.get('text/html')).toContain('first<br>second')
    projection.destroy()
  })

  it('pastes a multiline HTML/TSV matrix from the top-left selected cell', () => {
    const { store, locator, projection } = mount()
    const button = cell(1, 0).querySelector<HTMLButtonElement>('button')!
    button.click()
    const pasted = clipboardEvent('paste', {
      'text/html': '<table><tr><td>甲<br>乙</td><td>001</td></tr><tr><td>😀</td><td>Z</td></tr></table>',
      'text/plain': 'fallback',
    })
    button.dispatchEvent(pasted.event)
    expect(store.get(locator)?.markdown).toContain('| 甲<br>乙 | 001 |\n| 😀 | Z |')
    projection.destroy()
  })

  it('does not commit or navigate while IME composition is active', () => {
    const { store, locator, projection } = mount()
    cell(1, 0).querySelector<HTMLButtonElement>('button')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    const editor = cell(1, 0).querySelector<HTMLTextAreaElement>('textarea')!
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    editor.value = '中文'
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: '中文' }))
    editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }))
    expect(store.getRevision(locator)).toBe(0)
    editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }))
    expect(store.getRevision(locator)).toBe(1)
    expect(store.get(locator)?.markdown).toContain('| 中文 | first<br>second |')
    projection.destroy()
  })

  it('runs toolbar and public shortcut commands through stable table command ids', () => {
    const { store, locator, projection } = mount()
    cell(1, 0).querySelector<HTMLButtonElement>('button')!.click()
    expect(projection.canExecuteTableCommand(TABLE_COMMAND_IDS.addRowAfter)).toBe(true)
    expect(projection.executeTableCommand(TABLE_COMMAND_IDS.addRowAfter)).toBe(true)
    expect(store.get(locator)?.markdown.match(/^\|/gmu)).toHaveLength(5)
    document.querySelector<HTMLButtonElement>(`[data-table-command="${TABLE_COMMAND_IDS.addColumnAfter}"]`)!.click()
    expect(store.get(locator)?.markdown).toContain('| Name |  | Note |')
    projection.destroy()
  })

  it('resizes a column as runtime-only projection state without a source revision', () => {
    const { store, locator, projection } = mount()
    const handle = document.querySelector<HTMLElement>('[data-table-resize-column="0"]')!
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }))
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 180 }))
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 180 }))
    expect(document.querySelector<HTMLTableColElement>('col[data-table-column="0"]')!.style.width).toBe('192px')
    expect(store.get(locator)?.markdown).toBe(markdown)
    expect(store.getRevision(locator)).toBe(0)
    projection.destroy()
  })

  it('selects whole rows/columns from grips and reorders by drag/drop through source history', () => {
    const { store, locator, projection } = mount()
    document.querySelector<HTMLButtonElement>('[data-table-row-grip="1"]')!.click()
    expect(document.querySelectorAll('.cm-writeit-table [aria-selected="true"]')).toHaveLength(2)
    document.querySelector<HTMLButtonElement>('[data-table-column-grip="1"]')!.click()
    expect(document.querySelectorAll('.cm-writeit-table [aria-selected="true"]')).toHaveLength(3)
    const first = document.querySelector<HTMLButtonElement>('[data-table-row-grip="1"]')!
    const second = document.querySelector<HTMLButtonElement>('[data-table-row-grip="2"]')!
    first.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }))
    second.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
    second.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    expect(store.get(locator)?.markdown).toContain('| Bob | third |\n| Alice | first<br>second |')
    expect(store.getRevision(locator)).toBe(1)
    projection.destroy()
  })
})
