import { expect, test, type Page } from '@playwright/test'

const validPng = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
  1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68,
  65, 84, 120, 156, 99, 98, 0, 0, 0, 4, 0, 1, 9, 232, 3, 253, 0, 0,
  0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]

async function appendReferenceToWelcome(
  page: Page,
  reference: string,
): Promise<void> {
  const editor = page.locator('.editor-host > .cm-editor .cm-content')
  await expect(editor).toContainText('DocumentStore')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText(`\n\n${reference}`)
  await page.getByTestId('presentation-toggle').click()
}

async function pasteValidImageIntoActiveDocument(page: Page): Promise<void> {
  await page.locator('.editor-host > .cm-editor .cm-content').click()
  await page.keyboard.press('Control+End')
  await dispatchValidImagePaste(page, '.editor-host > .cm-editor .cm-content')
  await expect(page.getByTestId('image-paste-status')).toContainText('to the workspace')
  await expect(
    page.locator('.editor-host > .cm-editor .cm-content'),
  ).toContainText('images/')
}

async function documentRevision(page: Page): Promise<number> {
  return page.evaluate(() => {
    return Number(document.querySelector('[data-document-revision]')?.getAttribute('data-document-revision') ?? '-1')
  })
}

async function dispatchValidImagePaste(
  page: Page,
  selector: string,
): Promise<void> {
  await page.evaluate(({ bytes, targetSelector }) => {
    const content = document.querySelector<HTMLElement>(targetSelector)
    if (!content) throw new Error(`CM6 content is not mounted: ${targetSelector}`)
    const file = new File([new Uint8Array(bytes)], 'diagram.png', {
      type: 'image/png',
    })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: {
        files: [file],
        items: [{
          kind: 'file',
          type: 'image/png',
          getAsFile: () => file,
        }],
      },
    })
    content.dispatchEvent(event)
  }, { bytes: validPng, targetSelector: selector })
}

test('welcome editable embed keeps focus in the current tab and previews target images', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]'))
    .toHaveAttribute('aria-selected', 'true')

  await page.getByRole('button', { name: 'Expand notes' }).click()
  await page.locator('[data-workspace-path="notes/workspace.md"] .workspace-tree__row').click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  const existingTargetTab = page.locator('[data-workspace-tab-path="notes/workspace.md"]')
  const existingTargetDocumentId = await existingTargetTab.getAttribute('data-workspace-tab-id')
  expect(existingTargetDocumentId).toBeTruthy()
  await pasteValidImageIntoActiveDocument(page)

  await page.locator('[data-workspace-tab-path="welcome.md"]').click()
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  await appendReferenceToWelcome(page, '![[notes/workspace.md]]')

  const embed = page.locator(
    '.editor-host > .cm-editor [data-writeit-embed][data-embed-mode="editable"]',
  )
  await expect(embed).toHaveAttribute('data-embed-status', 'mounted')
  const childText = embed.locator('.cm-writeit-embed-projection__editor .cm-line').first()
  const childContent = embed.locator('.cm-writeit-embed-projection__editor .cm-content')
  await childText.click()
  await expect(childContent).toBeFocused()
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]'))
    .toHaveAttribute('aria-selected', 'true')

  await page.keyboard.insertText(' edited')
  await expect(childContent).toContainText('Workspace tree edited')
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]'))
    .toHaveAttribute('aria-selected', 'true')

  const image = embed.locator('.cm-writeit-live-preview-image__content')
  await expect(image).toHaveAttribute('data-image-status', 'ready')
  await expect(image).toHaveAttribute('data-image-path', /^images\//u)
  await expect.poll(() =>
    page.evaluate(() => {
      const candidate = document.querySelector<HTMLImageElement>(
        '.editor-host > .cm-editor [data-writeit-embed] .cm-writeit-live-preview-image__content',
      )
      return Boolean(candidate?.complete && candidate.naturalWidth > 0)
    }),
  ).toBe(true)

  // Opening is an explicit action; it is the only point at which this test
  // permits navigation away from the current welcome tab.
  await embed.locator('[data-embed-action="open"]').click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('workspace-tabs').locator('[role="tab"]'))
    .toHaveCount(2)
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('data-workspace-tab-id', existingTargetDocumentId as string)
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveClass(/workspace-tab--dirty/u)
  await expect(page.locator('.editor-host > .cm-editor .cm-content'))
    .toContainText('Workspace tree edited')
})

