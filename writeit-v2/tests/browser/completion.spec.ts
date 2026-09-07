import { expect, test, type Page } from '@playwright/test'

type CompletionHarness = {
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
    const cm6 = await loadModule('/src/editor/cm6/index.ts')

    document.querySelector('[data-browser-completion-harness]')?.remove()
    const root = document.createElement('section')
    root.dataset.browserCompletionHarness = 'true'
    const editorHost = document.createElement('div')
    editorHost.dataset.testid = 'completion-editor'
    root.append(editorHost)
    document.body.append(root)

    const store = new core.DocumentStore()
    const id = core.createDocumentId('browser-completion-document')
    const path = core.createDocumentPath('browser-completion-document.md')
    const locator = core.documentById(id)
    store.load({ id, path, markdown: '' })

    const registry = new assistance.CompletionProviderRegistry()
    registry.register({
      id: 'browser-references',
      triggers: ['@', '[[', '![['],
      provide: ({ trigger }: { trigger: { kind: string } }) => [
        {
          id: 'alpha',
          label: 'Alpha document',
          detail: 'alpha.md',
          insertText:
            trigger.kind === '![['
              ? '![[alpha.md]]'
              : '[[alpha.md]]',
        },
        {
          id: 'beta',
          label: 'Beta document',
          detail: 'beta.md',
          insertText:
            trigger.kind === '![['
              ? '![[beta.md]]'
              : '[[beta.md]]',
        },
      ],
    })

    const projection = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: editorHost,
      projectionId: 'browser-completion-editor',
      editable: true,
      extensions: [
        cm6.createCompletionExtension({ store, locator, registry }),
      ],
    })

    ;(
      window as unknown as {
        __writeItV2CompletionHarness?: CompletionHarness
      }
    ).__writeItV2CompletionHarness = { store, locator, projection }
  })
}

async function readSource(page: Page): Promise<{ markdown: string; revision: number }> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2CompletionHarness?: CompletionHarness
      }
    ).__writeItV2CompletionHarness
    if (!harness) throw new Error('completion harness is not mounted')
    const document = harness.store.get(harness.locator)
    if (!document) throw new Error('completion document is missing')
    return document
  })
}

async function destroyHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2CompletionHarness?: CompletionHarness
      }
    ).__writeItV2CompletionHarness
    harness?.projection.destroy()
  })
}

test('supports @, [[, ![[, filtering, keyboard apply, and Escape in Chromium', async ({
  page,
}) => {
  await mountHarness(page)
  const editor = page.locator('[data-testid="completion-editor"] .cm-content')
  const menu = page.locator(
    '[data-testid="completion-editor"] [data-completion-menu]',
  )

  await editor.click()
  await page.keyboard.insertText('@al')
  await expect(menu).toHaveAttribute('data-show', 'true')
  await expect(menu).toHaveAttribute('data-trigger-kind', '@')
  await expect(menu.locator('[role="option"]')).toHaveCount(1)
  await expect(menu.locator('[data-completion-id="alpha"]')).toBeVisible()
  await expect(menu).toBeVisible()

  await page.keyboard.press('Enter')
  await expect
    .poll(async () => (await readSource(page)).markdown)
    .toBe('[[alpha.md]]')

  await page.keyboard.press('Enter')
  await page.keyboard.insertText('[[be')
  await expect(menu).toHaveAttribute('data-trigger-kind', '[[')
  await expect(menu.locator('[role="option"]')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => (await readSource(page)).markdown)
    .toBe('[[alpha.md]]\n[[beta.md]]')

  await page.keyboard.press('Enter')
  await page.keyboard.insertText('![[al')
  await expect(menu).toHaveAttribute('data-trigger-kind', '![[')
  await expect(menu.locator('[role="option"]')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => (await readSource(page)).markdown)
    .toBe('[[alpha.md]]\n[[beta.md]]\n![[alpha.md]]')

  await page.keyboard.press('Enter')
  await page.keyboard.insertText('@')
  await expect(menu).toHaveAttribute('data-show', 'true')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveAttribute('data-show', 'false')
  await expect
    .poll(async () => (await readSource(page)).markdown)
    .toContain('\n@')

  await destroyHarness(page)
})

test('normalizes full-width IME triggers without rewriting source before apply', async ({
  page,
}) => {
  await mountHarness(page)
  const editor = page.locator('[data-testid="completion-editor"] .cm-content')
  const surface = page.locator('[data-testid="completion-editor"] .cm-editor')
  const menu = page.locator(
    '[data-testid="completion-editor"] [data-completion-menu]',
  )

  await editor.click()
  await surface.dispatchEvent('compositionstart')
  await page.keyboard.insertText('＠al')
  await expect(menu).toHaveAttribute('data-show', 'false')
  await expect.poll(async () => (await readSource(page)).markdown).toBe('＠al')

  await surface.dispatchEvent('compositionend')
  await expect(menu).toHaveAttribute('data-show', 'true')
  await expect(menu).toHaveAttribute('data-trigger-kind', '@')
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => (await readSource(page)).markdown)
    .toBe('[[alpha.md]]')

  await page.keyboard.press('Enter')
  await page.keyboard.insertText('！【【be')
  await expect(menu).toHaveAttribute('data-show', 'true')
  await expect(menu).toHaveAttribute('data-trigger-kind', '![[')
  await expect(menu.locator('[data-completion-id="beta"]')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => (await readSource(page)).markdown)
    .toBe('[[alpha.md]]\n![[beta.md]]')

  await destroyHarness(page)
})
