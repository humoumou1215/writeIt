import { expect, test } from '@playwright/test'

test('shortcut settings display, record, reject conflicts, persist, and reset bindings', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByTestId('workspace-settings-toggle').click()

  const settings = page.getByTestId('shortcut-settings')
  await expect(settings).toBeVisible()
  await expect(
    settings.locator('[data-shortcut-command="editor.table.add-row"]'),
  ).toContainText('Add table row')
  await expect(
    settings.locator('[data-shortcut-command="editor.table.add-row"] [data-testid="shortcut-current"]'),
  ).toHaveText('Shift+Enter')

  const saveRow = settings.locator('[data-shortcut-command="document.save"]')
  await expect(saveRow.locator('[data-testid="shortcut-current"]')).toHaveText(
    'Mod+S',
  )

  await saveRow.locator('[data-testid="shortcut-record"]').click()
  await page.keyboard.press('Control+E')
  await expect(page.getByTestId('shortcut-error')).toContainText(
    'already assigned',
  )
  await expect(saveRow.locator('[data-testid="shortcut-current"]')).toHaveText(
    'Mod+S',
  )

  await saveRow.locator('[data-testid="shortcut-record"]').click()
  await page.keyboard.press('Control+Shift+S')
  await expect(saveRow.locator('[data-testid="shortcut-current"]')).toHaveText(
    'Ctrl+Shift+S',
  )

  await page.reload()
  await page.getByTestId('workspace-settings-toggle').click()
  const reloadedSaveRow = page
    .getByTestId('shortcut-settings')
    .locator('[data-shortcut-command="document.save"]')
  await expect(
    reloadedSaveRow.locator('[data-testid="shortcut-current"]'),
  ).toHaveText('Ctrl+Shift+S')

  await reloadedSaveRow.locator('[data-testid="shortcut-reset"]').click()
  await expect(
    reloadedSaveRow.locator('[data-testid="shortcut-current"]'),
  ).toHaveText('Mod+S')

  await reloadedSaveRow.locator('[data-testid="shortcut-record"]').click()
  await page.keyboard.press('Control+Shift+S')
  await expect(
    reloadedSaveRow.locator('[data-testid="shortcut-current"]'),
  ).toHaveText('Ctrl+Shift+S')
  await page.getByTestId('shortcut-reset-all').click()
  await expect(
    reloadedSaveRow.locator('[data-testid="shortcut-current"]'),
  ).toHaveText('Mod+S')
})
