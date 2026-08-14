const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
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
  const st1 = await page.evaluate(() => {
    const collapsed = document.querySelector('.content-col')?.classList.contains('collapsed');
    return { collapsed, tabs: Array.from(document.querySelectorAll('.tab-bar .tab')).map(t => t.textContent.trim()) };
  });
  console.log('创建后:', JSON.stringify(st1));
  // 重新展开
  if (st1.collapsed) { await page.locator('.icon-col .icon-btn').first().click(); await page.waitForTimeout(500); }
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(500);
  const names1 = await page.evaluate(() => Array.from(document.querySelectorAll('.tree .name')).map(n => n.textContent.trim()));
  console.log('展开笔记后（未手动刷新）:', JSON.stringify(names1.slice(0, 10)));
  // 手动刷新
  await page.locator('.sidebar-actions .mini', { hasText: '⟳' }).click();
  await page.waitForTimeout(800);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  const names2 = await page.evaluate(() => Array.from(document.querySelectorAll('.tree .name')).map(n => n.textContent.trim()));
  console.log('手动刷新后:', JSON.stringify(names2.slice(0, 10)));
  await browser.close();
})();
