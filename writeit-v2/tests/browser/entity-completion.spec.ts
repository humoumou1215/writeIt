import { expect, test, type Page } from '@playwright/test'

type EntityCompletionHarness = {
  store: {
    get(locator: unknown): { markdown: string; revision: number } | undefined
    getHistory(locator: unknown): { undo: readonly unknown[]; redo: readonly unknown[] }
  }
  locator: unknown
  projection: {
    view: {
      state: { selection: { main: { anchor: number; head: number } } }
    }
    destroy(): void
  }
}

type EntityCompletionSession = {
  source: string
  revision: number
  history: { undo: readonly unknown[]; redo: readonly unknown[] }
  caret: { anchor: number; head: number }
}

async function mountHarness(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(async () => {
    const loadModule = (path: string): Promise<any> =>
      import(new URL(path, window.location.origin).href)
    const core = await loadModule('/src/core/document/index.ts')
    const assistance = await loadModule('/src/application/assistance/index.ts')
    const filesystem = await loadModule('/src/platform/filesystem/index.ts')
    const cm6 = await loadModule('/src/editor/cm6/index.ts')

    const root = document.createElement('section')
    root.style.cssText = 'position:fixed;inset:0;z-index:100;background:white;overflow:auto'
    root.style.padding = '24px'
    root.dataset.entityCompletionHarness = 'true'
    const editorHost = document.createElement('div')
    editorHost.className = 'editor-host'
    editorHost.dataset.testid = 'entity-completion-editor'
    root.append(editorHost)
    document.body.append(root)

    const fileSystem = new filesystem.MemoryFileSystem({
      files: {
        'meeting.md': '# Meeting\n\n## Decisions\n\nKeep source.\n',
        'plain.md': 'No headings.\n',
      },
    })
    const store = new core.DocumentStore()
    const id = core.createDocumentId('browser-entity-completion-document')
    const locator = core.documentById(id)
    store.load({ id, path: core.createDocumentPath('host.md'), markdown: '' })

    const registry = new assistance.CompletionProviderRegistry()
    registry.register(
      assistance.createReferenceCompletionProvider({ workspace: fileSystem }),
    )
    const projection = cm6.mountSingleDocumentView({
      store,
      locator,
      parent: editorHost,
      projectionId: 'browser-entity-completion-editor',
      editable: true,
      extensions: [cm6.createCompletionExtension({ registry })],
    })
    ;(
      window as unknown as {
        __writeItV2EntityCompletionHarness?: EntityCompletionHarness
      }
    ).__writeItV2EntityCompletionHarness = { store, locator, projection }
  })
}

async function readSource(page: Page): Promise<{ markdown: string; revision: number }> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2EntityCompletionHarness?: EntityCompletionHarness
      }
    ).__writeItV2EntityCompletionHarness
    if (!harness) throw new Error('entity completion harness is not mounted')
    const document = harness.store.get(harness.locator)
    if (!document) throw new Error('entity completion document is missing')
    return document
  })
}

async function readSession(page: Page): Promise<EntityCompletionSession> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2EntityCompletionHarness?: EntityCompletionHarness
      }
    ).__writeItV2EntityCompletionHarness
    if (!harness) throw new Error('entity completion harness is not mounted')
    const document = harness.store.get(harness.locator)
    if (!document) throw new Error('entity completion document is missing')
    const selection = harness.projection.view.state.selection.main
    return {
      source: document.markdown,
      revision: document.revision,
      history: harness.store.getHistory(harness.locator),
      caret: { anchor: selection.anchor, head: selection.head },
    }
  })
}

async function destroyHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __writeItV2EntityCompletionHarness?: EntityCompletionHarness
      }
    ).__writeItV2EntityCompletionHarness
    harness?.projection.destroy()
  })
}

