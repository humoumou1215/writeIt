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
  const row = page.locator('.shortcut-row', { hasText: '打开设置' });
  await row.locator('.keybtn').click();
  await page.waitForTimeout(500);
  // 检查输入框状态
  const captureVisible = await page.locator('.keycapture').count();
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.className || ''));
  console.log('capture 输入框存在:', captureVisible, '| 当前聚焦:', focusedTag);
  await page.keyboard.press('Alt+Shift+P');
  await page.waitForTimeout(500);
  const btnText = await row.locator('.keybtn').textContent().catch(() => 'NO BTN');
  const captureStill = await page.locator('.keycapture').count();
  console.log('按键后 keybtn 文本:', JSON.stringify(btnText), '| capture 仍在:', captureStill);
  // 看 localStorage 里的 shortcuts
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('milkdown-note-settings-v1') || '{}').shortcuts);
  console.log('shortcuts 已保存:', JSON.stringify(saved));
  await browser.close();
})();
