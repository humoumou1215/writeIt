// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import {
  mountSingleDocumentView,
  projectMarkdownSource,
  type SingleDocumentView,
} from '../../../../src/editor/cm6'

const mountedViews: SingleDocumentView[] = []
const lineEndingFixtures = [
  { name: 'lf', source: 'one\n two\nthree\nfour\n' },
  { name: 'crlf', source: 'one\r\n two\r\nthree\r\nfour\r\n' },
  { name: 'cr', source: 'one\r two\rthree\rfour\r' },
  { name: 'mixed', source: 'one\r\n two\nthree\rfour\nfive\r\n' },
] as const

function makeStore(markdown: string, name: string): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
} {
  const store = new DocumentStore()
  const id = createDocumentId(`source-fidelity-${name}`)
  const path = createDocumentPath(`source-fidelity-${name}.md`)
  store.load({ id, path, markdown })
  return { store, locator: documentById(id) }
}

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy()
})

describe('CM6 source-fidelity projection', () => {
  it.each(lineEndingFixtures)(
    'mounts $name without changing authoritative source or dirty state',
    ({ source, name }) => {
      const { store, locator } = makeStore(source, name)
      const before = store.get(locator)
      if (!before) throw new Error('fixture document was not loaded')

      const projection = mountSingleDocumentView({
        store,
        locator,
        parent: document.body,
        projectionId: `source-fidelity-${name}`,
        editable: true,
      })
      mountedViews.push(projection)

      expect(store.get(locator)).toBe(before)
      expect(store.get(locator)?.markdown).toBe(source)
      expect(store.get(locator)?.revision).toBe(0)
      expect(store.get(locator)?.dirty).toBe(false)
      expect(projection.view.state.doc.toString()).toBe(
        projectMarkdownSource(source).projected,
      )
    },
  )

  it.each(lineEndingFixtures)(
    'applies a targeted $name edit while preserving unrelated separators',
    ({ source, name }) => {
      const { store, locator } = makeStore(source, `${name}-edit`)
      const projection = mountSingleDocumentView({
        store,
        locator,
        parent: document.body,
        projectionId: `source-fidelity-${name}-edit`,
        editable: true,
      })
      mountedViews.push(projection)

      const projected = projectMarkdownSource(source).projected
      const from = projected.indexOf('two')
      if (from < 0) throw new Error('fixture edit marker is missing')
      projection.view.dispatch({
        changes: { from, to: from + 'two'.length, insert: 'edited' },
      })

      const expected = source.replace('two', 'edited')
      expect(store.get(locator)?.markdown).toBe(expected)
      expect(store.get(locator)?.revision).toBe(1)
      expect(store.get(locator)?.dirty).toBe(true)
      expect(projection.view.state.doc.toString()).toBe(
        projectMarkdownSource(expected).projected,
      )
    },
  )

  it('keeps exact separators through Store fan-out, undo, and redo', () => {
    const source = 'one\r\ntwo\rthree\nfour\r\n'
    const { store, locator } = makeStore(source, 'history')
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'source-fidelity-history',
      editable: true,
    })
    mountedViews.push(projection)

    const edited = source.replace('two', 'edited')
    const editOrigin = createDocumentOrigin('test', 'source-fidelity-edit')
    store.applyChange(locator, { markdown: edited, origin: editOrigin })
    expect(projection.view.state.doc.toString()).toBe(
      projectMarkdownSource(edited).projected,
    )

    const undo = store.undo(
      locator,
      createDocumentOrigin('command', 'source-fidelity-undo'),
    )
    expect(undo.markdown).toBe(source)
    expect(projection.view.state.doc.toString()).toBe(
      projectMarkdownSource(source).projected,
    )

    const redo = store.redo(
      locator,
      createDocumentOrigin('command', 'source-fidelity-redo'),
    )
    expect(redo.markdown).toBe(edited)
    expect(projection.view.state.doc.toString()).toBe(
      projectMarkdownSource(edited).projected,
    )
  })
})
