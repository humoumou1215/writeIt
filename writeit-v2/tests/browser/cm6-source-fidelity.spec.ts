import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const unknownMarkdown = readFileSync(
  new URL('../fixtures/source-fidelity/unknown-markdown.md', import.meta.url),
  'utf8',
)
const browserLineEndingFixtures = ['crlf', 'mixed'].map((name) => ({
  name,
  source: readFileSync(
    new URL(`../fixtures/source-fidelity/${name}.md`, import.meta.url),
    'utf8',
  ),
}))

type BrowserProjectionState = {
  projectionId: string
  revision: number
  stale: boolean
  degraded: boolean
  degradedReason?: string
}

type BrowserHarness = {
  locator: unknown
  store: {
    get(locator: unknown):
      | { markdown: string; revision: number; dirty: boolean }
      | undefined
    getProjections(locator: unknown): readonly BrowserProjectionState[]
  }
  primary: {
    displayedRevision: number
    view: {
      state: { doc: { toString(): string } }
      focus(): void
      dispatch(spec: { changes: unknown }): void
    }
    projectionState: BrowserProjectionState
    destroy(): void
  }
  secondary: {
    displayedRevision: number
    view: { state: { doc: { toString(): string } } }
    projectionState: BrowserProjectionState
    destroy(): void
  }
  preview: {
    displayedRevision: number
    parent: HTMLElement
    renderMode: string
    projectionState: BrowserProjectionState
    retryRender(): void
    destroy(): void
  }
  setPreviewFailure(next: boolean): void
}

type BrowserHarnessState = {
  source: string
  revision: number
  dirty: boolean
  primaryDocument: string
  secondaryDocument: string
  previewText: string
  previewMode: string
  projections: readonly BrowserProjectionState[]
}

async function mountHarness(
  page: Page,
  markdown: string,
  previewFails = false,
): Promise<void> {
  await page.goto('/')
  await page.evaluate(async ({ source, shouldFail }) => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const cm6 = await loadModule(
      '/src/editor/cm6/projection/single-document-view.ts',
    )
    const previewModule = await loadModule(
      '/src/editor/preview/basic-live-preview.ts',
    )

    document.querySelector('[data-browser-harness]')?.remove()
    const root = document.createElement('section')
    root.dataset.browserHarness = 'true'
    const primaryHost = document.createElement('div')
    primaryHost.dataset.testid = 'browser-primary-editor'
    const secondaryHost = document.createElement('div')
    secondaryHost.dataset.testid = 'browser-secondary-editor'
    const previewHost = document.createElement('div')
    previewHost.dataset.testid = 'browser-preview'
    root.append(primaryHost, secondaryHost, previewHost)
    document.body.append(root)

    const store = new core.DocumentStore()
    const id = core.createDocumentId('browser-document')
    const path = core.createDocumentPath('browser-document.md')
    const locator = core.documentById(id)
    store.load({ id, path, markdown: source })

    let failPreview = shouldFail
    const primary = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: primaryHost,
      projectionId: 'browser-primary',
      editable: true,
    })
    const secondary = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: secondaryHost,
      projectionId: 'browser-secondary',
    })
    const preview = previewModule.mountBasicLivePreview({
      store,
      locator,
      parent: previewHost,
      projectionId: 'browser-preview',
      renderer: (host: HTMLElement, markdownSource: string): void => {
        if (failPreview) throw new Error('browser rich renderer failure')
        previewModule.renderBasicMarkdownPreview(host, markdownSource)
      },
    })

    ;(
      window as unknown as { __writeItV2BrowserHarness?: BrowserHarness }
    ).__writeItV2BrowserHarness = {
      locator,
      store,
      primary,
      secondary,
      preview,
      setPreviewFailure(next: boolean): void {
        failPreview = next
      },
    }
  }, { source: markdown, shouldFail: previewFails })
}

async function readHarnessState(page: Page): Promise<BrowserHarnessState> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2BrowserHarness?: BrowserHarness }
    ).__writeItV2BrowserHarness
    if (!harness) throw new Error('browser harness is not mounted')
    const state = harness.store.get(harness.locator)
    if (!state) throw new Error('browser harness document is missing')

    return {
      source: state.markdown,
      revision: state.revision,
      dirty: state.dirty,
      primaryDocument: harness.primary.view.state.doc.toString(),
      secondaryDocument: harness.secondary.view.state.doc.toString(),
      previewText: harness.preview.parent.textContent ?? '',
      previewMode: harness.preview.renderMode,
      projections: harness.store.getProjections(harness.locator),
    }
  })
}

async function destroyHarness(page: Page): Promise<{
  source: string
  projectionCount: number
  editorNodes: number
  previewNodes: number
}> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2BrowserHarness?: BrowserHarness }
    ).__writeItV2BrowserHarness
    if (!harness) throw new Error('browser harness is not mounted')
    harness.primary.destroy()
    harness.secondary.destroy()
    harness.preview.destroy()
    const state = harness.store.get(harness.locator)
    if (!state) throw new Error('browser harness document was destroyed')

    return {
      source: state.markdown,
      projectionCount: harness.store.getProjections(harness.locator).length,
      editorNodes: document.querySelectorAll(
        '[data-testid="browser-primary-editor"] .cm-editor, [data-testid="browser-secondary-editor"] .cm-editor',
      ).length,
      previewNodes: document.querySelectorAll(
        '[data-testid="browser-preview"] > *',
      ).length,
    }
  })
}

