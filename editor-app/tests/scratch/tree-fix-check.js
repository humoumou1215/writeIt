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
  await page.waitForTimeout(2500);
  // 展开侧边栏 + 展开 笔记
  const collapsed = await page.evaluate(() => document.querySelector('.content-col')?.classList.contains('collapsed'));
  if (collapsed) { await page.locator('.icon-col .icon-btn').first().click(); await page.waitForTimeout(500); }
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(600);
  const treeNames = await page.evaluate(() => Array.from(document.querySelectorAll('.tree .name')).map(n => n.textContent.trim()).slice(0, 15));
  console.log('树:', JSON.stringify(treeNames));
  // 看 editing 状态 / 错误
  const ed = await page.evaluate(() => JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files);
  console.log('测试文件内容开头:', JSON.stringify((ed['笔记/测试模板文件'] || '').slice(0, 40)));
  await browser.close();
})();