test('real App editable Embed child exposes the shared slash popup', async ({
  page,
}) => {
  await page.goto('/')
  await appendReferenceToWelcome(page, '![[notes/workspace.md]]')

  const embed = page.locator(
    '.editor-host > .cm-editor [data-writeit-embed][data-embed-mode="editable"]',
  )
  await expect(embed).toHaveAttribute('data-embed-status', 'mounted')
  await expect(embed).toHaveAttribute('data-embed-ready', 'true')
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveCount(0)
  const childContent = embed.locator(
    '.cm-writeit-embed-projection__editor .cm-content',
  )
  await childContent.click({ force: true })
  await childContent.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('/')

  const slashMenu = embed.locator('[data-slash-menu]')
  await expect(slashMenu).toHaveAttribute('data-show', 'true')
  await expect(
    slashMenu.locator('[data-command-id="markdown.heading-2"]'),
  ).toBeVisible()
  const hostRevisionBeforeApply = await documentRevision(page)
  await slashMenu.locator('[data-command-id="markdown.heading-2"]').click({ force: true })
  await expect(slashMenu).toHaveAttribute('data-show', 'false')
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  expect(await documentRevision(page)).toBe(hostRevisionBeforeApply)
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveCount(0)

  await embed.locator('[data-embed-action="open"]').click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveClass(/workspace-tab--dirty/u)
  await expect(page.getByTestId('persistence-status')).toHaveText('未保存')
  await expect(page.locator('.editor-host > .cm-editor .cm-content'))
    .toContainText('## ')
  expect(await documentRevision(page)).toBeGreaterThan(0)
})

test('real App editable Embed child exposes @, [[, and ![[ completion', async ({
  page,
}) => {
  await page.goto('/')
  await appendReferenceToWelcome(page, '![[notes/workspace.md]]')

  const embed = page.locator(
    '.editor-host > .cm-editor [data-writeit-embed][data-embed-mode="editable"]',
  )
  await expect(embed).toHaveAttribute('data-embed-status', 'mounted')
  await expect(embed).toHaveAttribute('data-embed-ready', 'true')
  const childContent = embed.locator(
    '.cm-writeit-embed-projection__editor .cm-content',
  )
  const hostRevisionBeforeChildCompletion = await documentRevision(page)
  const cases = [
    ['@arch', '@', '[[notes/architecture.md]]'],
    ['[[arch', '[[', '[[notes/architecture.md]]'],
    ['![[arch', '![[' , '![[notes/architecture.md]]'],
  ] as const

  for (const [trigger, triggerKind] of cases) {
    await childContent.click({ force: true })
    await childContent.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText(trigger)

    const menu = embed.locator('[data-completion-menu]').first()
    await expect(menu).toHaveAttribute('data-show', 'true')
    await expect(menu).toHaveAttribute('data-trigger-kind', triggerKind)
    const file = menu.locator(
      '[data-completion-id="reference:file:notes/architecture.md"]',
    )
    await expect(file).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(menu).toHaveAttribute('data-completion-level', '1')
    await page.keyboard.press('Enter')
    await expect(menu).toHaveAttribute('data-show', 'false')
    await expect(page.locator('[data-workspace-tab-path="welcome.md"]'))
      .toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-workspace-tab-path="notes/architecture.md"]'))
      .toHaveCount(0)
    // The source assertion is made in the target tab after all three trigger
    // forms have been exercised; the host remains the active tab throughout.
  }

  expect(await documentRevision(page)).toBe(hostRevisionBeforeChildCompletion)
  await page
    .locator('[data-writeit-embed][data-embed-target="notes/workspace.md"] > .cm-writeit-embed-projection__label [data-embed-action="open"]')
    .click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  const targetSource = page.locator('.editor-host > .cm-editor .cm-content')
  for (const expected of cases.map(([, , insertion]) => insertion)) {
    await expect(targetSource).toContainText(expected)
  }
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveClass(/workspace-tab--dirty/u)
  expect(await documentRevision(page)).toBeGreaterThan(0)
})

test('real App readonly Embed child has no popup mutation surface', async ({
  page,
}) => {
  await page.goto('/')
  await appendReferenceToWelcome(page, '![[notes/workspace.md|ro]]')

  const embed = page.locator(
    '.editor-host > .cm-editor [data-writeit-embed][data-embed-mode="readonly"]',
  )
  await expect(embed).toHaveAttribute('data-embed-status', 'mounted')
  await expect(embed.locator('.cm-content')).toHaveAttribute(
    'contenteditable',
    'false',
  )
  await expect(embed.locator('[data-slash-menu]')).toHaveCount(0)
  await expect(embed.locator('[data-completion-menu]')).toHaveCount(0)
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]'))
    .toHaveAttribute('aria-selected', 'true')
})

