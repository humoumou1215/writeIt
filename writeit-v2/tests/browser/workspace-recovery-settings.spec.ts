import { expect, test } from '@playwright/test'

test('restores the last document session and persists workspace shell settings', async ({
  page,
}) => {
  await page.goto('/')

  await page.locator('[data-workspace-path="notes"]').getByRole('button', {
    name: 'Expand notes',
  }).click()
  await page
    .locator('[data-workspace-path="notes/architecture.md"] .workspace-tree__row')
    .click()
  await expect(page.getByTestId('active-document-path')).toHaveText('notes/architecture.md')

  await page.getByTestId('workspace-settings-toggle').click()
  const settings = page.getByTestId('workspace-settings-panel')
  await expect(settings).toBeVisible()
  await settings.getByTestId('settings-sidebar-width').fill('340')
  await settings.getByTestId('settings-auto-save').selectOption('manual')
  await settings.getByTestId('settings-sidebar-pinned').uncheck()
  await settings.getByTestId('settings-sidebar-collapsed').check()
  await expect(page.locator('.workspace-layout')).toHaveClass(
    /workspace-layout--sidebar-collapsed/,
  )
  await expect(page.getByTestId('workspace-tree')).toBeHidden()

  await page.reload()

  await expect(page.getByTestId('active-document-path')).toHaveText('notes/architecture.md')
  await expect(
    page.locator('[data-workspace-tab-path="welcome.md"]'),
  ).toBeVisible()
  await expect(
    page.locator('[data-workspace-tab-path="notes/architecture.md"]'),
  ).toBeVisible()
  await expect(page.locator('.workspace-layout')).toHaveClass(
    /workspace-layout--sidebar-collapsed/,
  )
  await expect(page.getByTestId('workspace-sidebar-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(page.getByTestId('workspace-tree')).toBeHidden()

  await page.getByTestId('workspace-settings-toggle').click()
  await expect(
    page.getByTestId('settings-sidebar-width'),
  ).toHaveValue('340')
  await expect(
    page.getByTestId('settings-sidebar-pinned'),
  ).not.toBeChecked()
  await expect(page.getByTestId('settings-auto-save')).toHaveValue('manual')
  await expect(
    page.getByTestId('settings-sidebar-collapsed'),
  ).toBeChecked()
  await expect(page.getByTestId('workspace-recovery-status')).toHaveText(
    'Last workspace session restored.',
  )
})
