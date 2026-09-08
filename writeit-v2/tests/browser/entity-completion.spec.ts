import { expect, test, type Page } from '@playwright/test'

type EntityCompletionHarness = {
  store: {
    get(locator: unknown): { markdown: string; revision: number } | undefined
  }
  locator: unknown
  projection: { destroy(): void }
}

async function mountHarness(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(async () => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const assistance = await loadModule('/src/application/assistance/index.ts')
    const filesystem = await loadModule('/src/platform/filesystem/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/index.ts')

    const root = document.createElement('section')
    root.dataset.entityCompletionHarness = 'true'
    const editorHost = document.createElement('div')
    editorHost.className = 'editor-host'
    editorHost.dataset.testid = 'entity-completion-editor'
    root.append(editorHost)
    document.body.append(root)

    const fileSystem = new filesystem.MemoryFileSystem({
      files: {
        'meeting.md': '# Meeting\n\n## Decisions\n\nKeep source.\n',
        'plain.md': 'No headings.\n',
      },
    })
    const store = new core.DocumentStore()
    const id = core.createDocumentId('browser-entity-completion-document')
    const locator = core.documentById(id)
    store.load({ id, path: core.createDocumentPath('host.md'), markdown: '' })

    const registry = new assistance.CompletionProviderRegistry()
    registry.register(
      assistance.createReferenceCompletionProvider({ workspace: fileSystem }),
    )
    const projection = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: editorHost,
      projectionId: 'browser-entity-completion-editor',
      editable: true,
      extensions: [cm6.createCompletionExtension({ registry })],
    })
    ;(
      window as unknown as {
        __writeItV2EntityCompletionHarness?: EntityCompletionHarness
      }
    ).__writeItV2EntityCompletionHarness = { store, locator, projection }
  })
}

async function readSource(page: Page): Promise<{ markdown: string; revision: number }> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2EntityCompletionHarness?: EntityCompletionHarness
      }
    ).__writeItV2EntityCompletionHarness
    if (!harness) throw new Error('entity completion harness is not mounted')
    const document = harness.store.get(harness.locator)
    if (!document) throw new Error('entity completion document is missing')
    return document
  })
}

async function destroyHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2EntityCompletionHarness?: EntityCompletionHarness
      }
    ).__writeItV2EntityCompletionHarness
    harness?.projection.destroy()
  })
}

test('selecting a file opens file-self and heading entities before applying Markdown', async ({
  page,
}) => {
  await mountHarness(page)
  const editor = page.locator('[data-testid="entity-completion-editor"] .cm-content')
  const menu = page.locator('[data-testid="entity-completion-editor"] [data-completion-menu]')

  await editor.click()
  await page.keyboard.insertText('[[meet')
  await expect(menu.locator('[data-completion-id="reference:file:meeting.md"]')).toBeVisible()

  await menu.locator('[data-completion-id="reference:file:meeting.md"]').click()
  await expect.poll(async () => (await readSource(page)).markdown).toBe('[[meet')
  await expect(menu).toHaveAttribute('data-completion-level', '1')
  await expect(
    menu.locator('[data-completion-id="reference:heading:meeting.md#Decisions"]'),
  ).toBeVisible()

  await menu.locator('[data-completion-id="reference:heading:meeting.md#Decisions"]').click()
  await expect
    .poll(async () => (await readSource(page)).markdown)
    .toBe('[[meeting.md#Decisions]]')

  await destroyHarness(page)
})
