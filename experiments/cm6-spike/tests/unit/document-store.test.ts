import { ChangeSet } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { DocumentConflictError, DocumentStore } from '../../src/core/document-store'
import { addColumn, addRow, deleteColumn, deleteRow, parseTables, pasteMatrix, replaceTable, updateCell } from '../../src/table/core'

describe('DocumentStore', () => {
  it('keeps one Markdown authority and propagates a ChangeSet to every projection', () => {
    const store = new DocumentStore({ 'A.md': 'Hello' })
    const seen: string[] = []
    store.subscribe('A.md', 'A-tab', (event) => seen.push(`A:${event.toRevision}:${event.after}`))
    store.subscribe('A.md', 'B/embed-A', (event) => seen.push(`B:${event.toRevision}:${event.after}`))

    const revision = store.applyChanges(
      'A.md',
      { fromRevision: 1, changes: ChangeSet.of({ from: 5, insert: ' world' }, 5) },
      'B/embed-A',
    )

    expect(revision).toBe(2)
    expect(store.get('A.md')).toMatchObject({ markdown: 'Hello world', revision: 2 })
    expect(seen).toEqual(['A:2:Hello world', 'B:2:Hello world'])
    expect(store.diagnostics().documents).toEqual([
      expect.objectContaining({ id: 'A.md', markdown: 'Hello world', revision: 2, dirty: true }),
    ])
  })

  it('rejects stale snapshots instead of silently overwriting a newer revision', () => {
    const store = new DocumentStore({ 'A.md': 'A' })
    store.replace('A.md', 'AB', 'A-tab')
    expect(() =>
      store.applyChanges('A.md', { fromRevision: 1, changes: ChangeSet.of({ from: 1, insert: '!' }, 1) }, 'B/embed-A'),
    ).toThrowError(DocumentConflictError)
    expect(store.get('A.md').markdown).toBe('AB')
  })

  it('supports source-level undo and redo across projections', () => {
    const store = new DocumentStore({ 'A.md': 'one' })
    store.subscribe('A.md', 'A-tab', () => undefined)
    store.replace('A.md', 'one two', 'B/embed-A', 'cell-edit')
    store.replace('A.md', 'one two three', 'A-tab', 'typing')
    expect(store.get('A.md').markdown).toBe('one two three')
    store.undo('A.md', 'A-tab')
    expect(store.get('A.md').markdown).toBe('one two')
    store.undo('A.md', 'B/embed-A')
    expect(store.get('A.md').markdown).toBe('one')
    store.redo('A.md', 'A-tab')
    expect(store.get('A.md').markdown).toBe('one two')
  })

  it('undoes and redoes every P0 table mutation through the source history', () => {
    const source = '| A | B |\n| --- | ---: |\n| 1 | 2 |\n| 3 | 4 |\n'
    const store = new DocumentStore({ 'table.md': source })
    const expected: string[] = [source]
    const mutations = [
      (table: ReturnType<typeof parseTables>[number]) => updateCell(table, 1, 1, '20'),
      (table: ReturnType<typeof parseTables>[number]) => pasteMatrix(table, { anchorRow: 1, anchorColumn: 0, headRow: 1, headColumn: 0 }, [['X', 'Y'], ['Z', 'W']]),
      (table: ReturnType<typeof parseTables>[number]) => addRow(table),
      (table: ReturnType<typeof parseTables>[number]) => deleteRow(table, 2),
      (table: ReturnType<typeof parseTables>[number]) => addColumn(table),
      (table: ReturnType<typeof parseTables>[number]) => deleteColumn(table, 2),
    ]
    for (const mutate of mutations) {
      const current = store.get('table.md').markdown
      const table = parseTables(current)[0]
      store.replace('table.md', replaceTable(current, mutate(table)), 'table-test', 'table-operation')
      expected.push(store.get('table.md').markdown)
    }

    for (let index = expected.length - 2; index >= 0; index--) {
      store.undo('table.md', 'table-test')
      expect(store.get('table.md').markdown).toBe(expected[index])
    }
    for (let index = 1; index < expected.length; index++) {
      store.redo('table.md', 'table-test')
      expect(store.get('table.md').markdown).toBe(expected[index])
    }
  })

  it('detects and reports a stale projection explicitly', () => {
    const store = new DocumentStore({ 'A.md': 'A' })
    store.subscribe('A.md', 'B/embed-A', () => undefined)
    store.markStale('A.md', 'B/embed-A')
    expect(store.diagnostics().projections).toContainEqual({ key: 'B/embed-A', documentId: 'A.md', revision: 0, stale: true })
    store.clearStale('A.md', 'B/embed-A')
    expect(store.diagnostics().projections[0]).toMatchObject({ revision: 1, stale: false })
  })
})