test('selecting a file opens file-self and heading entities before applying Markdown', async ({
  page,
}) => {
  await mountHarness(page)
  const editor = page.locator('[data-testid="entity-completion-editor"] .cm-content')
  const menu = page.locator('[data-testid="entity-completion-editor"] [data-completion-menu]')

  await editor.click()
  await page.keyboard.insertText('[[meet')
  await expect(menu.locator('[data-completion-id="reference:file:meeting.md"]')).toBeVisible()

  await menu.locator('[data-completion-id="reference:file:meeting.md"]').click()
  await expect.poll(async () => (await readSource(page)).markdown).toBe('[[meet')
  await expect(menu).toHaveAttribute('data-completion-level', '1')
  await expect(
    menu.locator('[data-completion-id="reference:heading:meeting.md#Decisions"]'),
  ).toBeVisible()

  await menu.locator('[data-completion-id="reference:heading:meeting.md#Decisions"]').click()
  await expect
    .poll(async () => (await readSource(page)).markdown)
    .toBe('[[meeting.md#Decisions]]')

  await destroyHarness(page)
})

test('keeps entity navigation source-safe and applies all three reference modes', async ({
  page,
}) => {
  await mountHarness(page)
  const editor = page.locator('[data-testid="entity-completion-editor"] .cm-content')
  const menu = page.locator('[data-testid="entity-completion-editor"] [data-completion-menu]')
  const modes = [
    ['link', '[[meeting.md#Decisions]]'],
    ['embed', '![[meeting.md#Decisions]]'],
    ['embed-readonly', '![[meeting.md#Decisions|ro]]'],
  ] as const

  await editor.click()
  for (const [index, [mode, expected]] of modes.entries()) {
    if (index > 0) {
      await page.keyboard.press('Enter')
      await page.keyboard.insertText('@meet')
    } else {
      await page.keyboard.insertText('@meet')
    }
    await expect(
      menu.locator('[data-completion-id="reference:file:meeting.md"]'),
    ).toBeVisible()
    const beforeMode = await readSession(page)

    if (mode !== 'link') {
      await menu.locator(`[data-completion-mode-id="${mode}"]`).click()
      expect(await readSession(page)).toEqual(beforeMode)
    }
    await expect(menu).toHaveAttribute('data-active-mode', mode)
    await expect(menu.locator('[data-completion-kind="file"]')).toHaveCount(1)

    await menu.locator('[data-completion-id="reference:file:meeting.md"]').click()
    await expect(menu).toHaveAttribute('data-completion-level', '1')
    await expect.poll(async () => (await readSession(page)).source).toBe(beforeMode.source)
    expect(await readSession(page)).toEqual(beforeMode)

    await menu.locator('[data-completion-back]').click()
    await expect(menu).toHaveAttribute('data-completion-level', '0')
    expect(await readSession(page)).toEqual(beforeMode)

    await menu.locator('[data-completion-id="reference:file:meeting.md"]').click()
    await expect(menu).toHaveAttribute('data-completion-level', '1')
    await menu.locator('[data-completion-id="reference:heading:meeting.md#Decisions"]').click()
    await expect.poll(async () => (await readSource(page)).markdown).toContain(expected)
  }

  await destroyHarness(page)
})

test('normalizes full-width triggers before entering entity candidates', async ({
  page,
}) => {
  await mountHarness(page)
  const editor = page.locator('[data-testid="entity-completion-editor"] .cm-content')
  const menu = page.locator('[data-testid="entity-completion-editor"] [data-completion-menu]')
  const cases = [
    ['＠meet', '@', 'link', '[[meeting.md#Decisions]]'],
    ['［［meet', '[[', 'link', '[[meeting.md#Decisions]]'],
    ['！【【meet', '![[' , 'embed', '![[meeting.md#Decisions]]'],
  ] as const

  await editor.click()
  for (const [index, [source, triggerKind, mode, expected]] of cases.entries()) {
    if (index > 0) await page.keyboard.press('Enter')
    await page.keyboard.insertText(source)
    await expect(menu).toHaveAttribute('data-trigger-kind', triggerKind)
    await expect(menu).toHaveAttribute('data-active-mode', mode)
    await menu.locator('[data-completion-id="reference:file:meeting.md"]').click()
    await expect(menu).toHaveAttribute('data-completion-level', '1')
    await menu.locator('[data-completion-id="reference:heading:meeting.md#Decisions"]').click()
    await expect.poll(async () => (await readSource(page)).markdown).toContain(expected)
  }

  await destroyHarness(page)
})
