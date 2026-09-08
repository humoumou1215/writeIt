import { expect, test, type Page } from '@playwright/test'

type EmbedHarness = {
  store: {
    get(locator: unknown): { markdown: string; revision: number } | undefined
    getProjections(locator: unknown): readonly { projectionId: string; stale: boolean }[]
    undo(locator: unknown, origin: unknown): unknown
  }
  hostLocator: unknown
  targetLocator: unknown
  projection: { destroy(): void }
}

async function mountHarness(page: Page, source: string): Promise<void> {
  await page.goto('/')
  await page.evaluate(async (initialSource) => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/index.ts')

    const store = new core.DocumentStore()
    const targetId = core.createDocumentId('browser-embed-target')
    const hostId = core.createDocumentId('browser-embed-host')
    const target = store.load({
      id: targetId,
      path: core.createDocumentPath('EmbedTarget.md'),
      markdown: 'target source',
    })
    const host = store.load({
      id: hostId,
      path: core.createDocumentPath('EmbedHost.md'),
      markdown: initialSource,
    })
    const root = document.createElement('section')
    root.dataset.embedHarness = 'true'
    const hostElement = document.createElement('div')
    hostElement.dataset.testid = 'embed-host-editor'
    root.append(hostElement)
    document.body.append(root)

    const harness: EmbedHarness = {
      store,
      hostLocator: core.documentById(host.id),
      targetLocator: core.documentById(target.id),
      projection: undefined as never,
    }
    harness.projection = cm6.mountSingleDocumentView({
      store,
      locator: core.documentById(host.id),
      parent: hostElement,
      projectionId: 'browser-embed-host',
      editable: true,
      presentationMode: 'live-preview',
      extensions: [
        cm6.createEmbedProjectionExtension({
          store,
          locator: core.documentById(host.id),
          getAvailablePaths: () => ['EmbedHost.md', 'EmbedTarget.md'],
        }),
      ],
    })
    ;(
      window as unknown as { __writeItV2EmbedHarness?: EmbedHarness }
    ).__writeItV2EmbedHarness = harness
  }, source)
}

async function readHarness(page: Page): Promise<{
  host: { markdown: string; revision: number }
  target: { markdown: string; revision: number }
  projectionCount: number
}> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2EmbedHarness?: EmbedHarness }
    ).__writeItV2EmbedHarness
    if (!harness) throw new Error('embed harness is not mounted')
    const host = harness.store.get(harness.hostLocator)
    const target = harness.store.get(harness.targetLocator)
    if (!host || !target) throw new Error('embed documents are missing')
    return {
      host,
      target,
      projectionCount: harness.store.getProjections(harness.targetLocator).length,
    }
  })
}

async function destroyHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2EmbedHarness?: EmbedHarness }
    ).__writeItV2EmbedHarness
    harness?.projection.destroy()
  })
}

test('edits an embed target through the nested CM6 projection and keeps host source unchanged', async ({
  page,
}) => {
  await mountHarness(page, 'Host\n\n![[EmbedTarget.md]]')
  const embed = page.locator('[data-testid="embed-host-editor"] [data-writeit-embed]')
  await expect(embed).toHaveAttribute('data-embed-status', 'mounted')
  const childContent = embed.locator('.cm-writeit-embed-projection__editor .cm-content')
  await childContent.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' edited')

  await expect.poll(async () => (await readHarness(page)).target.markdown).toBe(
    'target source edited',
  )
  const state = await readHarness(page)
  expect(state.host.markdown).toBe('Host\n\n![[EmbedTarget.md]]')
  expect(state.target.revision).toBeGreaterThan(0)
  expect(state.projectionCount).toBe(1)
  await destroyHarness(page)
})

