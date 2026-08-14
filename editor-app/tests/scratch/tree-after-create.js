const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 直接开侧边栏（新打开无标签，侧边栏默认展开）
  await page.locator('.tree').first().click({ position: { x: 12, y: 12 }, button: 'right' });
  await page.waitForTimeout(400);
  const ctxItems = await page.evaluate(() => Array.from(document.querySelectorAll('.menu-item')).map(b => b.textContent.trim()));
  console.log('右键菜单:', JSON.stringify(ctxItems));
  await page.locator('.menu-item', { hasText: '基于模板新建' }).click();
  await page.waitForTimeout(600);
  await page.locator('.tpl-item', { hasText: 'demo' }).first().click();
  await page.waitForTimeout(400);
  await page.keyboard.type('测试模板文件');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  // 重新展开侧边栏
  const collapsed = await page.evaluate(() => document.querySelector('.content-col')?.classList.contains('collapsed'));
  if (collapsed) { await page.locator('.icon-col .icon-btn').first().click(); await page.waitForTimeout(600); }
  const treeNames = await page.evaluate(() => Array.from(document.querySelectorAll('.tree .name')).map(n => n.textContent.trim()).slice(0, 12));
  console.log('树内容:', JSON.stringify(treeNames));
  const editing = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return Object.keys(s.files || {}).filter(k => k.includes('测试'));
  });
  console.log('mock fs 文件:', JSON.stringify(editing));
  await browser.close();
})();
