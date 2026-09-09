import { expect, test, type Page } from '@playwright/test'

type TableHarness = {
  locator: unknown
  store: {
    get(locator: unknown): { markdown: string; revision: number } | undefined
  }
  projection: {
    setPresentationMode(mode: 'source' | 'live-preview'): void
    executeTableCommand(commandId: string): boolean
    destroy(): void
  }
}

const source = '| Name | Note |\n| --- | --- |\n| Alice | first<br>second |\n| Bob | third |\n'

async function mountTable(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(async (markdown) => {
    const load = (path: string): Promise<any> => import(new URL(path, window.location.origin).href)
    const core = await load('/src/core/document/index.ts')
    const cm6 = await load('/src/editor/cm6/index.ts')
    const host = document.createElement('div')
    host.className = 'editor-host'
    host.dataset.testid = 'table-editor'
    document.body.replaceChildren(host)
    const store = new core.DocumentStore()
    const id = core.createDocumentId('browser-table')
    const locator = core.documentById(id)
    store.load({ id, path: core.createDocumentPath('table.md'), markdown })
    const projection = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: host,
      projectionId: 'browser-table-editor',
      editable: true,
      presentationMode: 'live-preview',
    })
    ;(window as unknown as { __writeItV2TableHarness?: TableHarness }).__writeItV2TableHarness = { store, locator, projection }
  }, source)
}

async function state(page: Page) {
  return page.evaluate(() => {
    const harness = (window as unknown as { __writeItV2TableHarness?: TableHarness }).__writeItV2TableHarness
    if (!harness) throw new Error('table harness missing')
    return harness.store.get(harness.locator)
  })
}

function cell(page: Page, row: number, column: number) {
  return page.locator(`[data-testid="table-editor"] [data-table-row="${row}"][data-table-column="${column}"]`).last()
}

test('table Live Preview supports selected replacement, text editing, logical newline, navigation, and source switch', async ({ page }) => {
  await mountTable(page)
  await expect(page.locator('.cm-writeit-table')).toBeVisible()
  await expect(cell(page, 1, 1).locator('br')).toHaveCount(1)

  await cell(page, 1, 0).locator('.cm-writeit-table__cell-button').click()
  await page.keyboard.press('Z')
  await expect.poll(async () => (await state(page))?.markdown).toContain('| Z | first<br>second |')

  await cell(page, 2, 1).locator('.cm-writeit-table__cell-button').dblclick()
  const editor = cell(page, 2, 1).locator('textarea')
  await expect(editor).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('第四行')
  await expect.poll(async () => (await state(page))?.markdown).toContain('| Bob | third<br>第四行 |')

  await page.evaluate(() => {
    const harness = (window as unknown as { __writeItV2TableHarness?: TableHarness }).__writeItV2TableHarness!
    harness.projection.setPresentationMode('source')
  })
  await expect(page.locator('.cm-writeit-table')).toHaveCount(0)
  expect((await state(page))?.markdown).toContain('third<br>第四行')
  await page.evaluate(() => {
    const harness = (window as unknown as { __writeItV2TableHarness?: TableHarness }).__writeItV2TableHarness!
    harness.projection.setPresentationMode('live-preview')
  })
  await expect(page.locator('.cm-writeit-table')).toBeVisible()
})

test('table controls select ranges, mutate structure, reorder, and keep resize runtime-only', async ({ page }) => {
  await mountTable(page)
  await cell(page, 1, 0).locator('.cm-writeit-table__cell-button').click()
  await cell(page, 2, 1).locator('.cm-writeit-table__cell-button').click({ modifiers: ['Shift'] })
  await expect(page.locator('.cm-writeit-table [aria-selected="true"]')).toHaveCount(4)

  const beforeResize = await state(page)
  const resize = page.locator('[data-table-resize-column="0"]')
  const box = await resize.boundingBox()
  if (!box) throw new Error('resize handle is not measurable')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 90, box.y + box.height / 2)
  await page.mouse.up()
  expect((await state(page))?.revision).toBe(beforeResize?.revision)
  expect((await state(page))?.markdown).toBe(beforeResize?.markdown)

  await cell(page, 1, 0).locator('.cm-writeit-table__cell-button').click()
  await page.evaluate(() => {
    const harness = (window as unknown as { __writeItV2TableHarness?: TableHarness }).__writeItV2TableHarness!
    harness.projection.executeTableCommand('editor.table.add-column-after')
  })
  await expect.poll(async () => (await state(page))?.markdown).toContain('| Name |  | Note |')

  const firstGrip = page.locator('[data-table-row-grip="1"]')
  const secondGrip = page.locator('[data-table-row-grip="2"]')
  await firstGrip.dragTo(secondGrip)
  await expect.poll(async () => (await state(page))?.markdown).toContain('| Bob |  | third |\n| Alice |  | first<br>second |')
})
