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

async function dispatchTextPaste(
  page: import('@playwright/test').Page,
  text: string,
): Promise<void> {
  await page.evaluate((value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    })
    const target = document.querySelector('.cm-content')
    if (!target) throw new Error('CM6 content is missing')
    target.dispatchEvent(event)
  }, text)
}

async function dispatchEmptyPaste(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    })
    const target = document.querySelector('.cm-content')
    if (!target) throw new Error('CM6 content is missing')
    target.dispatchEvent(event)
  })
}

async function copyWorkspaceFile(page: import('@playwright/test').Page): Promise<void> {
  await page
    .locator('[data-workspace-path="notes/workspace.md"] .workspace-tree__row')
    .click({ button: 'right' })
  await page.getByTestId('workspace-context-copy').click()
  await expect(page.getByTestId('reference-clipboard-status')).toContainText(
    'Copied notes/workspace.md',
  )
}

test('expires stale fallback after external plain-text clipboard change', async ({
  page,
}) => {
  await page.goto('/')
  const editor = page.locator('.cm-content')
  await expect(editor).toBeVisible()
  await page.getByRole('button', { name: 'Expand notes' }).click()

  await copyWorkspaceFile(page)
  await moveCaretToEnd(page)
  await dispatchEmptyPaste(page)
  await expect(editor).not.toContainText('[[notes/workspace.md]]')

  await copyWorkspaceFile(page)
  await moveCaretToEnd(page)
  await dispatchTextPaste(page, 'notes/workspace.md')
  await expect(editor).toContainText('[[notes/workspace.md]]')

  // Deliberately do not dispatch a copy event: native external applications do
  // not have to notify the page. The changed text must invalidate the fallback.
  await dispatchTextPaste(page, 'ordinary external text')
  await expect(editor).toContainText('ordinary external text')
  const source = await editor.textContent()
  expect(source?.match(/\[\[notes\/workspace\.md\]\]/gu)).toHaveLength(1)
})

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
  // The context-menu mode path must use a current clipboard read, not an
  // unverified local store. Provide the current plain payload explicitly so
  // this browser regression remains independent of permission prompts.
  await page.evaluate(() => {
    const clipboard = navigator.clipboard as Clipboard & {
      read?: () => Promise<readonly ClipboardItem[]>
      readText?: () => Promise<string>
    }
    Object.defineProperty(clipboard, 'read', {
      configurable: true,
      value: async () => [],
    })
    Object.defineProperty(clipboard, 'readText', {
      configurable: true,
      value: async () => 'notes/workspace.md',
    })
  })

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