for (const fixture of browserLineEndingFixtures) {
  test(`preserves ${fixture.name} line endings through a targeted Chromium edit`, async ({
    page,
  }) => {
    await mountHarness(page, fixture.source)

    let state = await readHarnessState(page)
    expect(state.source).toBe(fixture.source)
    expect(state.revision).toBe(0)
    expect(state.dirty).toBe(false)

    const projected = fixture.source.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    expect(state.primaryDocument).toBe(projected)

    await page.evaluate(() => {
      const harness = (
        window as unknown as { __writeItV2BrowserHarness?: BrowserHarness }
      ).__writeItV2BrowserHarness
      if (!harness) throw new Error('browser harness is not mounted')
      const source = harness.primary.view.state.doc.toString()
      const from = source.indexOf('two')
      if (from < 0) throw new Error('fixture edit marker is missing')
      harness.primary.view.dispatch({
        changes: { from, to: from + 'two'.length, insert: 'edited' },
      })
    })

    const expected = fixture.source.replace('two', 'edited')
    await expect
      .poll(async () => (await readHarnessState(page)).source)
      .toBe(expected)

    state = await readHarnessState(page)
    expect(state.revision).toBe(1)
    expect(state.dirty).toBe(true)
    expect(state.primaryDocument).toBe(
      expected.replaceAll('\r\n', '\n').replaceAll('\r', '\n'),
    )
    await destroyHarness(page)
  })
}

test('mounts, types through CM6, fans out to a second projection and preview, then destroys cleanly', async ({
  page,
}) => {
  await mountHarness(page, 'Browser source')

  const primaryContent = page.locator(
    '[data-testid="browser-primary-editor"] .cm-content',
  )
  await expect(primaryContent).toHaveAttribute('contenteditable', 'true')
  await primaryContent.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText('typed in real Chromium')

  await expect
    .poll(async () => (await readHarnessState(page)).source)
    .toBe('typed in real Chromium')

  const state = await readHarnessState(page)
  expect(state.revision).toBeGreaterThan(0)
  expect(state.primaryDocument).toBe(state.source)
  expect(state.secondaryDocument).toBe(state.source)
  expect(state.previewText).toContain('typed in real Chromium')
  expect(state.projections).toEqual([
    expect.objectContaining({
      projectionId: 'browser-primary',
      revision: state.revision,
      stale: false,
      degraded: false,
    }),
    expect.objectContaining({
      projectionId: 'browser-secondary',
      revision: state.revision,
      stale: false,
      degraded: false,
    }),
    expect.objectContaining({
      projectionId: 'browser-preview',
      revision: state.revision,
      stale: false,
      degraded: false,
    }),
  ])

  const destroyed = await destroyHarness(page)
  expect(destroyed).toEqual({
    source: 'typed in real Chromium',
    projectionCount: 0,
    editorNodes: 0,
    previewNodes: 0,
  })
})

test('preserves the unknown-Markdown corpus byte-for-byte outside a targeted CM6 edit', async ({
  page,
}) => {
  await mountHarness(page, unknownMarkdown)

  await page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2BrowserHarness?: BrowserHarness }
    ).__writeItV2BrowserHarness
    if (!harness) throw new Error('browser harness is not mounted')
    harness.primary.view.focus()
  })
  await page.keyboard.insertText('targeted prefix: ')

  await expect
    .poll(async () => (await readHarnessState(page)).source)
    .toBe(`targeted prefix: ${unknownMarkdown}`)

  const state = await readHarnessState(page)
  expect(state.source.slice('targeted prefix: '.length)).toBe(unknownMarkdown)
  expect(state.primaryDocument).toBe(state.source)
  expect(state.secondaryDocument).toBe(state.source)
  expect(state.revision).toBeGreaterThan(0)

  await destroyHarness(page)
})

test('shows source fallback as a current degraded preview and recovers without a new revision', async ({
  page,
}) => {
  const source = '# Browser fallback'
  await mountHarness(page, source, true)

  let state = await readHarnessState(page)
  expect(state.previewMode).toBe('source-fallback')
  expect(state.previewText).toContain(source)
  const degradedPreview = state.projections.find(
    (projection) => projection.projectionId === 'browser-preview',
  )
  expect(degradedPreview).toMatchObject({
    revision: 0,
    stale: false,
    degraded: true,
  })

  await page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2BrowserHarness?: BrowserHarness }
    ).__writeItV2BrowserHarness
    if (!harness) throw new Error('browser harness is not mounted')
    harness.setPreviewFailure(false)
    harness.preview.retryRender()
  })

  await expect
    .poll(async () => (await readHarnessState(page)).previewMode)
    .toBe('rich')

  state = await readHarnessState(page)
  expect(state.revision).toBe(0)
  const recoveredPreview = state.projections.find(
    (projection) => projection.projectionId === 'browser-preview',
  )
  expect(recoveredPreview).toMatchObject({
    revision: 0,
    stale: false,
    degraded: false,
  })

  await destroyHarness(page)
})
