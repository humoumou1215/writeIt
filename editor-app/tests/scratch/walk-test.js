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
  // 在页面里执行 walk 逻辑（用菜单的 tree）
  const r = await page.evaluate(() => {
    const s = window.__refMenuState;
    const walk = (list, dir) => {
      if (dir === '') return list;
      for (const e of list) {
        if (e.kind === 'dir' && e.path === dir) return e.children ?? [];
        if (e.kind === 'dir' && e.children) {
          const found = walk(e.children, dir);
          if (found !== null) return found;
        }
      }
      return [];
    };
    const list = walk(s.tree, '数据');
    return { dir: s.currentDir, result: Array.isArray(list) ? list.map(x => x.name) : list };
  });
  console.log('walk 数据:', JSON.stringify(r));
  await browser.close();
})();
