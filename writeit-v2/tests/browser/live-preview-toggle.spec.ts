import { expect, test, type Page } from '@playwright/test'

type PresentationHarness = {
  locator: unknown
  store: {
    get(locator: unknown): { markdown: string; revision: number } | undefined
    getHistory(locator: unknown): {
      undo: readonly unknown[]
      redo: readonly unknown[]
    }
  }
  projection: {
    destroy(): void
    presentationMode: string
    view: {
      state: {
        doc: { toString(): string }
        selection: { main: { anchor: number; head: number } }
      }
      dom: HTMLElement
      contentDOM: HTMLElement
    }
  }
}

async function mountHarness(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(async () => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/index.ts')

    const root = document.createElement('section')
    root.dataset.browserPresentationHarness = 'true'
    const host = document.createElement('div')
    host.dataset.testid = 'presentation-editor'
    root.append(host)
    document.body.append(root)

    const source = '# Heading\n\nA **strong** [link](https://example.test).'
    const store = new core.DocumentStore()
    const id = core.createDocumentId('browser-presentation-document')
    const path = core.createDocumentPath('browser-presentation-document.md')
    const locator = core.documentById(id)
    store.load({ id, path, markdown: source })
    const projection = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: host,
      projectionId: 'browser-presentation-editor',
      editable: true,
    })

    ;(
      window as unknown as {
        __writeItV2PresentationHarness?: PresentationHarness
      }
    ).__writeItV2PresentationHarness = { locator, store, projection }
  })
}

async function readHarness(page: Page): Promise<{
  source: string
  revision: number
  presentationMode: string
  editorCount: number
  contentText: string
  selection: { anchor: number; head: number }
  history: { undo: readonly unknown[]; redo: readonly unknown[] }
}> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2PresentationHarness?: PresentationHarness
      }
    ).__writeItV2PresentationHarness
    if (!harness) throw new Error('presentation harness is not mounted')
    const snapshot = harness.store.get(harness.locator)
    if (!snapshot) throw new Error('presentation document is missing')
    const state = harness.projection.view.state
    return {
      source: snapshot.markdown,
      revision: snapshot.revision,
      presentationMode: harness.projection.presentationMode,
      editorCount: harness.projection.view.dom.ownerDocument.querySelectorAll(
        '[data-testid="presentation-editor"] .cm-editor',
      ).length,
      contentText: harness.projection.view.contentDOM.textContent ?? '',
      selection: {
        anchor: state.selection.main.anchor,
        head: state.selection.main.head,
      },
      history: harness.store.getHistory(harness.locator),
    }
  })
}

test('toggles Raw Source and Live Preview in one CM6 editor with Ctrl/Cmd+E', async ({
  page,
}) => {
  await mountHarness(page)
  const editor = page.locator(
    '[data-testid="presentation-editor"] .cm-content',
  )
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('!')

  const beforeToggle = await readHarness(page)
  const shortcut = process.platform === 'darwin' ? 'Meta+E' : 'Control+E'
  await page.keyboard.press(shortcut)

  let state = await readHarness(page)
  expect(state.presentationMode).toBe('live-preview')
  expect(state.editorCount).toBe(1)
  expect(state.source).toBe(beforeToggle.source)
  expect(state.revision).toBe(beforeToggle.revision)
  expect(state.history).toEqual(beforeToggle.history)
  expect(state.selection).toEqual(beforeToggle.selection)
  expect(state.contentText).toContain('Heading')
  expect(state.contentText).toContain('strong')
  expect(state.contentText).not.toContain('**strong**')
  expect(state.contentText).not.toContain('[link]')

  await page.keyboard.insertText(' editable')
  await expect
    .poll(async () => (await readHarness(page)).source)
    .toContain(' editable')

  await page.keyboard.press(shortcut)
  state = await readHarness(page)
  expect(state.presentationMode).toBe('source')
  expect(state.source).toContain('**strong**')
  expect(state.source).toContain('[link](https://example.test)')
  expect(state.contentText).toContain('**strong**')
  expect(state.contentText).toContain('[link](https://example.test)')

  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2PresentationHarness?: PresentationHarness
      }
    ).__writeItV2PresentationHarness
    harness?.projection.destroy()
  })
})
