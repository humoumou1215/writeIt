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
  await page.evaluate((bytes) => {
    const content = document.querySelector<HTMLElement>(
      '.editor-host > .cm-editor .cm-content',
    )
    if (!content) throw new Error('active CM6 content is not mounted')
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
  }, validPng)
  await expect(page.getByTestId('image-paste-status')).toContainText('to the workspace')
  await expect(
    page.locator('.editor-host > .cm-editor .cm-content'),
  ).toContainText('images/')
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
  await expect(page.locator('.editor-host > .cm-editor .cm-content'))
    .toContainText('Workspace tree edited')
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
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]'))
    .toHaveAttribute('aria-selected', 'true')

  await embed.locator('[data-embed-action="open"]').click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('aria-selected', 'true')
})
