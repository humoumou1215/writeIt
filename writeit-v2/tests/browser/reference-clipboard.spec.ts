import { expect, test } from '@playwright/test'

async function moveCaretToEnd(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
}

async function dispatchReferencePaste(
  page: import('@playwright/test').Page,
  payload: string,
): Promise<void> {
  await page.evaluate((json) => {
    const data = new DataTransfer()
    data.setData('application/x-writeit-node', json)
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    })
    document.querySelector('.cm-content')?.dispatchEvent(event)
  }, payload)
}

test('workspace copy pastes links, alternate embed modes, directories, and file URLs', async ({
  page,
}) => {
  await page.goto('/')
  const editor = page.locator('.cm-content')
  await expect(editor).toBeVisible()

  await page.getByRole('button', { name: 'Expand notes' }).click()
  await page
    .locator('[data-workspace-path="notes/workspace.md"] .workspace-tree__row')
    .click({ button: 'right' })
  const fileCopy = page.getByTestId('workspace-context-copy')
  await expect(fileCopy).toBeVisible()
  await fileCopy.click()
  await moveCaretToEnd(page)
  await dispatchReferencePaste(
    page,
    JSON.stringify([{ kind: 'file', path: 'notes/workspace.md' }]),
  )
  await expect(editor).toContainText('[[notes/workspace.md]]')

  await page.locator('.cm-content').click({ button: 'right' })
  const menu = page.locator('[data-reference-clipboard-menu]')
  await expect(menu).toBeVisible()
  await menu.locator('[data-reference-paste-mode="embed-readonly"]').click()
  await expect(editor).toContainText('![[notes/workspace.md|ro]]')

  await page
    .locator('li[data-workspace-path="notes"] > .workspace-tree__row')
    .click({ button: 'right' })
  const directoryCopy = page.getByTestId('workspace-context-copy')
  await expect(directoryCopy).toBeVisible()
  await directoryCopy.click()
  await moveCaretToEnd(page)
  await dispatchReferencePaste(
    page,
    JSON.stringify([{ kind: 'directory', path: 'notes' }]),
  )
  await expect(editor).toContainText('notes')

  await moveCaretToEnd(page)
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('text/uri-list', 'file:///outside/data/original.txt')
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    })
    document.querySelector('.cm-content')?.dispatchEvent(event)
  })
  await expect(editor).toContainText('[[original.txt]]')
})
