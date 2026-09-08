import { expect, test, type Page } from '@playwright/test'

async function openNotesFiles(page: Page): Promise<void> {
  await page.locator('[data-workspace-path="notes"]').getByRole('button', {
    name: 'Expand notes',
  }).click()
  await page
    .locator('[data-workspace-path="notes/architecture.md"] .workspace-tree__row')
    .click()
  await page
    .locator('[data-workspace-path="notes/workspace.md"] .workspace-tree__row')
    .click()
  await page
    .locator('[data-workspace-tab-path="notes/architecture.md"]')
    .click()
}

test('directory deletion lists nested dirty documents and Cancel preserves runtime state', async ({
  page,
}) => {
  await page.goto('/')
  await openNotesFiles(page)

  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' local')
  await expect(page.getByTestId('persistence-status')).toHaveText('dirty')

  await page
    .locator('[data-workspace-path="notes"] .workspace-tree__row')
    .getByRole('button', { name: 'Delete notes' })
    .click()

  const dialog = page.getByTestId('workspace-delete-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('notes/architecture.md')
  await expect(dialog).toContainText('notes/workspace.md')
  await dialog.getByTestId('workspace-delete-cancel').click()

  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-workspace-path="notes"]')).toBeVisible()
  await expect(page.locator('[data-workspace-tab-path="notes/architecture.md"]')).toBeVisible()
  await expect(page.getByTestId('persistence-status')).toHaveText('dirty')
  await expect(page.locator('.cm-content')).toContainText('local')
})

test('directory deletion can Discard dirty nested Markdown and closes every affected tab', async ({
  page,
}) => {
  await page.goto('/')
  await openNotesFiles(page)

  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' discard me')
  await page
    .locator('[data-workspace-path="notes"] .workspace-tree__row')
    .getByRole('button', { name: 'Delete notes' })
    .click()
  await page.getByTestId('workspace-delete-discard').click()

  await expect(page.getByTestId('workspace-delete-dialog')).toHaveCount(0)
  await expect(page.locator('[data-workspace-path="notes"]')).toHaveCount(0)
  await expect(page.locator('[data-workspace-tab-path^="notes/"]')).toHaveCount(0)
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]')).toBeVisible()
})

test('file deletion can Save dirty Markdown before cleanup', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-workspace-path="notes"]').getByRole('button', {
    name: 'Expand notes',
  }).click()
  await page
    .locator('[data-workspace-path="notes/architecture.md"] .workspace-tree__row')
    .click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' save then delete')
  await expect(page.getByTestId('persistence-status')).toHaveText('dirty')

  await page
    .locator('[data-workspace-path="notes/architecture.md"] .workspace-tree__row')
    .getByRole('button', { name: 'Delete architecture.md' })
    .click()
  await page.getByTestId('workspace-delete-save').click()

  await expect(page.getByTestId('workspace-delete-dialog')).toHaveCount(0)
  await expect(
    page.locator('[data-workspace-path="notes/architecture.md"]'),
  ).toHaveCount(0)
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]')).toBeVisible()
})
