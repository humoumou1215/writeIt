import { expect, test, type Page } from '@playwright/test'

type PopupKind = 'slash' | 'completion'
type LifecycleMode = 'ime' | 'pending-query' | 'pending-apply' | 'readonly'

type LifecycleHarness = {
  store: {
    get(locator: unknown): { markdown: string; revision: number } | undefined
  }
  locator: unknown
  projection: { destroy(): void }
}

async function mountHarness(
  page: Page,
  kind: PopupKind,
  mode: LifecycleMode,
): Promise<void> {
  await page.goto('/')
  await page.evaluate(
    async ({ kind, mode }) => {
      const loadModule = (path: string): Promise<any> =>
        import(new URL(path, window.location.origin).href)
      const core = await loadModule('/src/core/document/index.ts')
      const cm6 = await loadModule('/src/editor/cm6/index.ts')

      document.querySelector('[data-browser-popup-lifecycle]')?.remove()
      const root = document.createElement('section')
      root.dataset.browserPopupLifecycle = `${kind}-${mode}`
      const editorHost = document.createElement('div')
      editorHost.dataset.testid = `${kind}-lifecycle-editor`
      root.append(editorHost)
      document.body.append(root)

      const initialMarkdown = mode === 'readonly' ? (kind === 'slash' ? '/' : '@') : ''
      const store = new core.DocumentStore()
      const id = core.createDocumentId(`browser-${kind}-lifecycle`)
      const path = core.createDocumentPath(`browser-${kind}-lifecycle.md`)
      const locator = core.documentById(id)
      store.load({ id, path, markdown: initialMarkdown })

      const controls: {
        readonly pendingQueries: Array<(value: readonly any[]) => void>
        readonly pendingApplies: Array<() => void>
      } = {
        pendingQueries: [],
        pendingApplies: [],
      }
      const command = {
        id: 'insert',
        label: 'Insert',
        group: 'Test',
        keywords: [],
      }
      const slashRegistry =
        mode === 'pending-apply'
          ? {
              list: () => [command],
              isAvailable: () => true,
              execute: async (_id: string, context: any) => {
                await new Promise<void>((resolve) =>
                  controls.pendingApplies.push(resolve),
                )
                context.replace('done')
              },
            }
          : {
              list: () => [command],
              isAvailable: () => true,
              execute: (_id: string, context: any) => context.replace('done'),
            }

      let completionRegistry: any
      if (mode === 'pending-query') {
        completionRegistry = {
          complete: () =>
            new Promise<readonly any[]>((resolve) =>
              controls.pendingQueries.push(resolve),
            ),
        }
      } else if (mode === 'pending-apply') {
        completionRegistry = {
          complete: () => [
            {
              id: 'alpha',
              label: 'Alpha',
              apply: async (context: any) => {
                await new Promise<void>((resolve) =>
                  controls.pendingApplies.push(resolve),
                )
                return {
                  from: context.trigger.from,
                  to: context.trigger.to,
                  insert: 'done',
                }
              },
            },
          ],
        }
      } else {
        completionRegistry = {
          complete: () => [
            { id: 'alpha', label: 'Alpha', insertText: 'done' },
          ],
        }
      }

      const projection = cm6.mountSingleDocumentView({
        store,
        locator,
        parent: editorHost,
        projectionId: `browser-${kind}-lifecycle-editor`,
        editable: mode !== 'readonly',
        extensions: [
          kind === 'slash'
            ? cm6.createSlashQuickInsertExtension({ registry: slashRegistry })
            : cm6.createCompletionExtension({ registry: completionRegistry }),
        ],
      })

      ;(
        window as unknown as {
          __writeItV2PopupLifecycle?: LifecycleHarness & {
            controls: typeof controls
          }
        }
      ).__writeItV2PopupLifecycle = { store, locator, projection, controls }
    },
    { kind, mode },
  )
}

async function readSource(page: Page): Promise<{ markdown: string; revision: number }> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2PopupLifecycle?: LifecycleHarness }
    ).__writeItV2PopupLifecycle
    if (!harness) throw new Error('popup lifecycle harness is not mounted')
    const document = harness.store.get(harness.locator)
    if (!document) throw new Error('popup lifecycle document is missing')
    return document
  })
}

async function dispatchComposition(page: Page, type: 'compositionstart' | 'compositionend') {
  await page.locator('[data-browser-popup-lifecycle] .cm-content').dispatchEvent(type)
}

async function pressImeEnter(page: Page): Promise<void> {
  await page
    .locator('[data-browser-popup-lifecycle] .cm-content')
    .evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    const legacy = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(legacy, 'keyCode', {
      configurable: true,
      value: 229,
    })
    element.dispatchEvent(legacy)
  })
}

