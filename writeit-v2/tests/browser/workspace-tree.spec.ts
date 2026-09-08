import { expect, test } from '@playwright/test'

test('workspace tree can refresh, create, drag-move, rename and delete entries', async ({
  page,
}) => {
  await page.goto('/')

  const tree = page.getByTestId('workspace-tree')
  await expect(tree).toContainText('welcome.md')
  await expect(tree).toContainText('notes')

  await page.getByTestId('workspace-entry-name').fill('drafts')
  await page.getByTestId('workspace-create-directory').click()
  await expect(tree).toContainText('drafts')

  await page
    .locator('[data-workspace-path="welcome.md"] .workspace-tree__row')
    .dragTo(page.locator('[data-workspace-path="drafts"] .workspace-tree__row'))

  await page.getByRole('button', { name: 'Expand drafts' }).click()
  await expect(
    page.locator('[data-workspace-path="drafts/welcome.md"]'),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Rename welcome.md' }).click()
  const renameInput = page.getByRole('textbox', { name: 'Rename welcome.md' })
  await renameInput.fill('moved.md')
  await renameInput.press('Enter')
  await expect(
    page.locator('[data-workspace-path="drafts/moved.md"]'),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Delete moved.md' }).click()
  await expect(
    page.locator('[data-workspace-path="drafts/moved.md"]'),
  ).toHaveCount(0)

  await page.getByTestId('workspace-refresh').click()
  await expect(tree).toContainText('drafts')
})
