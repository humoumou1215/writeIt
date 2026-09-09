import { expect, test } from '@playwright/test'

test('renaming a file rewrites incoming references without losing the source document', async ({
  page,
}) => {
  await page.goto('/')

  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('\n[[notes/workspace.md]]')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+s')
  await expect(page.getByTestId('persistence-status')).toHaveText('已保存')

  await page.locator('[data-workspace-path="notes"] .workspace-tree__twisty').click()
  const target = page.locator('[data-workspace-path="notes/workspace.md"]')
  await target.getByRole('button', { name: 'Rename workspace.md' }).click()
  const input = page.getByRole('textbox', { name: 'Rename workspace.md' })
  await input.fill('renamed.md')
  await input.press('Enter')

  await expect(page.locator('[data-workspace-path="notes/renamed.md"]')).toBeVisible()
  await expect(page.locator('[data-workspace-path="notes/workspace.md"]')).toHaveCount(0)
  await expect(editor).toContainText('[[notes/renamed.md]]')
  await expect(page.getByTestId('active-document-path')).toHaveText('welcome.md')
})
