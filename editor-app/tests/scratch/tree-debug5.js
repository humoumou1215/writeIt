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
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => {
    const collapsed = document.querySelector('.content-col')?.classList.contains('collapsed');
    const fsData = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    const files = Object.keys(fsData.files || {}).filter(k => k.includes('测试'));
    return { collapsed, files, treeNames: Array.from(document.querySelectorAll('.tree .name')).map(n => n.textContent.trim()).slice(0, 8) };
  });
  console.log('创建后:', JSON.stringify(info));
  // 展开侧边栏 + 笔记
  if (info.collapsed) { await page.locator('.icon-col .icon-btn').first().click(); await page.waitForTimeout(500); }
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(500);
  const tree2 = await page.evaluate(() => Array.from(document.querySelectorAll('.tree .name')).map(n => n.textContent.trim()));
  console.log('展开后树:', JSON.stringify(tree2.slice(0, 8)));
  await browser.close();
})();
