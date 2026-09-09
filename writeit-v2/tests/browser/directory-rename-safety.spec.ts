import { expect, test } from '@playwright/test'

async function openNestedDocument(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('[data-workspace-path="notes"]')).toBeVisible()
  await page.getByRole('button', { name: 'Expand notes' }).click()
  await page.locator('[data-workspace-path="notes/architecture.md"] .workspace-tree__row').click()
  await expect(page.getByTestId('active-document-path')).toHaveText('notes/architecture.md')
}

async function recoveryValue(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('writeit-v2.workspace-recovery'))
}

test('blocks renaming a directory that contains a dirty nested Document', async ({
  page,
}) => {
  await openNestedDocument(page)
  await page.locator('.document-menu > summary').click()
  await page.getByLabel('Auto-save delay').selectOption('manual')

  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' local edit')
  await expect(page.getByTestId('persistence-status')).toHaveText('未保存')
  const contentBefore = await editor.innerText()
  const recoveryBefore = await recoveryValue(page)

  await page.getByRole('button', { name: 'Rename notes' }).click()
  const input = page.getByRole('textbox', { name: 'Rename notes' })
  await input.fill('renamed-notes')
  await input.press('Enter')

  await expect(page.getByTestId('workspace-error')).toContainText('open Document')
  await expect(page.locator('[data-workspace-path="notes"]')).toBeVisible()
  await expect(page.locator('[data-workspace-path="renamed-notes"]')).toHaveCount(0)
  await expect(page.getByTestId('active-document-path')).toHaveText('notes/architecture.md')
  await expect(editor).toHaveText(contentBefore)
  await expect(page.getByTestId('persistence-status')).toHaveText('未保存')
  expect(await recoveryValue(page)).toBe(recoveryBefore)
})

test('blocks moving a directory with a nested Document and keeps the tree usable', async ({
  page,
}) => {
  await openNestedDocument(page)

  await page.locator('ul.workspace-tree > li > .workspace-tree__row').click()
  await page.locator('.workspace-create > summary').click()
  await page.getByTestId('workspace-entry-name').fill('archive')
  await page.getByTestId('workspace-create-directory').click()
  await expect(page.locator('[data-workspace-path="archive"]')).toBeVisible()
  await page.locator('li[data-workspace-path="notes"] > .workspace-tree__row').click()
  await expect.poll(async () => JSON.parse((await recoveryValue(page))!).state.selectedWorkspacePath).toBe('notes')
  const recoveryBefore = await recoveryValue(page)

  await page.locator('li[data-workspace-path="notes"] > .workspace-tree__row').dragTo(
    page.locator('li[data-workspace-path="archive"] > .workspace-tree__row'),
  )

  await expect(page.getByTestId('workspace-error')).toContainText('open Document')
  await expect(page.locator('[data-workspace-path="notes"]')).toBeVisible()
  await expect(page.locator('[data-workspace-path="archive/notes"]')).toHaveCount(0)
  await expect(page.getByTestId('active-document-path')).toHaveText('notes/architecture.md')
  expect(await recoveryValue(page)).toBe(recoveryBefore)

  await page.getByTestId('workspace-refresh').click()
  await expect(page.locator('[data-workspace-path="notes"]')).toBeVisible()
})
