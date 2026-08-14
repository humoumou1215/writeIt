const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('@');
  await page.waitForTimeout(900);
  const st = await page.evaluate(() => {
    const s = window.__refMenuState;
    const flat = (list) => (Array.isArray(list) ? list.map(n => n.path + (n.kind === 'dir' ? '/' : '')) : 'not-array:' + typeof list);
    return { tree: s?.tree ? flat(s.tree) : 'null', currentDir: s?.currentDir, q: s?.query };
  });
  console.log('菜单 tree:', JSON.stringify(st));
  await browser.close();
})();
