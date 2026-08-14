const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 只做文件操作 + 主题切换，不做设置弹窗
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '会议记录.md' }).click();
  await page.waitForTimeout(2500);
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(400);
  await page.keyboard.press('End');
  await page.keyboard.type(' xx');
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(800);
  await page.locator('.icon-col .icon-btn').nth(1).click();
  await page.waitForTimeout(500);
  await page.selectOption('.settings-modal select', 'nord-dark');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Ctrl+B
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  console.log('A) 文件操作+主题后 Ctrl+B:', await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed')));
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(300);
  // 现在再做设置录制流程
  await page.locator('.icon-col .icon-btn').nth(1).click();
  await page.waitForTimeout(500);
  await page.locator('.tab-btn', { hasText: '快捷键' }).click();
  await page.waitForTimeout(300);
  await page.locator('.shortcut-row', { hasText: '打开设置' }).locator('.keybtn').click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Alt+Shift+P');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  console.log('B) 录制后 Ctrl+B:', await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed')));
  await browser.close();
})();