for (const kind of ['slash', 'completion'] as const) {
  test(`${kind} popup never submits an IME Enter`, async ({ page }) => {
    await mountHarness(page, kind, 'ime')
    const editor = page.locator(`[data-testid="${kind}-lifecycle-editor"] .cm-content`)
    const menu = page.locator(
      `[data-testid="${kind}-lifecycle-editor"] [data-${kind}-menu]`,
    )

    await editor.click()
    await page.keyboard.insertText(kind === 'slash' ? '/' : '@')
    await expect(menu).toHaveAttribute('data-show', 'true')
    await pressImeEnter(page)

    expect((await readSource(page)).markdown).toBe(kind === 'slash' ? '/' : '@')
    expect((await readSource(page)).revision).toBe(1)

    await dispatchComposition(page, 'compositionstart')
    await expect(menu).toHaveAttribute('data-show', 'false')
    await dispatchComposition(page, 'compositionend')
    await expect(menu).toHaveAttribute('data-show', 'true')
  })
}

test('completion restarts a pending provider query after composition cancellation', async ({
  page,
}) => {
  await mountHarness(page, 'completion', 'pending-query')
  const editor = page.locator('[data-testid="completion-lifecycle-editor"] .cm-content')
  const menu = page.locator(
    '[data-testid="completion-lifecycle-editor"] [data-completion-menu]',
  )

  await editor.click()
  await page.keyboard.insertText('@a')
  await expect(menu).toHaveAttribute('data-completion-loading', '')
  await dispatchComposition(page, 'compositionstart')
  await expect(menu).toHaveAttribute('data-show', 'false')
  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2PopupLifecycle?: { controls: { pendingQueries: Array<(value: readonly any[]) => void> } }
      }
    ).__writeItV2PopupLifecycle
    harness?.controls.pendingQueries[0]?.([])
  })
  await dispatchComposition(page, 'compositionend')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __writeItV2PopupLifecycle?: { controls: { pendingQueries: unknown[] } }
            }
          ).__writeItV2PopupLifecycle?.controls.pendingQueries.length ?? 0,
      ),
    )
    .toBe(2)
  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2PopupLifecycle?: { controls: { pendingQueries: Array<(value: readonly any[]) => void> } }
      }
    ).__writeItV2PopupLifecycle
    harness?.controls.pendingQueries[1]?.([
      { id: 'alpha', label: 'Alpha', insertText: 'done' },
    ])
  })
  await expect(menu.locator('[data-completion-id="alpha"]')).toHaveCount(1)
  await expect(menu).toHaveAttribute('data-show', 'true')
  await expect(menu.locator('[data-completion-id="alpha"]')).toHaveCount(1)
  expect((await readSource(page)).markdown).toBe('@a')
  expect((await readSource(page)).revision).toBe(1)
})

for (const kind of ['slash', 'completion'] as const) {
  test(`${kind} late popup work cannot mutate after destroy`, async ({ page }) => {
    await mountHarness(page, kind, 'pending-apply')
    const editor = page.locator(`[data-testid="${kind}-lifecycle-editor"] .cm-content`)
    const menu = page.locator(
      `[data-testid="${kind}-lifecycle-editor"] [data-${kind}-menu]`,
    )
    await editor.click()
    await page.keyboard.insertText(kind === 'slash' ? '/' : '@')
    await expect(menu.locator('[role="option"]')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await page.evaluate(() => {
      const harness = (
        window as unknown as {
          __writeItV2PopupLifecycle?: LifecycleHarness & {
            controls: { pendingApplies: Array<() => void> }
          }
        }
      ).__writeItV2PopupLifecycle
      harness?.projection.destroy()
      harness?.controls.pendingApplies.forEach((resolve) => resolve())
    })
    await expect
      .poll(async () => (await readSource(page)).markdown)
      .toBe(kind === 'slash' ? '/' : '@')
    expect((await readSource(page)).revision).toBe(1)
  })
}

test('readonly completion popup cannot mutate its DocumentStore', async ({ page }) => {
  await mountHarness(page, 'completion', 'readonly')
  const editor = page.locator('[data-testid="completion-lifecycle-editor"] .cm-content')
  const menu = page.locator(
    '[data-testid="completion-lifecycle-editor"] [data-completion-menu]',
  )
  await editor.click()
  await page.keyboard.press('End')
  await expect(menu).toHaveAttribute('data-show', 'true')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await readSource(page)).markdown).toBe('@')
  expect((await readSource(page)).revision).toBe(0)
})
