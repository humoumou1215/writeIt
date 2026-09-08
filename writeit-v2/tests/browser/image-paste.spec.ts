import { expect, test, type Page } from '@playwright/test'

async function dispatchImagePasteBatch(
  page: Page,
  images: readonly number[][],
  options: { readonly redispatch?: boolean; readonly freshItemProjection?: boolean } = {},
): Promise<boolean> {
  return page.evaluate(
    ({ imageBytes, redispatch, freshItemProjection }) => {
      const content = document.querySelector<HTMLElement>('.cm-content')
      if (!content) throw new Error('CM6 content is not mounted')
      content.focus()
      const files = imageBytes.map(
        (bytes, index) =>
          new File(
            [new Uint8Array(bytes)],
            imageBytes.length === 1 ? 'clipboard.png' : `clipboard-${index}.png`,
            { type: 'image/png' },
          ),
      )
      const event = new Event('paste', { bubbles: true, cancelable: true })
      const itemFiles = freshItemProjection
        ? imageBytes.map(
            (bytes, index) =>
              new File(
                [new Uint8Array(bytes)],
                imageBytes.length === 1
                  ? 'clipboard.png'
                  : `clipboard-${index}.png`,
                { type: 'image/png' },
              ),
          )
        : files
      Object.defineProperty(event, 'clipboardData', {
        configurable: true,
        value: {
          files,
          items: itemFiles.map((file) => ({
            kind: 'file',
            type: file.type,
            getAsFile: () => file,
          })),
        },
      })
      content.dispatchEvent(event)
      if (redispatch) content.dispatchEvent(event)
      return event.defaultPrevented
    },
    {
      imageBytes: images,
      redispatch: options.redispatch ?? false,
      freshItemProjection: options.freshItemProjection ?? false,
    },
  )
}

async function dispatchImagePaste(
  page: Page,
  bytes = [137, 80, 78, 71, 0, 1, 2, 3],
): Promise<boolean> {
  return dispatchImagePasteBatch(page, [bytes])
}

async function imageTokenCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const source = document.querySelector('.cm-content')?.textContent ?? ''
    return source.match(/!\[/gu)?.length ?? 0
  })
}

async function documentRevision(page: Page): Promise<number> {
  return page.evaluate(() => {
    const values = [...document.querySelectorAll('.document-meta dd')]
    return Number(values[1]?.textContent ?? '-1')
  })
}

test('pastes an image to a workspace destination with a document-relative source', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')

  expect(await dispatchImagePaste(page)).toBe(true)
  await expect.poll(() => imageTokenCount(page)).toBe(1)
  await expect.poll(() => documentRevision(page)).toBe(1)
  await expect(page.locator('.cm-content')).toContainText(/images\/\d{8}-\d{9}-/u)
  await expect(page.getByTestId('image-paste-status')).toContainText(
    'to the workspace',
  )
  await expect(page.getByRole('button', { name: 'Expand images' })).toBeVisible()
  await page.getByRole('button', { name: 'Expand images' }).click()
  await expect(page.locator('[data-workspace-path^="images/"]')).toHaveCount(1)
})

test('claims one event without duplicating a bridge projection and keeps explicit multi-image paste', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')

  const bytes = [137, 80, 78, 71, 0, 1, 2, 3]
  expect(
    await dispatchImagePasteBatch(page, [bytes], {
      freshItemProjection: true,
      redispatch: true,
    }),
  ).toBe(true)
  await expect.poll(() => imageTokenCount(page)).toBe(1)
  await expect.poll(() => documentRevision(page)).toBe(1)

  await page.getByRole('button', { name: 'Expand images' }).click()
  await expect(page.locator('[data-workspace-path^="images/"]')).toHaveCount(1)

  await page.goto('/')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  expect(
    await dispatchImagePasteBatch(page, [bytes, bytes], {
      freshItemProjection: true,
    }),
  ).toBe(true)
  await expect.poll(() => imageTokenCount(page)).toBe(2)
  await expect.poll(() => documentRevision(page)).toBe(1)
  await page.getByRole('button', { name: 'Expand images' }).click()
  await expect(page.locator('[data-workspace-path^="images/"]')).toHaveCount(2)
})

test('stores nested-document paste sources relative to the document directory', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand notes' }).click()
  await page.locator('[data-workspace-path="notes/architecture.md"] .workspace-tree__row').click()
  await expect(page.locator('.cm-content')).toContainText('# Architecture notes')

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  expect(await dispatchImagePaste(page)).toBe(true)

  await expect(page.locator('.cm-content')).toContainText(/\.\.\/images\/\d{8}-\d{9}-/u)
  const image = page.locator('.preview-host .live-preview-image__content')
  await expect(image).toHaveAttribute('data-image-path', /^images\/\d{8}-\d{9}-/u)
  const path = await image.getAttribute('data-image-path')
  if (!path) throw new Error('nested image path was not projected')

  await page.locator('.preview-host [data-image-action="reveal"]').click()
  await expect(
    page.locator(`[data-workspace-path="${path}"]`),
  ).toHaveAttribute('aria-selected', 'true')
})

test('resolves, previews, and locates a workspace image without changing Markdown', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  // Mount both source-backed image projections before the paste. Their shared
  // resolver must not race by revoking the URL used by the other projection.
  await page.getByTestId('presentation-toggle').click()

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
  await expect(image).toHaveAttribute('data-image-path', /^images\/\d{8}-\d{9}-/u)
  const path = await image.getAttribute('data-image-path')
  if (!path) throw new Error('image path was not projected')
  await expect(image).toHaveAttribute('src', /^(blob:|data:)/)
  const editorImage = page.locator(
    '.cm-writeit-live-preview-image__content',
  )
  await expect(editorImage).toHaveAttribute('data-image-status', 'ready')
  await expect.poll(() =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLImageElement>(
        '.preview-host img, .cm-writeit-live-preview-image__content',
      )].every((candidate) => candidate.complete && candidate.naturalWidth > 0),
    ),
  ).toBe(true)

  await editorImage.click()
  await expect(page.getByTestId('image-preview-modal')).toHaveCount(0)
  const editorImageShell = page.locator('.cm-writeit-live-preview-image')
  await editorImageShell.hover()
  const editorPreviewAction = editorImageShell.locator('[data-image-action="preview"]')
  await expect(editorPreviewAction).toBeVisible()
  await editorPreviewAction.click()
  await expect(page.getByTestId('image-preview-modal')).toBeVisible()
  await page.getByTestId('image-preview-close').click()

  // Return to raw source before asserting source fidelity and exercising the
  // copy/preview/reopen projection actions.
  await page.getByTestId('presentation-toggle').click()
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

  await page.getByTestId('workspace-save').click()
  await expect(page.getByTestId('persistence-status')).toHaveText('clean')
  await page.getByRole('button', { name: 'Close welcome.md' }).click()
  await expect(page.getByTestId('workspace-empty')).toBeVisible()
  await page
    .locator('[data-workspace-path="welcome.md"] .workspace-tree__row')
    .click()
  await expect(page.locator('.cm-content')).toContainText(path)
  const reopenedImage = page.locator(
    '.preview-host .live-preview-image__content',
  )
  await expect(reopenedImage).toHaveAttribute('data-image-status', 'ready')
  await expect.poll(() =>
    page.evaluate(() => {
      const candidate = document.querySelector<HTMLImageElement>(
        '.preview-host .live-preview-image__content',
      )
      return Boolean(candidate?.complete && candidate.naturalWidth > 0)
    }),
  ).toBe(true)
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
