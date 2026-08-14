const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => console.log('['+m.type()+']', m.text().slice(0, 160)));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree').first().click({ position: { x: 12, y: 12 }, button: 'right' });
  await page.waitForTimeout(400);
  await page.locator('.menu-item', { hasText: '基于模板新建' }).click();
  await page.waitForTimeout(600);
  await page.locator('.tpl-item', { hasText: 'demo' }).first().click();
  await page.waitForTimeout(400);
  await page.keyboard.type('测试模板文件');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  // 手动刷新树
  await page.locator('.sidebar-actions .mini', { hasText: '⟳' }).click();
  await page.waitForTimeout(800);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(500);
  const names = await page.evaluate(() => Array.from(document.querySelectorAll('.tree .name')).map(n => n.textContent.trim()));
  console.log('手动刷新后树:', JSON.stringify(names.slice(0, 10)));
  await browser.close();
})();
