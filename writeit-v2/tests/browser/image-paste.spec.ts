import { expect, test, type Page } from '@playwright/test'

async function dispatchImagePaste(
  page: Page,
  bytes = [137, 80, 78, 71, 0, 1, 2, 3],
): Promise<boolean> {
  return page.evaluate((imageBytes) => {
    const content = document.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CM6 content is not mounted')
    content.focus()
    const data = new DataTransfer()
    data.items.add(
      new File([new Uint8Array(imageBytes)], 'clipboard.png', {
        type: 'image/png',
      }),
    )
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    })
    content.dispatchEvent(event)
    return event.defaultPrevented
  }, bytes)
}

test('pastes an image to a workspace-relative attachment and refreshes the tree', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')

  expect(await dispatchImagePaste(page)).toBe(true)
  await expect(page.locator('.cm-content')).toContainText('images/Pasted-')
  await expect(page.getByTestId('image-paste-status')).toContainText(
    'to the workspace',
  )
  await expect(page.getByRole('button', { name: 'Expand images' })).toBeVisible()
  await page.getByRole('button', { name: 'Expand images' }).click()
  await expect(page.locator('[data-workspace-path^="images/Pasted-"]')).toBeVisible()
})

test('resolves, previews, and locates a workspace image without changing Markdown', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')

  // A valid 1x1 PNG lets Chromium exercise the read/URL/decode path rather
  // than only the source-preserving broken-image fallback.
  const validPng = [
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
    1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68,
    65, 84, 120, 156, 99, 98, 0, 0, 0, 4, 0, 1, 9, 232, 3, 253, 0, 0,
    0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]
  expect(await dispatchImagePaste(page, validPng)).toBe(true)

  const image = page.locator('.preview-host .live-preview-image__content')
  await expect(image).toHaveAttribute('data-image-status', 'ready')
  await expect(image).toHaveAttribute('data-image-path', /^images\/Pasted-/)
  const path = await image.getAttribute('data-image-path')
  if (!path) throw new Error('image path was not projected')
  await expect(image).toHaveAttribute('src', /^(blob:|data:)/)

  const sourceBeforeCopy = await page.locator('.cm-content').textContent()
  await page.locator('.preview-host [data-image-action="copy"]').click()
  await expect(page.getByTestId('image-action-status')).toContainText(
    /clipboard/i,
  )
  expect(await page.locator('.cm-content').textContent()).toBe(sourceBeforeCopy)

  await page
    .locator('.preview-host [data-image-action="preview"]')
    .click()
  await expect(page.getByTestId('image-preview-modal')).toBeVisible()
  await page.getByTestId('image-preview-close').click()

  await page
    .locator('.preview-host [data-image-action="reveal"]')
    .click()
  await expect(
    page.locator(`[data-workspace-path="${path}"]`),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.cm-content')).toContainText(path)
})

test('supports the explicit inline base64 image strategy', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('workspace-settings-toggle').click()
  await page.getByTestId('settings-image-paste-mode').selectOption('inline')

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  expect(await dispatchImagePaste(page)).toBe(true)

  await expect(page.locator('.cm-content')).toContainText(
    '![clipboard](data:image/png;base64,iVBORwABAgM=)',
  )
  await expect(page.getByTestId('image-paste-status')).toContainText('inline')
})
