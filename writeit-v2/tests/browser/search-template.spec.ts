import { expect, test } from '@playwright/test'

test('searches, jumps to a precise occurrence, and replaces it', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('workspace-tool-search').click()
  await page.getByTestId('search-query').fill('DocumentStore')
  await page.getByTestId('search-submit').click()
  await expect(page.getByTestId('search-panel')).toContainText('welcome.md')
  const match = page.locator('[data-search-match^="welcome.md:"]').first()
  await expect(match).toBeVisible()
  await match.click()
  await page.getByTestId('search-replacement').fill('Store')
  await page.getByTestId('search-replace-one').click()
  await expect(page.locator('.cm-content')).toContainText('Store')
})

test('creates and inserts a template through the workspace panel', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('workspace-tool-search').click()
  await expect(page.getByTestId('template-select')).toHaveValue('meeting')
  await page.getByTestId('template-name').fill('meeting-copy.md')
  await page.getByTestId('template-create').click()
  await expect(page.locator('[data-workspace-tab-path="meeting-copy.md"]')).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('Date: {{date}}')
})
