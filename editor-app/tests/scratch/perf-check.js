const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { if (m.text().includes('[menu-perf]')) console.log('LOG:', m.text().slice(0, 160)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  // 首次 @ 打开（含 readTree）
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('@');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // 第二次 @（树已缓存）
  await page.keyboard.type('@');
  await page.waitForTimeout(1200);
  // 过滤输入（每键耗时）
  await page.keyboard.type('笔记/会');
  await page.waitForTimeout(600);
  const perf = await page.evaluate(() => window.__refMenuPerf);
  console.log('perf 记录:', JSON.stringify(perf, null, 1));
  await browser.close();
})();
