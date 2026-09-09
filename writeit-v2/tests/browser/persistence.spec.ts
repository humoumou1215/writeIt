import { expect, test } from '@playwright/test'

test('manual save survives closing and reopening a document', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('workspace-save').click()
  await expect(page.getByTestId('persistence-status')).toHaveText('已保存')

  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('\nSaved from the persistence journey.')
  await expect(page.getByTestId('persistence-status')).toHaveText('未保存')
  await expect(page.getByTestId('workspace-save')).toBeEnabled()

  await page.getByTestId('workspace-save').click()
  await expect(page.getByTestId('persistence-status')).toHaveText('已保存')

  await page.getByRole('button', { name: 'Close welcome.md' }).click()
  await expect(page.getByTestId('workspace-empty')).toBeVisible()

  await page
    .locator('[data-workspace-path="welcome.md"] .workspace-tree__row')
    .click()
  await expect(page.locator('.cm-content')).toContainText(
    'Saved from the persistence journey.',
  )
  await expect(page.getByTestId('persistence-status')).toHaveText('已保存')
})
