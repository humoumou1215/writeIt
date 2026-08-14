const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 捕获阶段监听器，探测按键是否到达 window
  await page.evaluate(() => {
    window.__keys = [];
    window.addEventListener('keydown', (e) => {
      window.__keys.push(e.key + '|ctrl:' + e.ctrlKey + '|alt:' + e.altKey + '|shift:' + e.shiftKey);
    }, true);
  });
  // 文件操作
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
  await page.evaluate(() => { window.__keys = []; });
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  const keys = await page.evaluate(() => window.__keys);
  console.log('Ctrl+B 捕获到的按键:', JSON.stringify(keys));
  console.log('collapsed:', await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed')));
  await browser.close();
})();