test('explicit Open activates a loaded dirty Embed target without a second tab', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand notes' }).click()
  await page.locator('[data-workspace-path="notes/workspace.md"] .workspace-tree__row').click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('aria-selected', 'true')

  // Leave B loaded in DocumentStore but remove its workspace tab. The Embed
  // child below will be the only projection that edits this Document.
  await page.getByRole('button', { name: 'Close workspace.md' }).click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveCount(0)
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]'))
    .toHaveAttribute('aria-selected', 'true')

  await appendReferenceToWelcome(page, '![[notes/workspace.md]]')
  const hostRevisionBeforeChildEdit = await documentRevision(page)
  const embed = page.locator(
    '.editor-host > .cm-editor [data-writeit-embed][data-embed-mode="editable"]',
  )
  await expect(embed).toHaveAttribute('data-embed-status', 'mounted')
  await expect(embed).toHaveAttribute('data-embed-ready', 'true')
  const childDocumentId = await embed
    .locator('.cm-writeit-embed-projection__editor')
    .getAttribute('data-embed-document-id')
  expect(childDocumentId).toBeTruthy()
  const childContent = embed.locator(
    '.cm-writeit-embed-projection__editor .cm-content',
  )
  await childContent.click({ force: true })
  await childContent.press('End')
  await page.keyboard.insertText(' dirty through Embed')
  await expect(childContent).toContainText('Workspace tree dirty through Embed')
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveCount(0)

  await embed.locator('[data-embed-action="open"]').click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('data-workspace-tab-id', childDocumentId as string)
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveClass(/workspace-tab--dirty/u)
  await expect(page.getByTestId('workspace-tabs').locator('[role="tab"]'))
    .toHaveCount(2)
  await expect(page.locator('.editor-host > .cm-editor .cm-content'))
    .toContainText('Workspace tree dirty through Embed')
  await expect(page.getByTestId('workspace-error')).toHaveCount(0)

  await page.getByTestId('workspace-save').click()
  await expect(page.getByTestId('persistence-status')).toHaveText('已保存')
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .not.toHaveClass(/workspace-tab--dirty/u)

  // Switching back to source makes the host token/revision check explicit;
  // opening B did not mutate or reload A.
  await page.locator('[data-workspace-tab-path="welcome.md"]').click()
  await page.getByTestId('presentation-toggle').click()
  await expect(page.locator('.editor-host > .cm-editor .cm-content'))
    .toContainText('![[notes/workspace.md]]')
  expect(await documentRevision(page)).toBe(hostRevisionBeforeChildEdit)
})

test('missing Embed target can appear, become dirty, and then be explicitly opened by identity', async ({
  page,
}) => {
  await page.goto('/')
  await appendReferenceToWelcome(page, '![[notes/appears.md]]')
  const embed = page.locator(
    '.editor-host > .cm-editor [data-writeit-embed][data-embed-mode="editable"]',
  )
  await expect(embed).toHaveAttribute('data-embed-status', 'missing')

  await page.getByRole('button', { name: 'Expand notes' }).click()
  await page.locator('[data-workspace-path="notes"] > .workspace-tree__row').click()
  await page.locator('.workspace-create > summary').click()
  await page.getByTestId('workspace-entry-name').fill('appears.md')
  await page.getByTestId('workspace-create-file').click()
  await expect(page.locator('[data-workspace-path="notes/appears.md"]'))
    .toBeVisible()
  await expect(embed).toHaveAttribute('data-embed-status', 'mounted')
  const childDocumentId = await embed
    .locator('.cm-writeit-embed-projection__editor')
    .getAttribute('data-embed-document-id')
  expect(childDocumentId).toBeTruthy()

  const childContent = embed.locator(
    '.cm-writeit-embed-projection__editor .cm-content',
  )
  await childContent.click()
  await page.keyboard.insertText('appeared and dirty')
  await expect(childContent).toContainText('appeared and dirty')
  await embed.locator('[data-embed-action="open"]').click()

  await expect(page.locator('[data-workspace-tab-path="notes/appears.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-workspace-tab-path="notes/appears.md"]'))
    .toHaveAttribute('data-workspace-tab-id', childDocumentId as string)
  await expect(page.locator('[data-workspace-tab-path="notes/appears.md"]'))
    .toHaveClass(/workspace-tab--dirty/u)
  await expect(page.getByTestId('workspace-tabs').locator('[role="tab"]'))
    .toHaveCount(2)
  await expect(page.locator('.editor-host > .cm-editor .cm-content'))
    .toContainText('appeared and dirty')
  await expect(page.getByTestId('workspace-error')).toHaveCount(0)
})

