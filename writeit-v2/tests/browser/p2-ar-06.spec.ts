import { expect, test, type Page } from '@playwright/test'

type BrowserHarness = {
  locator: unknown
  store: {
    get(locator: unknown):
      | { markdown: string; revision: number; dirty: boolean }
      | undefined
    getHistory(locator: unknown): {
      undo: readonly unknown[]
      redo: readonly unknown[]
      undoBytes: number
      redoBytes: number
      totalBytes: number
      maxEntries: number
      maxBytes: number
    }
  }
  primary: {
    view: {
      state: {
        doc: { toString(): string; length: number }
        selection: { main: { anchor: number; head: number } }
      }
      dispatch(spec: { changes: unknown }): void
    }
    destroy(): void
  }
  secondary: {
    view: {
      state: {
        doc: { toString(): string }
        selection: { main: { anchor: number; head: number } }
      }
    }
    destroy(): void
  }
}

async function mountHarness(
  page: Page,
  source: string,
  maxBytes = 8 * 1024 * 1024,
): Promise<void> {
  await page.goto('/')
  await page.evaluate(async ({ initialSource, historyMaxBytes }) => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/index.ts')

    const root = document.createElement('section')
    root.dataset.p2Ar06Harness = 'true'
    const primaryHost = document.createElement('div')
    primaryHost.dataset.testid = 'p2-ar-06-primary'
    const secondaryHost = document.createElement('div')
    secondaryHost.dataset.testid = 'p2-ar-06-secondary'
    root.append(primaryHost, secondaryHost)
    document.body.append(root)

    const store = new core.DocumentStore({
      history: { maxEntries: 1_000, maxBytes: historyMaxBytes },
    })
    const id = core.createDocumentId('p2-ar-06-document')
    const path = core.createDocumentPath('p2-ar-06-document.md')
    const locator = core.documentById(id)
    store.load({ id, path, markdown: initialSource })
    const primary = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: primaryHost,
      projectionId: 'p2-ar-06-primary',
      editable: true,
    })
    const secondary = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: secondaryHost,
      projectionId: 'p2-ar-06-secondary',
      editable: true,
    })

    ;(
      window as unknown as { __writeItV2P2Ar06Harness?: BrowserHarness }
    ).__writeItV2P2Ar06Harness = { locator, store, primary, secondary }
  }, { initialSource: source, historyMaxBytes: maxBytes })
}

async function readHarness(page: Page): Promise<{
  source: string
  revision: number
  secondarySelection: { anchor: number; head: number }
  historyBytes: number
  historyEntries: number
}> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2P2Ar06Harness?: BrowserHarness }
    ).__writeItV2P2Ar06Harness
    if (!harness) throw new Error('P2-AR-06 harness is not mounted')
    const document = harness.store.get(harness.locator)
    if (!document) throw new Error('P2-AR-06 document is missing')
    const history = harness.store.getHistory(harness.locator)
    return {
      source: document.markdown,
      revision: document.revision,
      secondarySelection: {
        anchor: harness.secondary.view.state.selection.main.anchor,
        head: harness.secondary.view.state.selection.main.head,
      },
      historyBytes: history.totalBytes,
      historyEntries: history.undo.length + history.redo.length,
    }
  })
}

async function destroyHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2P2Ar06Harness?: BrowserHarness }
    ).__writeItV2P2Ar06Harness
    harness?.primary.destroy()
    harness?.secondary.destroy()
  })
}

test('preserves a secondary caret when Store fan-out inserts at the source start', async ({
  page,
}) => {
  await mountHarness(page, '0123456789')
  const secondary = page.locator(
    '[data-testid="p2-ar-06-secondary"] .cm-content',
  )
  await secondary.click()
  await page.keyboard.press('End')

  await page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2P2Ar06Harness?: BrowserHarness }
    ).__writeItV2P2Ar06Harness
    if (!harness) throw new Error('P2-AR-06 harness is not mounted')
    harness.primary.view.dispatch({
      changes: { from: 0, insert: '!' },
    })
  })

  await expect
    .poll(async () => (await readHarness(page)).source)
    .toBe('!0123456789')
  const state = await readHarness(page)
  expect(state.secondarySelection).toEqual({ anchor: 11, head: 11 })
  await destroyHarness(page)
})

test('keeps large-document history within the byte budget without source loss', async ({
  page,
}) => {
  const source = `${'x'.repeat(250_000)}\n`
  await mountHarness(page, source, 32)

  await page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2P2Ar06Harness?: BrowserHarness }
    ).__writeItV2P2Ar06Harness
    if (!harness) throw new Error('P2-AR-06 harness is not mounted')
    for (let index = 0; index < 48; index += 1) {
      const end = harness.primary.view.state.doc.length
      harness.primary.view.dispatch({
        changes: { from: end, insert: '!' },
      })
    }
  })

  const state = await readHarness(page)
  expect(state.source.slice(0, 250_000)).toBe('x'.repeat(250_000))
  expect(state.source.endsWith(`\n${'!'.repeat(48)}`)).toBe(true)
  expect(state.revision).toBe(48)
  expect(state.historyBytes).toBeLessThanOrEqual(32)
  expect(state.historyEntries).toBeLessThanOrEqual(32)
  await destroyHarness(page)
})
