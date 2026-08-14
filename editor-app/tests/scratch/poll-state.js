const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.text().includes('[ref]')) console.log(m.text().slice(0, 100)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.sidebar-actions .mini', { hasText: '＋文件' }).click();
  await page.waitForTimeout(300);
  await page.locator('.tree .rename-input').fill('轮询.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('![[待办');
  // 轮询状态
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(200);
    const st = await page.evaluate(async () => {
      const m = await import('/src/editor/ref/menu/index.ts');
      return { v: m.refMenuState.visible, mode: m.refMenuState.mode };
    });
    console.log('poll', i, JSON.stringify(st));
  }
  await browser.close();
})();
