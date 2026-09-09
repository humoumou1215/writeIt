import { expect, test } from '@playwright/test'

test('Mermaid live preview keeps source editable and exposes reference navigation/fallback', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/projection/single-document-view.ts')
    const preview = await loadModule('/src/editor/cm6/extensions/live-preview.ts')
    const source = '# Diagram\n\n```mermaid\nflowchart LR\nA[Start] --> B[End]\n[[missing.md]]\n```\n'
    const store = new core.DocumentStore()
    const id = core.createDocumentId('mermaid-browser')
    const locator = core.documentById(id)
    store.load({ id, path: core.createDocumentPath('diagram.md'), markdown: source })
    const host = document.createElement('div')
    host.dataset.testid = 'mermaid-browser-editor'
    document.body.append(host)
    const opened: Array<{ path: string; split: boolean }> = []
    const projection = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: host,
      editable: true,
      extensions: [preview.createLivePreviewExtension({
        initialMode: 'live-preview',
        isMermaidReferenceAvailable: (path: string) => path === 'notes/architecture.md',
        onOpenMermaidReference: (path: string, event: MouseEvent) => {
          opened.push({ path, split: event.shiftKey })
        },
      })],
    })
    ;(window as any).__writeItV2MermaidHarness = { store, locator, projection, opened, host, source }
  })
  await expect(page.locator('.cm-writeit-mermaid[data-mermaid-status="ready"]')).toBeVisible()
  await expect(page.locator('.cm-writeit-mermaid__reference--missing')).toContainText('Missing missing.md')
  await expect(page.locator('.cm-writeit-mermaid__reference--missing')).toBeDisabled()

  await page.evaluate(() => {
    const harness = (window as any).__writeItV2MermaidHarness
    const source = harness.projection.view.state.doc.toString()
    const from = source.indexOf('B[End]')
    harness.projection.view.dispatch({ changes: { from, to: from + 'B[End]'.length, insert: 'B[Done]' } })
  })
  await expect.poll(async () => page.evaluate(() => (window as any).__writeItV2MermaidHarness.store.get((window as any).__writeItV2MermaidHarness.locator).revision)).toBe(1)
  await expect(page.locator('[data-mermaid-node="B"]')).toContainText('Done')

  await page.evaluate(() => {
    const harness = (window as any).__writeItV2MermaidHarness
    const source = harness.projection.view.state.doc.toString().replace('[[missing.md]]', '[[notes/architecture.md]]')
    harness.projection.view.dispatch({ changes: { from: 0, to: harness.projection.view.state.doc.length, insert: source } })
  })
  await expect(page.locator('[data-mermaid-reference="notes/architecture.md"]')).toContainText('Open notes/architecture.md')
  const ref = page.locator('[data-mermaid-reference="notes/architecture.md"]')
  await ref.click()
  await ref.click({ modifiers: ['Shift'] })
  expect(await page.evaluate(() => (window as any).__writeItV2MermaidHarness.opened)).toEqual([
    { path: 'notes/architecture.md', split: false },
    { path: 'notes/architecture.md', split: true },
  ])
  await page.evaluate(() => {
    const harness = (window as any).__writeItV2MermaidHarness
    harness.projection.destroy()
    harness.host.remove()
  })
})
