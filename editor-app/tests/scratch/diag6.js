const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.icon-col .icon-btn').nth(1).click();
  await page.waitForTimeout(500);
  await page.locator('.tab-btn', { hasText: '快捷键' }).click();
  await page.waitForTimeout(400);
  await page.locator('.shortcut-row', { hasText: '打开设置' }).locator('.keybtn').click();
  await page.waitForTimeout(400);
  // 手动聚焦试试
  await page.evaluate(() => { const el = document.querySelector('.keycapture'); if (el) el.focus(); });
  await page.waitForTimeout(200);
  const focused = await page.evaluate(() => document.activeElement?.className);
  console.log('手动 focus 后:', focused);
  await page.keyboard.press('Alt+Shift+P');
  await page.waitForTimeout(400);
  const btnText = await page.locator('.shortcut-row', { hasText: '打开设置' }).locator('.keybtn').textContent().catch(() => 'NO BTN');
  console.log('按键后 keybtn:', JSON.stringify(btnText));
  await browser.close();
})();
