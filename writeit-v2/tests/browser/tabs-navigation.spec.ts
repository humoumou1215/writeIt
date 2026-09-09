import { expect, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

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
  await expect(page.getByTestId('active-document-path')).toHaveText('notes/architecture.md')
  await expect(page.locator('.cm-content')).toContainText('Architecture notes')

  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' edited')
  await expect(
    page.locator('[data-workspace-tab-path="notes/architecture.md"].workspace-tab--dirty'),
  ).toBeVisible()

  await page
    .locator('[data-workspace-tab-path="welcome.md"]')
    .click()
  await expect(page.getByTestId('active-document-path')).toHaveText('welcome.md')
  await expect(page.locator('.cm-content')).toContainText('WriteIt v2')
  await expect(
    page.locator('[data-workspace-tab-path="notes/architecture.md"].workspace-tab--dirty'),
  ).toBeVisible()

  await page.locator('.workspace-navigation > summary').click()
  await page.getByTestId('workspace-next-tab').click()
  await expect(page.getByTestId('active-document-path')).toHaveText('notes/architecture.md')
  await page.locator('.workspace-navigation > summary').click()
  await page.getByTestId('workspace-prev-tab').click()
  await expect(page.getByTestId('active-document-path')).toHaveText('welcome.md')

  // Tree order is notes/architecture.md, notes/workspace.md, welcome.md.
  await page.locator('.workspace-navigation > summary').click()
  await page.getByTestId('workspace-next-file').click()
  await expect(page.getByTestId('active-document-path')).toHaveText('notes/architecture.md')
  await expect(tabs.locator('[role="tab"]')).toHaveCount(2)

  await page.getByRole('button', { name: 'Collapse notes' }).click()
  await expect(
    page.locator('[data-workspace-path="notes/architecture.md"]'),
  ).toHaveCount(0)
  await page
    .locator('[data-workspace-path="welcome.md"] .workspace-tree__row')
    .click({ button: 'right' })
  await page.getByTestId('workspace-context-reveal').click()
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

test('switches File, Search, and Git tools without replacing the active editor projection', async ({
  page,
}) => {
  await page.goto('/')
  const editor = page.locator('.editor-host > .cm-editor')
  const content = editor.locator('.cm-content')
  await content.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' continuity')
  await editor.evaluate((element) => {
    element.setAttribute('data-continuity-probe', 'same-editor')
  })

  await page.getByTestId('workspace-tool-search').click()
  await expect(page.getByTestId('workspace-search-tool')).toBeVisible()
  await expect(content).toContainText('continuity')
  await expect(editor).toHaveAttribute('data-continuity-probe', 'same-editor')

  await page.getByTestId('workspace-tool-git').click()
  await expect(page.getByTestId('workspace-git-tool')).toBeVisible()
  await expect(page.getByTestId('workspace-git-current-document')).toContainText('welcome.md')
  await expect(content).toContainText('continuity')
  await expect(editor).toHaveAttribute('data-continuity-probe', 'same-editor')

  await page.getByTestId('workspace-tool-files').click()
  await expect(page.getByTestId('workspace-files-tool')).toBeVisible()
  await expect(content).toContainText('continuity')
})

test('double-click close uses the same dirty protection as the close button', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'writeit-v2.workspace-settings',
      JSON.stringify({ version: 1, settings: { autoSaveDelayMs: null } }),
    )
  })
  await page.addInitScript(() => {
    const decisions = [false, true]
    window.confirm = () => decisions.shift() ?? false
  })
  await page.goto('/')
  const tab = page.locator('[data-workspace-tab-path="welcome.md"]')
  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' dirty')
  await expect(tab).toHaveClass(/workspace-tab--dirty/)

  await tab.dispatchEvent('dblclick')
  await expect(tab).toBeVisible()

  await page.locator('.cm-content').click()
  await tab.dispatchEvent('dblclick')
  await expect(tab).toHaveCount(0)
})

test('auto-collapse is opt-in and collapses only after opening or focusing the editor', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByTestId('workspace-sidebar-toggle')).toHaveAttribute('aria-expanded', 'true')
  await page.getByTestId('workspace-sidebar-pin').click()
  await page.getByTestId('workspace-tool-search').click()
  await expect(page.getByTestId('workspace-sidebar-toggle')).toHaveAttribute('aria-expanded', 'true')
  await page.locator('.editor-host .cm-content').click()
  await expect(page.getByTestId('workspace-sidebar-toggle')).toHaveAttribute('aria-expanded', 'false')
  await page.getByTestId('workspace-sidebar-toggle').click()
  await expect(page.getByTestId('workspace-sidebar-toggle')).toHaveAttribute('aria-expanded', 'true')
})

test('shift-click opens an internal reference in split and both panes share DocumentStore state', async ({
  page,
}) => {
  await page.goto('/')
  const hostContent = page.locator('.editor-host > .cm-editor .cm-content').first()
  await hostContent.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n\n[[notes/workspace.md]]')

  const reference = page.locator(
    '.editor-host > .cm-editor [data-writeit-reference][data-reference-path="notes/workspace.md"]',
  )
  await expect(reference).toBeVisible()
  await reference.click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('workspace-split-pane')).toBeVisible()
  await expect(page.getByTestId('workspace-split-path')).toHaveText('notes/workspace.md')
  await expect(page.locator('.split-editor-host .cm-content')).toContainText('Workspace tree')
  await expect(page.locator('[data-workspace-tab-path="welcome.md"]'))
    .toHaveAttribute('aria-selected', 'true')

  const splitContent = page.locator('.split-editor-host .cm-content')
  await splitContent.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText(' shared')
  await reference.click()
  await expect(page.locator('[data-workspace-tab-path="notes/workspace.md"]'))
    .toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.editor-host > .cm-editor .cm-content').first())
    .toContainText('Workspace tree shared')
  await expect(splitContent).toContainText('Workspace tree shared')
})
