const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 全新空文件
  await page.locator('.sidebar-actions .mini', { hasText: '＋文件' }).click();
  await page.waitForTimeout(300);
  await page.locator('.tree .rename-input').fill('空文件测试.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  console.log('--- 空文件光标位置，直接输入 @ ---');
  await page.keyboard.type('@');
  await page.waitForTimeout(600);
  console.log('菜单组数:', await page.locator('[data-ref-menu] .menu-group').count());
  const caret = await page.evaluate(() => {
    const sel = window.getSelection();
    return sel ? sel.anchorOffset : -1;
  });
  console.log('输入后 selection:', caret);
  await browser.close();
})();
