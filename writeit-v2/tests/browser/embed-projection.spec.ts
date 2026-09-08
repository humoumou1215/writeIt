import { expect, test, type Page } from '@playwright/test'

type EmbedHarness = {
  store: {
    get(locator: unknown): { markdown: string; revision: number } | undefined
    getProjections(locator: unknown): readonly { projectionId: string; stale: boolean }[]
    undo(locator: unknown, origin: unknown): unknown
  }
  hostLocator: unknown
  targetLocator: unknown
  opened: { path: string; fragment: string | null } | null
  projection: { destroy(): void }
}

async function mountHarness(page: Page, source: string): Promise<void> {
  await page.goto('/')
  await page.evaluate(async (initialSource) => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const reference = await loadModule('/src/core/reference/index.ts')
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

    const graph = new reference.ReferenceGraph({
      workspacePaths: ['EmbedHost.md', 'EmbedTarget.md'],
      documents: [host],
    })
    const health = new reference.ReferenceHealthService({ graph })
    const harness: EmbedHarness = {
      store,
      hostLocator: core.documentById(host.id),
      targetLocator: core.documentById(target.id),
      opened: null,
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
        cm6.createReferenceNavigationExtension({
          sourcePath: 'EmbedHost.md',
          healthResolver: health,
          onOpen: (path: string, fragment: string | null) => {
            harness.opened = { path, fragment }
          },
        }),
        cm6.createEmbedProjectionExtension({
          store,
          locator: core.documentById(host.id),
          getAvailablePaths: () => ['EmbedHost.md', 'EmbedTarget.md'],
          onOpen: (path: string, fragment: string | null) => {
            harness.opened = { path, fragment }
          },
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
  opened: { path: string; fragment: string | null } | null
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
      opened: harness.opened,
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
  await expect(page.locator('[data-testid="embed-host-editor"] > .cm-editor'))
    .toHaveAttribute('data-reference-health', 'ready')
  const childContent = embed.locator('.cm-writeit-embed-projection__editor .cm-content')
  await childContent.click()
  await expect(childContent).toBeFocused()
  expect((await readHarness(page)).opened).toBeNull()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' edited')

  await expect.poll(async () => (await readHarness(page)).target.markdown).toBe(
    'target source edited',
  )
  const state = await readHarness(page)
  expect(state.host.markdown).toBe('Host\n\n![[EmbedTarget.md]]')
  expect(state.target.revision).toBe(1)
  expect(state.projectionCount).toBe(1)
  await embed.locator('[data-embed-action="open"]').click()
  await expect.poll(async () => (await readHarness(page)).opened).toEqual({
    path: 'EmbedTarget.md',
    fragment: null,
  })
  await destroyHarness(page)
})

test('keeps readonly embed body non-editable while its explicit open action navigates', async ({
  page,
}) => {
  await mountHarness(page, '![[EmbedTarget.md|ro]]')
  const embed = page.locator('[data-testid="embed-host-editor"] [data-writeit-embed]')
  await expect(embed).toHaveAttribute('data-embed-mode', 'readonly')
  const childContent = embed.locator('.cm-writeit-embed-projection__editor .cm-content')
  await childContent.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' must not apply')

  await expect.poll(async () => (await readHarness(page)).target.markdown).toBe(
    'target source',
  )
  expect((await readHarness(page)).target.revision).toBe(0)
  await embed.locator('[data-embed-action="open"]').click()
  await expect.poll(async () => (await readHarness(page)).opened).toEqual({
    path: 'EmbedTarget.md',
    fragment: null,
  })
  await destroyHarness(page)
})

test('decodes document-relative images in a nested embed with the shared resolver', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/index.ts')
    const preview = await loadModule('/src/editor/preview/index.ts')
    const filesystem = await loadModule('/src/platform/filesystem/index.ts')
    const store = new core.DocumentStore()
    const target = store.load({
      id: core.createDocumentId('browser-nested-image-target'),
      path: core.createDocumentPath('notes/deep/Target.md'),
      markdown: '![diagram](../assets/diagram.png)',
    })
    store.load({
      id: core.createDocumentId('browser-nested-image-parent'),
      path: core.createDocumentPath('notes/Parent.md'),
      markdown: '![[notes/deep/Target.md]]',
    })
    const host = store.load({
      id: core.createDocumentId('browser-nested-image-host'),
      path: core.createDocumentPath('Host.md'),
      markdown: '![[notes/Parent.md]]',
    })
    const root = document.createElement('section')
    root.dataset.testid = 'browser-nested-image-host'
    document.body.append(root)
    const fileSystem = new filesystem.MemoryFileSystem({
      binaryFiles: {
        'notes/assets/diagram.png': new Uint8Array([
          137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
          0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2,
          0, 0, 0, 11, 73, 68, 65, 84, 120, 156, 99, 98, 0, 0, 0, 4,
          0, 1, 9, 232, 3, 253, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
          96, 130,
        ]),
      },
    })
    const resolver = new preview.WorkspaceImageProjectionResolver({
      reader: fileSystem,
    })
    const projection = cm6.mountSingleDocumentView({
      store,
      locator: core.documentById(host.id),
      parent: root,
      projectionId: 'browser-nested-image-host',
      editable: true,
      presentationMode: 'live-preview',
      extensions: [
        cm6.createEmbedProjectionExtension({
          store,
          locator: core.documentById(host.id),
          getAvailablePaths: () => [
            'Host.md',
            'notes/Parent.md',
            'notes/deep/Target.md',
          ],
          imageProjection: {
            imageResolver: resolver,
            documentPath: host.path,
          },
        }),
      ],
      imageProjection: {
        imageResolver: resolver,
        documentPath: host.path,
      },
    })
    ;(
      window as unknown as {
        __writeItV2NestedImageHarness?: {
          readonly projection: { destroy(): void }
          readonly resolver: { dispose(): void }
          readonly targetLocator: unknown
          readonly store: { get(locator: unknown): { markdown: string; revision: number } | undefined }
        }
      }
    ).__writeItV2NestedImageHarness = {
      projection,
      resolver,
      targetLocator: core.documentById(target.id),
      store,
    }
  })

  const image = page.locator(
    '[data-testid="browser-nested-image-host"] [data-embed-target="notes/deep/Target.md"] .cm-writeit-live-preview-image__content',
  )
  await expect(image).toHaveAttribute('data-image-status', 'ready')
  await expect(image).toHaveAttribute('data-image-path', 'notes/assets/diagram.png')
  await expect.poll(() =>
    page.evaluate(() => {
      const candidate = document.querySelector<HTMLImageElement>(
        '[data-testid="browser-nested-image-host"] [data-embed-target="notes/deep/Target.md"] .cm-writeit-live-preview-image__content',
      )
      return Boolean(candidate?.complete && candidate.naturalWidth > 0)
    }),
  ).toBe(true)
  const sourceState = await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2NestedImageHarness?: {
          readonly store: { get(locator: unknown): { markdown: string; revision: number } | undefined }
          readonly targetLocator: unknown
        }
      }
    ).__writeItV2NestedImageHarness
    if (!harness) throw new Error('nested image harness is not mounted')
    const target = harness.store.get(harness.targetLocator)
    if (!target) throw new Error('nested image target is missing')
    return { markdown: target.markdown, revision: target.revision }
  })
  expect(sourceState).toEqual({
    markdown: '![diagram](../assets/diagram.png)',
    revision: 0,
  })
  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2NestedImageHarness?: {
          readonly projection: { destroy(): void }
          readonly resolver: { dispose(): void }
        }
      }
    ).__writeItV2NestedImageHarness
    harness?.projection.destroy()
    harness?.resolver.dispose()
  })
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
