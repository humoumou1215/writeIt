import { expect, test } from '@playwright/test'

test('blame gutter marks local lines without mutating Markdown', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const load = (path: string): Promise<any> => import(new URL(path, window.location.origin).href)
    const core = await load('/src/core/document/index.ts')
    const cm6 = await load('/src/editor/cm6/index.ts')
    const store = new core.DocumentStore()
    const id = core.createDocumentId('blame-browser')
    const locator = core.documentById(id)
    store.load({ id, path: core.createDocumentPath('notes.md'), markdown: 'one\ntwo' })
    const host = document.createElement('div'); document.body.append(host)
    const projection = cm6.mountSingleDocumentView({ store, locator, parent: host, editable: true, extensions: [cm6.createBlameExtension({ lines: [{ line: 1, kind: 'committed', authorName: 'Ada', commitId: 'abc' }, { line: 2, kind: 'uncommitted' }] })] })
    projection.updateBlame([{ line: 1, kind: 'committed', authorName: 'Ada', commitId: 'abc' }, { line: 2, kind: 'uncommitted' }])
    ;(window as any).__writeItV2BlameHarness = { store, locator, projection }
  })
  await expect(page.locator('[data-blame-line="1"]')).toContainText('Ada')
  await expect(page.locator('[data-blame-line="2"]')).toContainText('Local')
  expect(await page.evaluate(() => (window as any).__writeItV2BlameHarness.store.get((window as any).__writeItV2BlameHarness.locator).revision)).toBe(0)
  await page.evaluate(() => (window as any).__writeItV2BlameHarness.projection.destroy())
})
