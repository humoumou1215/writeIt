import { describe, expect, it } from 'vitest'
import { applyTableMutation } from '../../../../src/application/table'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import { moveTableColumn, updateTableCell } from '../../../../src/core/table'

function setup() {
  const markdown = 'before  \n\n| A | B |\n| --- | ---: |\n| one | two |\n\nafter 😀\n'
  const store = new DocumentStore()
  const id = createDocumentId('table-document')
  store.load({ id, path: createDocumentPath('table.md'), markdown })
  return { store, locator: documentById(id), markdown, tableOffset: markdown.indexOf('| A') }
}

describe('application table mutation bridge', () => {
  it('commits only the table source range and round-trips through undo/redo', () => {
    const { store, locator, markdown, tableOffset } = setup()
    const changed = applyTableMutation(store, locator, tableOffset, (table) => updateTableCell(table, 1, 1, 'line 1\nline 2'))
    expect(changed.markdown).toBe('before  \n\n| A | B |\n| --- | ---: |\n| one | line 1<br>line 2 |\n\nafter 😀\n')
    const event = [...store.getTimeline(locator)].reverse().find((entry) => entry.type === 'DocumentChanged')
    expect(event).toMatchObject({ type: 'DocumentChanged' })
    expect(store.undo(locator, createDocumentOrigin('test', 'undo'))?.markdown).toBe(markdown)
    expect(store.redo(locator, createDocumentOrigin('test', 'redo'))?.markdown).toBe(changed.markdown)
  })

  it('fans one mutation out to every attached projection without table-owned state', () => {
    const { store, locator, tableOffset } = setup()
    store.attachProjection(locator, 'table-view-a')
    store.attachProjection(locator, 'table-view-b')
    const observed: string[] = []
    store.subscribe(locator, (event) => {
      if (event.type === 'changed') observed.push(event.document.markdown)
    })
    const changed = applyTableMutation(store, locator, tableOffset, (table) => moveTableColumn(table, 1, 0))
    expect(observed).toEqual([changed.markdown])
    expect(store.getRevision(locator)).toBe(1)
    expect(changed.markdown).toContain('| B | A |\n| ---: | --- |\n| two | one |')
  })

  it('fails closed when no valid table exists at the offset', () => {
    const { store, locator } = setup()
    expect(() => applyTableMutation(store, locator, 0, (table) => table)).toThrow(/No valid Markdown table/u)
    expect(store.getRevision(locator)).toBe(0)
  })
})