test('retries a transient embed load failure after an explicit target event', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/index.ts')
    const store = new core.DocumentStore()
    const host = store.load({
      id: core.createDocumentId('browser-retry-host'),
      path: core.createDocumentPath('BrowserRetryHost.md'),
      markdown: '![[BrowserRetry.md]]',
    })
    const root = document.createElement('section')
    root.dataset.testid = 'browser-retry-host'
    document.body.append(root)

    let attempts = 0
    let retryTargets: () => void = () => undefined
    const projection = cm6.mountSingleDocumentView({
      store,
      locator: core.documentById(host.id),
      parent: root,
      projectionId: 'browser-retry-host',
      editable: true,
      presentationMode: 'live-preview',
      extensions: [
        cm6.createEmbedProjectionExtension({
          store,
          locator: core.documentById(host.id),
          getAvailablePaths: () => ['BrowserRetryHost.md', 'BrowserRetry.md'],
          onTargetMissing: () => {
            attempts += 1
            if (attempts === 1) {
              return Promise.reject(new Error('browser transient failure'))
            }
            store.load({
              id: core.createDocumentId('browser-retry-target'),
              path: core.createDocumentPath('BrowserRetry.md'),
              markdown: 'recovered in browser',
            })
          },
          subscribeTargets: (listener: () => void) => {
            retryTargets = listener
            return () => undefined
          },
        }),
      ],
    })
    ;(
      window as unknown as {
        __writeItV2RetryHarness?: {
          readonly store: any
          readonly hostLocator: unknown
          readonly projection: { destroy(): void }
          readonly attempts: () => number
          readonly retry: () => void
        }
      }
    ).__writeItV2RetryHarness = {
      store,
      hostLocator: core.documentById(host.id),
      projection,
      attempts: () => attempts,
      retry: () => retryTargets(),
    }
  })

  const host = page.locator('[data-testid="browser-retry-host"]')
  await expect(host.locator('[data-embed-status="error"]')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const harness = (
          window as unknown as {
            __writeItV2RetryHarness?: { attempts: () => number }
          }
        ).__writeItV2RetryHarness
        return harness?.attempts() ?? 0
      }),
    )
    .toBe(1)

  await page.evaluate(() => {
    const harness = (
      window as unknown as { __writeItV2RetryHarness?: { retry(): void } }
    ).__writeItV2RetryHarness
    harness?.retry()
  })
  await expect(host.locator('[data-embed-status="mounted"]')).toBeVisible()

  const state = await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2RetryHarness?: {
          store: { get(locator: unknown): { markdown: string } | undefined }
          hostLocator: unknown
        }
      }
    ).__writeItV2RetryHarness
    if (!harness) throw new Error('retry harness is not mounted')
    return {
      host: harness.store.get(harness.hostLocator)?.markdown,
      error: document.querySelector('[data-testid="browser-retry-host"]')?.getAttribute(
        'data-embed-target-error',
      ),
    }
  })
  expect(state.host).toBe('![[BrowserRetry.md]]')
  expect(state.error).toBeNull()

  await page.evaluate(() => {
    ;(
      window as unknown as { __writeItV2RetryHarness?: { projection: { destroy(): void } } }
    ).__writeItV2RetryHarness?.projection.destroy()
  })
})

