import { expect, test, type Page } from '@playwright/test'

type ContextActionsHarness = {
  store: {
    get(locator: unknown): { markdown: string; revision: number } | undefined
  }
  locator: unknown
  projection: { destroy(): void }
  copied: string | null
  opened: { path: string; fragment: string | null } | null
}

async function mountHarness(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(async () => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/index.ts')

    const root = document.createElement('section')
    root.dataset.referenceContextHarness = 'true'
    const host = document.createElement('div')
    host.className = 'editor-host'
    host.dataset.testid = 'reference-context-editor'
    root.append(host)
    document.body.append(root)

    const store = new core.DocumentStore()
    const id = core.createDocumentId('browser-reference-context')
    const locator = core.documentById(id)
    store.load({
      id,
      path: core.createDocumentPath('host.md'),
      markdown: '[[target.md#Heading]] before',
    })
    const harness: ContextActionsHarness = {
      store,
      locator,
      projection: undefined as never,
      copied: null,
      opened: null,
    }
    const projection = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: host,
      projectionId: 'browser-reference-context-editor',
      editable: true,
      extensions: [
        cm6.createReferenceClipboardExtension({
          contextActions: {
            copyText: (text: string) => {
              harness.copied = text
            },
            onOpen: (request: { path: string; fragment: string | null }) => {
              harness.opened = { path: request.path, fragment: request.fragment }
            },
          },
        }),
      ],
    })
    harness.projection = projection
    ;(
      window as unknown as {
        __writeItV2ReferenceContextHarness?: ContextActionsHarness
      }
    ).__writeItV2ReferenceContextHarness = harness
  })
}

async function readHarness(page: Page): Promise<{
  markdown: string
  revision: number
  copied: string | null
  opened: { path: string; fragment: string | null } | null
}> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2ReferenceContextHarness?: ContextActionsHarness
      }
    ).__writeItV2ReferenceContextHarness
    if (!harness) throw new Error('reference context harness is not mounted')
    const document = harness.store.get(harness.locator)
    if (!document) throw new Error('reference context document is missing')
    return {
      markdown: document.markdown,
      revision: document.revision,
      copied: harness.copied,
      opened: harness.opened,
    }
  })
}

async function openMenu(page: Page): Promise<void> {
  await page.locator('[data-testid="reference-context-editor"] .cm-content').click({
    button: 'right',
    position: { x: 8, y: 8 },
  })
  await expect(
    page.locator('[data-reference-context-menu="true"]'),
  ).toBeVisible()
}

async function destroyHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2ReferenceContextHarness?: ContextActionsHarness
      }
    ).__writeItV2ReferenceContextHarness
    harness?.projection.destroy()
  })
}

test('opens, copies, and converts a source-backed reference from its context menu', async ({
  page,
}) => {
  await mountHarness(page)
  const menu = page.locator('[data-reference-context-menu="true"]')

  await openMenu(page)
  await menu.locator('[data-reference-context-action="copy-syntax"]').click()
  await expect.poll(async () => (await readHarness(page)).copied).toBe(
    '[[target.md#Heading]]',
  )

  await openMenu(page)
  await menu.locator('[data-reference-context-mode="embed-readonly"]').click()
  await expect.poll(async () => (await readHarness(page)).markdown).toBe(
    '![[target.md#Heading|ro]] before',
  )
  expect((await readHarness(page)).revision).toBe(1)

  await openMenu(page)
  await menu.locator('[data-reference-context-action="open"]').click()
  await expect.poll(async () => (await readHarness(page)).opened).toEqual({
    path: 'target.md',
    fragment: 'Heading',
  })
  await destroyHarness(page)
})
