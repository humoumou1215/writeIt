import { expect, test, type Page } from '@playwright/test'

type ReferenceCompletionHarness = {
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

    document.querySelector('[data-browser-reference-completion-harness]')?.remove()
    const root = document.createElement('section')
    root.dataset.browserReferenceCompletionHarness = 'true'
    const editorHost = document.createElement('div')
    editorHost.className = 'editor-host'
    editorHost.dataset.testid = 'reference-completion-editor'
    root.append(editorHost)
    document.body.append(root)

    const fileSystem = new filesystem.MemoryFileSystem({
      files: {
        'alpha.md': '# Alpha\n',
        'notes/beta.md': '# Beta\n',
        'notes/readme.markdown': '# Readme\n',
        'notes/ignored.js': 'ignored',
        '.hidden/secret.md': '# Hidden\n',
      },
      directories: ['notes', '.hidden'],
    })
    const store = new core.DocumentStore()
    const id = core.createDocumentId('browser-reference-completion-document')
    const path = core.createDocumentPath('host.md')
    const locator = core.documentById(id)
    store.load({ id, path, markdown: '' })

    const registry = new assistance.CompletionProviderRegistry()
    registry.register(
      assistance.createReferenceCompletionProvider({ workspace: fileSystem }),
    )
    const projection = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: editorHost,
      projectionId: 'browser-reference-completion-editor',
      editable: true,
      extensions: [cm6.createCompletionExtension({ registry })],
    })

    ;(
      window as unknown as {
        __writeItV2ReferenceCompletionHarness?: ReferenceCompletionHarness
      }
    ).__writeItV2ReferenceCompletionHarness = { store, locator, projection }
  })
}

async function readSource(page: Page): Promise<{ markdown: string; revision: number }> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2ReferenceCompletionHarness?: ReferenceCompletionHarness
      }
    ).__writeItV2ReferenceCompletionHarness
    if (!harness) throw new Error('reference completion harness is not mounted')
    const document = harness.store.get(harness.locator)
    if (!document) throw new Error('reference completion document is missing')
    return document
  })
}

async function destroyHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2ReferenceCompletionHarness?: ReferenceCompletionHarness
      }
    ).__writeItV2ReferenceCompletionHarness
    harness?.projection.destroy()
  })
}

test('enumerates workspace references, hides dot-directories, and continues directory paths', async ({
  page,
}) => {
  await mountHarness(page)
  const editor = page.locator(
    '[data-testid="reference-completion-editor"] .cm-content',
  )
  const menu = page.locator(
    '[data-testid="reference-completion-editor"] [data-completion-menu]',
  )

  await editor.click()
  await page.keyboard.insertText('[[no')
  await expect(menu.locator('[data-completion-id="reference:directory:notes"]')).toBeVisible()
  await expect(menu.locator('[data-completion-id="reference:file:notes/beta.md"]')).toBeVisible()
  await expect(menu.locator('[data-completion-id*=".hidden"]')).toHaveCount(0)
  await expect(menu.locator('[data-completion-id*="ignored.js"]')).toHaveCount(0)

  await menu.locator('[data-completion-id="reference:directory:notes"]').click()
  await expect.poll(async () => (await readSource(page)).markdown).toBe('[[notes/')
  await expect(menu.locator('[data-completion-id="reference:file:notes/beta.md"]')).toBeVisible()

  await menu.locator('[data-completion-id="reference:file:notes/beta.md"]').click()
  await expect.poll(async () => (await readSource(page)).markdown).toBe('[[notes/')
  await expect(menu).toHaveAttribute('data-completion-level', '1')
  await menu.locator('[data-completion-id="reference:file:notes/beta.md"]').click()
  await expect
    .poll(async () => (await readSource(page)).markdown)
    .toBe('[[notes/beta.md]]')

  await destroyHarness(page)
})
