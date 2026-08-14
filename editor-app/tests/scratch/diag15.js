const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 复刻失败流程（不按 Ctrl+B）
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
  await page.waitForTimeout(400);
  const kdA = await page.evaluate(() => window.__kd || 0);
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  const kdB = await page.evaluate(() => window.__kd || 0);
  console.log('Ctrl+B 前后 onKeydown 调用数:', kdA, '→', kdB);
  console.log('collapsed:', await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed')));
  // 焦点在哪个元素？
  console.log('焦点:', await page.evaluate(() => document.activeElement?.tagName + '.' + (document.activeElement?.className || '')));
  await browser.close();
})();
