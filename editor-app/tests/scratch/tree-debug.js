const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 160)); });
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
  await page.waitForTimeout(3000);
  const st = await page.evaluate(async () => {
    const { state } = await import('/src/state/store.ts');
    return {
      treeVersion: state.treeVersion,
      tabs: state.tabs.map(t => t.path),
      active: state.activeTabId,
      editing: state.editing,
      treeRoot: state.tree.map(n => n.name),
      nianJi: state.tree.find(n => n.name === '笔记')?.children?.map(c => c.name),
    };
  });
  console.log(JSON.stringify(st, null, 1));
  await browser.close();
})();