test('real App exposes a failed Embed load, retries explicitly, and recovers without changing host source', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() => {
    const hook = (window as unknown as {
      __writeItV2AppTest?: { failNextEmbeddedLoad(path: string): void }
    }).__writeItV2AppTest
    if (!hook) throw new Error('App test hook is unavailable')
    hook.failNextEmbeddedLoad('notes/workspace.md')
  })
  const revisionBefore = await documentRevision(page)
  await appendReferenceToWelcome(page, '![[notes/workspace.md]]')

  const embed = page.locator(
    '.editor-host > .cm-editor [data-writeit-embed][data-embed-target="notes/workspace.md"]',
  )
  await expect(embed).toHaveAttribute('data-embed-status', 'error')
  await expect(embed.locator('[data-embed-message="error"]')).toContainText(
    'Simulated transient Embed load failure',
  )
  await expect(embed.locator('[data-embed-action="retry"]')).toBeVisible()
  await embed.locator('[data-embed-action="retry"]').click()
  await expect(embed).toHaveAttribute('data-embed-status', 'mounted')
  await expect(embed.locator('.cm-content')).toContainText('Workspace tree')
  expect(await documentRevision(page)).toBe(revisionBefore + 1)

  await page.getByTestId('presentation-toggle').click()
  await expect(page.locator('.editor-host > .cm-editor .cm-content'))
    .toContainText('![[notes/workspace.md]]')
})

test('unloaded clean files keep the normal filesystem Open path', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand notes' }).click()
  await page.locator('[data-workspace-path="notes/architecture.md"] .workspace-tree__row').click()
  await expect(page.locator('[data-workspace-tab-path="notes/architecture.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.editor-host > .cm-editor .cm-content'))
    .toContainText('Architecture notes')
  await expect(page.getByTestId('persistence-status')).toHaveText('已保存')
})

test('editable embed child paste mutates the target source without repeating the host mutation', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand notes' }).click()
  await page.locator('[data-workspace-path="notes/workspace.md"] .workspace-tree__row').click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  await page.locator('[data-workspace-tab-path="welcome.md"]').click()
  await appendReferenceToWelcome(page, '![[notes/workspace.md]]')

  const embed = page.locator(
    '.editor-host > .cm-editor [data-writeit-embed][data-embed-mode="editable"]',
  )
  await expect(embed).toHaveAttribute('data-embed-status', 'mounted')
  const childContent = embed.locator(
    '.cm-writeit-embed-projection__editor .cm-content',
  )
  await childContent.click()
  await page.keyboard.press('Control+End')
  const hostRevisionBeforePaste = await documentRevision(page)

  await dispatchValidImagePaste(
    page,
    '.editor-host > .cm-editor [data-writeit-embed][data-embed-mode="editable"] .cm-writeit-embed-projection__editor .cm-content',
  )
  await expect(page.getByTestId('image-paste-status')).toContainText(
    'to the workspace',
  )
  await expect.poll(() => documentRevision(page)).toBe(hostRevisionBeforePaste)
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]'))
    .toHaveAttribute('aria-selected', 'true')

  const image = embed.locator('.cm-writeit-live-preview-image__content')
  await expect(image).toHaveAttribute('data-image-status', 'ready')
  await expect(image).toHaveAttribute('data-image-path', /^images\//u)

  await embed.locator('[data-embed-action="open"]').click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.editor-host > .cm-editor .cm-content'))
    .toContainText('../images/')
})

test('welcome readonly embed rejects body input but keeps explicit navigation', async ({
  page,
}) => {
  await page.goto('/')
  await appendReferenceToWelcome(page, '![[notes/workspace.md|ro]]')

  const embed = page.locator(
    '.editor-host > .cm-editor [data-writeit-embed][data-embed-mode="readonly"]',
  )
  await expect(embed).toHaveAttribute('data-embed-status', 'mounted')
  const childContent = embed.locator('.cm-writeit-embed-projection__editor .cm-content')
  await expect(childContent).toHaveAttribute('contenteditable', 'false')
  const before = await childContent.textContent()
  await childContent.click()
  await page.keyboard.insertText(' must not apply')
  await expect(childContent).toHaveText(before ?? '')
  await dispatchValidImagePaste(
    page,
    '.editor-host > .cm-editor [data-writeit-embed][data-embed-mode="readonly"] .cm-writeit-embed-projection__editor .cm-content',
  )
  await expect(page.getByTestId('image-paste-status')).toHaveCount(0)
  await expect(childContent).toHaveText(before ?? '')
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]'))
    .toHaveAttribute('aria-selected', 'true')

  await embed.locator('[data-embed-action="open"]').click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.editor-host > .cm-editor .cm-content'))
    .not.toContainText('../images/')
})
