import { expect, test, type Page } from '@playwright/test'

type PopupKind = 'slash' | 'completion'

type PopupHarness = {
  store: {
    get(locator: unknown): { markdown: string; revision: number } | undefined
  }
  locator: unknown
  projection: { destroy(): void }
}

const itemCount = 24

async function mountHarness(page: Page, kind: PopupKind): Promise<void> {
  await page.goto('/')
  await page.evaluate(
    async ({ kind, itemCount }) => {
      const loadModule = (path: string): Promise<any> =>
        import(new URL(path, window.location.origin).href)
      const core = await loadModule('/src/core/document/index.ts')
      const cm6 = await loadModule('/src/editor/cm6/index.ts')

      document.querySelector('#app')?.remove()
      const style = document.createElement('style')
      style.textContent = `
        body { min-height: 1500px; }
        [data-popup-harness] {
          width: 360px;
          margin-top: 700px;
          margin-left: calc(100vw - 370px);
        }
        [data-popup-harness] .cm-editor,
        [data-popup-harness] .cm-scroller { height: 220px; }
        [data-popup-harness] .cm-scroller { overflow: auto; }
        [data-popup-harness] .cm-content { min-width: 900px; }
        [data-popup-harness] .cm-line { white-space: pre !important; }
      `
      document.head.append(style)

      const root = document.createElement('section')
      root.dataset.popupHarness = kind
      const editorHost = document.createElement('div')
      editorHost.dataset.testid = `${kind}-popup-editor`
      root.append(editorHost)
      document.body.append(root)

      const lines = Array.from(
        { length: 45 },
        (_, index) => `Line ${index + 1} ${'x'.repeat(100)}`,
      )
      const markdown = lines.join('\n')
      const store = new core.DocumentStore()
      const id = core.createDocumentId(`${kind}-popup-document`)
      const path = core.createDocumentPath(`${kind}-popup-document.md`)
      const locator = core.documentById(id)
      store.load({ id, path, markdown })

      const items = Array.from({ length: itemCount }, (_, index) => ({
        id: `item-${index + 1}`,
        label: `Item ${String(index + 1).padStart(2, '0')}`,
        detail: `item-${index + 1}.md`,
        insertText: `[[item-${index + 1}.md]]`,
      }))
      const extension =
        kind === 'slash'
          ? cm6.createSlashQuickInsertExtension({
              registry: {
                list: () =>
                  items.map((item: { id: string; label: string }) => ({
                    id: item.id,
                    label: item.label,
                    group: 'Acceptance',
                    keywords: [],
                  })),
                isAvailable: () => true,
                execute: () => undefined,
              },
            })
          : cm6.createCompletionExtension({
              registry: { complete: () => items },
            })

      const projection = cm6.mountSingleDocumentView({
        store,
        locator,
        parent: editorHost,
        projectionId: `${kind}-popup-editor`,
        editable: true,
        extensions: [extension],
      })
      ;(window as unknown as { __popupHarness?: PopupHarness }).__popupHarness = {
        store,
        locator,
        projection,
      }
    },
    { kind, itemCount },
  )
}

async function readState(page: Page): Promise<{ markdown: string; revision: number }> {
  return page.evaluate(() => {
    const harness = (window as unknown as { __popupHarness?: PopupHarness })
      .__popupHarness
    if (!harness) throw new Error('popup harness is not mounted')
    const document = harness.store.get(harness.locator)
    if (!document) throw new Error('popup document is missing')
    return document
  })
}

async function expectPopupGeometry(page: Page, kind: PopupKind): Promise<void> {
  const menu = page.locator(`[data-${kind}-menu]`)
  await expect(menu).toHaveAttribute('data-popup-positioned', 'true')
  await expect(menu).toHaveAttribute('data-popup-placement', 'above')
  await expect
    .poll(() =>
      menu.evaluate((element) => {
        const menuRect = element.getBoundingClientRect()
        const editor = element.closest('.cm-editor')
        const scrollerRect = editor
          ?.querySelector('.cm-scroller')
          ?.getBoundingClientRect()
        const lines = editor?.querySelectorAll('.cm-line')
        const activeLineRect = lines?.item((lines?.length ?? 1) - 1)
          ?.getBoundingClientRect()
        const selected = element.querySelector<HTMLElement>(
          '[role="option"][aria-selected="true"]',
        )
        const selectedRect = selected?.getBoundingClientRect()
        if (!scrollerRect || !activeLineRect || !selectedRect) return false
        const visibleTop = menuRect.top + (element as HTMLElement).clientTop
        const visibleBottom = visibleTop + (element as HTMLElement).clientHeight
        return (
          menuRect.left >= Math.max(0, scrollerRect.left) + 7 &&
          menuRect.right <= Math.min(innerWidth, scrollerRect.right) - 7 &&
          menuRect.top >= Math.max(0, scrollerRect.top) + 7 &&
          menuRect.bottom <= Math.min(innerHeight, scrollerRect.bottom) - 7 &&
          menuRect.bottom <= activeLineRect.top &&
          selectedRect.top >= visibleTop - 0.5 &&
          selectedRect.bottom <= visibleBottom + 0.5
        )
      }),
    )
    .toBe(true)
}

for (const kind of ['slash', 'completion'] as const) {
  test(`${kind} popup follows the caret and keeps wraparound selection visible`, async ({
    page,
  }) => {
    await mountHarness(page, kind)
    const editor = page.locator(`[data-testid="${kind}-popup-editor"] .cm-content`)
    const root = page.locator(`[data-popup-harness="${kind}"]`)
    const scroller = root.locator('.cm-scroller')
    const menu = page.locator(`[data-${kind}-menu]`)

    await root.evaluate((element) => element.scrollIntoView({ block: 'end' }))
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      element.scrollLeft = element.scrollWidth
    })
    await editor.locator('.cm-line').last().click()
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End',
    )
    await page.keyboard.insertText(kind === 'slash' ? ' /' : ' @')

    await expect(menu.locator('[role="option"]')).toHaveCount(itemCount)
    await expectPopupGeometry(page, kind)
    const unchanged = await readState(page)

    await page.keyboard.press('ArrowUp')
    await expect(
      menu.locator('[role="option"][aria-selected="true"]'),
    ).toHaveText(new RegExp(`^Item ${itemCount}`))
    await expectPopupGeometry(page, kind)
    expect(await menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

    await page.keyboard.press('ArrowDown')
    await expect(
      menu.locator('[role="option"][aria-selected="true"]'),
    ).toHaveText(/^Item 01/)
    await expectPopupGeometry(page, kind)

    await scroller.evaluate((element) => {
      element.scrollLeft = Math.max(0, element.scrollLeft - 4)
    })
    await expectPopupGeometry(page, kind)
    await page.evaluate(() => window.scrollBy(0, 30))
    await expectPopupGeometry(page, kind)
    await page.setViewportSize({ width: 900, height: 600 })
    await expectPopupGeometry(page, kind)

    const afterNavigation = await readState(page)
    expect(afterNavigation).toEqual(unchanged)
    await page.evaluate(() => {
      ;(window as unknown as { __popupHarness?: PopupHarness })
        .__popupHarness?.projection.destroy()
    })
  })
}
