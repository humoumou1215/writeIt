import { expect, test, type Page } from '@playwright/test'

type ReferenceNavigationHarness = {
  store: {
    get(locator: unknown): { markdown: string; revision: number } | undefined
  }
  locator: unknown
  projection: { destroy(): void }
  opened: { path: string; fragment: string | null } | null
}

async function mountHarness(page: Page, source: string): Promise<void> {
  await page.goto('/')
  await page.evaluate(async (initialSource) => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const reference = await loadModule('/src/core/reference/index.ts')
    const filesystem = await loadModule('/src/platform/filesystem/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/index.ts')

    const root = document.createElement('section')
    root.dataset.referenceNavigationHarness = 'true'
    const host = document.createElement('div')
    host.dataset.testid = 'reference-navigation-editor'
    root.append(host)
    document.body.append(root)

    const fileSystem = new filesystem.MemoryFileSystem({
      files: {
        'target.md': '# Heading\n',
        'replacement.md': '# Replacement\n',
      },
    })
    const store = new core.DocumentStore()
    const id = core.createDocumentId('browser-reference-navigation')
    const locator = core.documentById(id)
    const documentState = store.load({
      id,
      path: core.createDocumentPath('host.md'),
      markdown: initialSource,
    })
    const graph = new reference.ReferenceGraph({
      workspacePaths: ['host.md', 'target.md', 'replacement.md'],
      documents: [documentState],
    })
    const reader = {
      readFile: (path: string) =>
        fileSystem.readFile(core.createDocumentPath(path)),
    }
    const health = new reference.ReferenceHealthService({
      graph,
      contentReader: reader,
    })
    const harness: ReferenceNavigationHarness = {
      store,
      locator,
      projection: undefined as never,
      opened: null,
    }
    const projection = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: host,
      projectionId: 'browser-reference-navigation-editor',
      editable: true,
      extensions: [
        cm6.createReferenceNavigationExtension({
          sourcePath: 'host.md',
          healthResolver: health,
          onOpen: (path: string, fragment: string | null) => {
            harness.opened = { path, fragment }
          },
          reselectProvider: () => [
            { path: 'replacement.md', label: 'Replacement' },
          ],
        }),
      ],
    })
    harness.projection = projection
    ;(
      window as unknown as {
        __writeItV2ReferenceNavigationHarness?: ReferenceNavigationHarness
      }
    ).__writeItV2ReferenceNavigationHarness = harness
  }, source)
}

async function readHarness(page: Page): Promise<{
  markdown: string
  revision: number
  opened: { path: string; fragment: string | null } | null
}> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2ReferenceNavigationHarness?: ReferenceNavigationHarness
      }
    ).__writeItV2ReferenceNavigationHarness
    if (!harness) throw new Error('reference navigation harness is not mounted')
    const document = harness.store.get(harness.locator)
    if (!document) throw new Error('reference navigation document is missing')
    return {
      markdown: document.markdown,
      revision: document.revision,
      opened: harness.opened,
    }
  })
}

async function destroyHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2ReferenceNavigationHarness?: ReferenceNavigationHarness
      }
    ).__writeItV2ReferenceNavigationHarness
    harness?.projection.destroy()
  })
}

test('opens verified fragments and exposes a hover tooltip', async ({ page }) => {
  await mountHarness(page, 'Go [[target#Heading]]')
  const editor = page.locator('[data-testid="reference-navigation-editor"] .cm-content')
  const reference = page.locator('[data-testid="reference-navigation-editor"] [data-writeit-reference]')
  await expect(reference).toHaveAttribute('data-reference-status', 'resolved')
  await reference.hover()
  await expect(page.locator('[data-reference-tooltip]:not([hidden])')).toContainText('Heading')
  await reference.click()
  await expect.poll(async () => (await readHarness(page)).opened).toEqual({
    path: 'target.md',
    fragment: 'Heading',
  })
  await expect(editor).toContainText('Go [[target#Heading]]')
  await destroyHarness(page)
})

test('marks broken references and reselects without rewriting unrelated source', async ({
  page,
}) => {
  await mountHarness(page, 'Before [[missing]] after')
  const reference = page.locator('[data-testid="reference-navigation-editor"] [data-writeit-reference]')
  await expect(reference).toHaveAttribute('data-reference-status', 'missing')
  await expect(page.locator('[data-testid="reference-navigation-editor"] .cm-editor'))
    .toHaveAttribute('data-reference-broken-count', '1')
  await reference.click()

  const menu = page.locator('[data-reference-reselect-menu]:not([hidden])')
  await expect(menu).toBeVisible()
  await menu.locator('[data-reference-reselect-index="0"]').click()
  await expect.poll(async () => (await readHarness(page)).markdown).toBe(
    'Before [[replacement.md]] after',
  )
  expect((await readHarness(page)).revision).toBe(1)
  await destroyHarness(page)
})
