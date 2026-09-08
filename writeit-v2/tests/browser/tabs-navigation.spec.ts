import { expect, test } from '@playwright/test'

test('opens documents in tabs, preserves dirty state, navigates, and reveals the active file', async ({
  page,
}) => {
  await page.goto('/')

  const tabs = page.getByTestId('workspace-tabs')
  await expect(tabs.locator('[role="tab"]')).toHaveCount(1)
  await expect(tabs).toContainText('welcome.md')

  await page.locator('[data-workspace-path="notes"]').getByRole('button', {
    name: 'Expand notes',
  }).click()
  await page
    .locator('[data-workspace-path="notes/architecture.md"] .workspace-tree__row')
    .click()

  await expect(tabs.locator('[role="tab"]')).toHaveCount(2)
  await expect(page.locator('[data-workspace-tab-path="notes/architecture.md"]')).toBeVisible()
  await expect(page.locator('dd').nth(0)).toHaveText('notes/architecture.md')
  await expect(page.locator('.cm-content')).toContainText('Architecture notes')

  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' edited')
  await expect(
    page.locator('[data-workspace-tab-path="notes/architecture.md"].workspace-tab--dirty'),
  ).toBeVisible()
  await expect(page.getByTestId('presentation-mode')).toBeVisible()

  await page
    .locator('[data-workspace-tab-path="welcome.md"]')
    .click()
  await expect(page.locator('dd').nth(0)).toHaveText('welcome.md')
  await expect(page.locator('.cm-content')).toContainText('WriteIt v2')
  await expect(
    page.locator('[data-workspace-tab-path="notes/architecture.md"].workspace-tab--dirty'),
  ).toBeVisible()

  await page.getByTestId('workspace-next-tab').click()
  await expect(page.locator('dd').nth(0)).toHaveText('notes/architecture.md')
  await page.getByTestId('workspace-prev-tab').click()
  await expect(page.locator('dd').nth(0)).toHaveText('welcome.md')

  // Tree order is notes/architecture.md, notes/workspace.md, welcome.md.
  await page.getByTestId('workspace-next-file').click()
  await expect(page.locator('dd').nth(0)).toHaveText('notes/architecture.md')
  await expect(tabs.locator('[role="tab"]')).toHaveCount(2)

  await page.getByRole('button', { name: 'Collapse notes' }).click()
  await expect(
    page.locator('[data-workspace-path="notes/architecture.md"]'),
  ).toHaveCount(0)
  await page.getByTestId('workspace-reveal-current').click()
  await expect(
    page.locator('[data-workspace-path="notes/architecture.md"]'),
  ).toBeVisible()
})

test('confirms before closing a dirty tab and closes it after confirmation', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('[data-workspace-path="notes"]').getByRole('button', {
    name: 'Expand notes',
  }).click()
  await page
    .locator('[data-workspace-path="notes/workspace.md"] .workspace-tree__row')
    .click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' local')

  const closeButton = page.locator(
    '[data-workspace-tab-path="notes/workspace.md"] + .workspace-tab__close',
  )
  let dialogMessage = ''
  page.once('dialog', async (dialog) => {
    dialogMessage = dialog.message()
    await dialog.dismiss()
  })
  await closeButton.click()
  expect(dialogMessage).toContain('unsaved changes')
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]')).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await closeButton.click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]')).toHaveCount(0)
})

test('can close the last tab and reopen the document from the workspace tree', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Close welcome.md' }).click()
  await expect(page.getByTestId('workspace-empty')).toBeVisible()
  await expect(page.locator('.cm-editor')).toHaveCount(0)

  await page
    .locator('[data-workspace-path="welcome.md"] .workspace-tree__row')
    .click()
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]')).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('WriteIt v2')
})
