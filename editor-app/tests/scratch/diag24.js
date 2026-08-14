const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '会议记录.md' }).click();
  await page.waitForTimeout(2000);
  const h1a = await page.locator('.milkdown h1').first().textContent();
  console.log('当前文件 h1:', h1a.trim());
  // 复刻 e2e 的聚焦状态（前面点击过图标按钮）
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForTimeout(2000);
  const h1b = await page.locator('.milkdown h1').first().textContent().catch(() => 'NO H1');
  console.log('Alt+↓ 后 h1:', h1b.trim());
  const tabs = await page.locator('.tab-name').allTextContents();
  console.log('当前标签:', JSON.stringify(tabs));
  const shortcuts = await page.evaluate(async () => (await import('/src/state/settings.ts')).settings.shortcuts);
  console.log('nextFile 快捷键:', shortcuts.nextFile);
  await browser.close();
})();
