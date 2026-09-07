import { expect, test, type Page } from '@playwright/test'

type SlashHarness = {
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
    const commands = await loadModule('/src/application/commands/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/index.ts')

    document.querySelector('[data-browser-slash-harness]')?.remove()
    const root = document.createElement('section')
    root.dataset.browserSlashHarness = 'true'
    const editorHost = document.createElement('div')
    editorHost.dataset.testid = 'slash-editor'
    root.append(editorHost)
    document.body.append(root)

    const store = new core.DocumentStore()
    const id = core.createDocumentId('browser-slash-document')
    const path = core.createDocumentPath('browser-slash-document.md')
    const locator = core.documentById(id)
    store.load({ id, path, markdown: '' })
    const projection = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: editorHost,
      projectionId: 'browser-slash-editor',
      editable: true,
      extensions: [
        cm6.createSlashQuickInsertExtension({
          store,
          locator,
          registry: commands.createBasicMarkdownCommandRegistry(),
        }),
      ],
    })

    ;(
      window as unknown as { __writeItV2SlashHarness?: SlashHarness }
    ).__writeItV2SlashHarness = { store, locator, projection }
  })
}

async function readSource(page: Page): Promise<{ markdown: string; revision: number }> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2SlashHarness?: SlashHarness }
    ).__writeItV2SlashHarness
    if (!harness) throw new Error('slash harness is not mounted')
    const document = harness.store.get(harness.locator)
    if (!document) throw new Error('slash document is missing')
    return document
  })
}

async function destroyHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2SlashHarness?: SlashHarness }
    ).__writeItV2SlashHarness
    harness?.projection.destroy()
  })
}

test('opens, filters, navigates, and applies slash quick insert commands', async ({
  page,
}) => {
  await mountHarness(page)
  const editor = page.locator('[data-testid="slash-editor"] .cm-content')
  const menu = page.locator(
    '[data-testid="slash-editor"] [data-slash-menu]',
  )

  await editor.click()
  await page.keyboard.insertText('/')
  await expect(menu).toHaveAttribute('data-show', 'true')
  await expect(menu.locator('[role="option"]')).toHaveCount(9)

  await page.keyboard.insertText('head')
  await expect(menu.locator('[role="option"]')).toHaveCount(3)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')

  await expect
    .poll(async () => (await readSource(page)).markdown)
    .toBe('## ')
  expect((await readSource(page)).revision).toBe(3)

  await page.keyboard.press('Enter')
  await page.keyboard.insertText('/quote')
  await expect(menu.locator('[data-command-id="markdown.quote"]')).toBeVisible()
  await menu.locator('[data-command-id="markdown.quote"]').click()
  await expect
    .poll(async () => (await readSource(page)).markdown)
    .toBe('## \n> ')

  await page.keyboard.press('Enter')
  await page.keyboard.insertText('/')
  await expect(menu).toHaveAttribute('data-show', 'true')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveAttribute('data-show', 'false')
  await expect
    .poll(async () => (await readSource(page)).markdown)
    .toBe('## \n>\n> /')

  await destroyHarness(page)
})