test('ignores a late target load after detach and mounts the target on reopen', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/index.ts')
    const store = new core.DocumentStore()
    const host = store.load({
      id: core.createDocumentId('browser-detach-host'),
      path: core.createDocumentPath('BrowserDetachHost.md'),
      markdown: '![[BrowserDetach.md]]',
    })
    const root = document.createElement('section')
    root.dataset.testid = 'browser-detach-host'
    document.body.append(root)
    let releaseLoad!: () => void
    const pending = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const mount = (projectionId: string) =>
      cm6.mountSingleDocumentView({
        store,
        locator: core.documentById(host.id),
        parent: root,
        projectionId,
        editable: true,
        presentationMode: 'live-preview',
        extensions: [
          cm6.createEmbedProjectionExtension({
            store,
            locator: core.documentById(host.id),
            getAvailablePaths: () => ['BrowserDetachHost.md', 'BrowserDetach.md'],
            onTargetMissing: () => pending,
          }),
        ],
      })
    const projection = mount('browser-detach-first')
    ;(
      window as unknown as {
        __writeItV2DetachHarness?: {
          store: any
          hostLocator: unknown
          root: HTMLElement
          projection: { destroy(): void }
          release: () => void
          mount: (id: string) => { destroy(): void }
        }
      }
    ).__writeItV2DetachHarness = {
      store,
      hostLocator: core.documentById(host.id),
      root,
      projection,
      release: () => releaseLoad(),
      mount,
    }
  })

  const host = page.locator('[data-testid="browser-detach-host"]')
  await expect(host.locator('[data-embed-status="unloaded"]')).toBeVisible()
  const detachedState = await page.evaluate(async () => {
    const core = await import(new URL('/src/core/document/index.ts', window.location.origin).href)
    const harness = (
      window as unknown as {
        __writeItV2DetachHarness?: {
          store: { getProjections(locator: unknown): readonly unknown[] }
          hostLocator: unknown
          projection: { destroy(): void }
          release: () => void
        }
      }
    ).__writeItV2DetachHarness
    if (!harness) throw new Error('detach harness is not mounted')
    harness.projection.destroy()
    harness.release()
    const target = (harness.store as any).load({
      id: core.createDocumentId('browser-detach-target'),
      path: core.createDocumentPath('BrowserDetach.md'),
      markdown: 'loaded after close',
    })
    return {
      hostProjectionCount: harness.store.getProjections(harness.hostLocator).length,
      targetId: target.id,
    }
  })
  expect(detachedState.hostProjectionCount).toBe(0)

  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2DetachHarness?: {
          mount: (id: string) => { destroy(): void }
          projection: { destroy(): void }
        }
      }
    ).__writeItV2DetachHarness
    if (!harness) throw new Error('detach harness is not mounted')
    harness.projection = harness.mount('browser-detach-reopened')
  })
  await expect(host.locator('[data-embed-status="mounted"]')).toBeVisible()
  await expect(host.locator('.cm-writeit-embed-projection__editor .cm-editor')).toHaveCount(1)

  await page.evaluate(() => {
    ;(
      window as unknown as { __writeItV2DetachHarness?: { projection: { destroy(): void } } }
    ).__writeItV2DetachHarness?.projection.destroy()
  })
})

test('renders circular embeds as a bounded diagnostic instead of recursing', async ({
  page,
}) => {
  await mountHarness(page, 'bootstrap')
  await page.evaluate(async () => {
    const harness = (
      window as unknown as { __writeItV2EmbedHarness?: EmbedHarness }
    ).__writeItV2EmbedHarness
    if (!harness) throw new Error('embed harness is not mounted')
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/index.ts')
    const store = harness.store as any
    const a = store.load({
      id: core.createDocumentId('browser-cycle-a'),
      path: core.createDocumentPath('CycleA.md'),
      markdown: '![[CycleB.md]]',
    })
    const b = store.load({
      id: core.createDocumentId('browser-cycle-b'),
      path: core.createDocumentPath('CycleB.md'),
      markdown: '![[CycleA.md]]',
    })
    const host = document.createElement('div')
    host.dataset.testid = 'cycle-host-editor'
    document.body.append(host)
    const projection = cm6.mountSingleDocumentView({
      store,
      locator: core.documentById(a.id),
      parent: host,
      projectionId: 'browser-cycle-host',
      editable: true,
      presentationMode: 'live-preview',
      extensions: [
        cm6.createEmbedProjectionExtension({
          store,
          locator: core.documentById(a.id),
          getAvailablePaths: () => ['CycleA.md', 'CycleB.md'],
        }),
      ],
    })
    ;(
      window as unknown as { __writeItV2CycleProjection?: { destroy(): void } }
    ).__writeItV2CycleProjection = projection
    void b
  })
  await expect(page.locator('[data-testid="cycle-host-editor"] [data-embed-status="circular"]')).toBeVisible()
  await expect(page.locator('[data-testid="cycle-host-editor"] .cm-editor')).toHaveCount(2)
  await page.evaluate(() => {
    ;(
      window as unknown as { __writeItV2CycleProjection?: { destroy(): void } }
    ).__writeItV2CycleProjection?.destroy()
  })
  await destroyHarness(page)
})
