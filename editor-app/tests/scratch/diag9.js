const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 快速复刻：打开设置 → 切快捷键页 → 录制 → 关闭 → 重开 → 关闭
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
  // 直接测：Alt+Shift+P 是否还能打开设置
  await page.keyboard.press('Alt+Shift+P');
  await page.waitForTimeout(500);
  console.log('Alt+Shift+P 打开设置:', await page.isVisible('.settings-modal'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Ctrl+B
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  console.log('Ctrl+B 收纳:', await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed')));
  // 检查 window 上是否有多个 keydown 监听或异常
  const probe = await page.evaluate(() => {
    const app = document.querySelector('.app');
    return { hasApp: !!app, bodyFocused: document.activeElement?.tagName };
  });
  console.log(JSON.stringify(probe));
  await browser.close();
})();
