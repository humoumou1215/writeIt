import { expect, test, type Page } from '@playwright/test'

type AnnotationHarnessState = {
  source: string
  revision: number
  drawerOpen: boolean
  drawerWidth: number
}

async function mountAnnotationHarness(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(async () => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const annotationApplication = await loadModule('/src/application/annotation/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/projection/single-document-view.ts')
    const annotationExtension = await loadModule('/src/editor/cm6/extensions/annotation.ts')
    const vue = await loadModule('/node_modules/.vite/deps/vue.js')
    const drawerModule = await loadModule('/src/ui/review/AnnotationDrawer.vue')

    document.querySelector('[data-annotation-harness]')?.remove()
    const root = document.createElement('section')
    root.dataset.annotationHarness = 'true'
    const editorHost = document.createElement('div')
    editorHost.dataset.testid = 'annotation-editor'
    const drawerHost = document.createElement('div')
    drawerHost.dataset.testid = 'annotation-drawer-host'
    root.append(editorHost, drawerHost)
    document.body.append(root)

    const source = 'Please review this sentence before merging.\n'
    const store = new core.DocumentStore()
    const id = core.createDocumentId('annotation-browser')
    const path = core.createDocumentPath('notes.md')
    const locator = core.documentById(id)
    store.load({ id, path, markdown: source })
    const repository = new annotationApplication.MemoryAnnotationRepository()
    const service = new annotationApplication.AnnotationService(repository)
    const from = source.indexOf('this sentence')
    const annotation = await service.create({
      id: 'browser-annotation',
      document: store.get(locator),
      from,
      to: from + 'this sentence'.length,
      comment: {
        id: 'browser-comment',
        author: 'Ada',
        body: 'Please clarify this sentence.',
        createdAt: new Date().toISOString(),
      },
    })

    const state = vue.reactive({
      annotations: [annotation],
      activeId: null as string | null,
      open: true,
      width: 360,
      version: 0,
    })
    const updateAnnotations = (next: readonly any[]): void => {
      state.annotations.splice(0, state.annotations.length, ...next)
      state.version += 1
      primary.updateAnnotations(state.annotations)
    }
    const handleReply = async (annotationId: string, body: string): Promise<void> => {
      const updated = await service.reply(path, annotationId, {
        id: `reply-${Date.now()}`,
        author: 'You',
        body,
        createdAt: new Date().toISOString(),
      })
      updateAnnotations(state.annotations.map((item: any) => item.id === annotationId ? updated : item))
    }
    const handleResolve = async (annotationId: string, resolved: boolean): Promise<void> => {
      const updated = await service.setResolved(path, annotationId, resolved ? 'resolved' : 'open', new Date().toISOString())
      updateAnnotations(state.annotations.map((item: any) => item.id === annotationId ? updated : item))
    }
    const DrawerHost = {
      setup() {
        return () => {
          state.version
          return vue.h(drawerModule.default, {
          annotations: state.annotations,
          activeId: state.activeId,
          open: state.open,
          width: state.width,
          onClose: () => { state.open = false },
          onSelect: (annotationId: string) => { state.activeId = annotationId },
          onReply: handleReply,
          onResolve: handleResolve,
          onResize: (width: number) => { state.width = width },
          })
        }
      },
    }
    const drawerApp = vue.createApp(DrawerHost)
    drawerApp.mount(drawerHost)

    const primary = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: editorHost,
      projectionId: 'annotation-browser-editor',
      editable: true,
      extensions: [annotationExtension.createAnnotationExtension({
        getAnnotations: () => state.annotations,
        onActivate: (item: any) => { state.activeId = item.id; state.open = true },
      })],
    })
    store.subscribe(locator, (event: any) => {
      if (event.type !== 'changed') return
      void service.reanchor(path, event.document, event.change).then(updateAnnotations)
    })
    primary.updateAnnotations(state.annotations)

    ;(window as any).__writeItV2AnnotationHarness = {
      store,
      locator,
      primary,
      state,
      destroy: () => { primary.destroy(); drawerApp.unmount(); root.remove() },
    }
  })
}

async function readState(page: Page): Promise<AnnotationHarnessState> {
  return page.evaluate(() => {
    const harness = (window as any).__writeItV2AnnotationHarness
    const document = harness.store.get(harness.locator)
    return {
      source: document.markdown,
      revision: document.revision,
      drawerOpen: harness.state.open,
      drawerWidth: harness.state.width,
    }
  })
}

test('annotation review supports mark activation, reply, resolve, resize, and deleted-range fallback', async ({ page }) => {
  await mountAnnotationHarness(page)
  await expect(page.locator('[data-annotation-id="browser-annotation"]')).toHaveText('this sentence')

  await page.locator('[data-annotation-id="browser-annotation"]').click()
  await expect(page.locator('[data-annotation-card="browser-annotation"]')).toHaveClass(/annotation-card--active/)

  const reply = page.locator('[data-annotation-reply="browser-annotation"]')
  await reply.fill('Looks good.')
  await reply.press('Enter')
  await expect.poll(async () => page.evaluate(() => {
    const harness = (window as any).__writeItV2AnnotationHarness
    return harness.state.annotations[0].thread.comments.length
  })).toBe(2)
  expect(await page.evaluate(() => (window as any).__writeItV2AnnotationHarness.state.annotations[0].thread.comments[1].body)).toBe('Looks good.')

  await page.locator('[data-annotation-resolve="browser-annotation"]').click()
  await expect.poll(async () => page.evaluate(() => (window as any).__writeItV2AnnotationHarness.state.annotations[0].thread.resolved)).toBe('resolved')

  const resize = page.locator('[data-testid="annotation-drawer-resize"]')
  await resize.dispatchEvent('pointerdown', { clientX: 0, bubbles: true })
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: -40 })))
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup')))
  await expect.poll(async () => (await readState(page)).drawerWidth).toBeGreaterThan(360)

  const initial = await readState(page)
  await page.evaluate(() => {
    const harness = (window as any).__writeItV2AnnotationHarness
    const source = harness.primary.view.state.doc.toString()
    const from = source.indexOf('this sentence')
    harness.primary.view.dispatch({ changes: { from, to: from + 'this sentence'.length, insert: 'rewritten' } })
  })
  await expect.poll(async () => page.evaluate(() => (window as any).__writeItV2AnnotationHarness.state.annotations[0].anchorResolution.status)).toBe('unresolved')
  const afterEdit = await readState(page)
  expect(afterEdit.revision).toBe(initial.revision + 1)
  expect(afterEdit.source).toContain('rewritten')
  await page.evaluate(() => (window as any).__writeItV2AnnotationHarness.destroy())
})
