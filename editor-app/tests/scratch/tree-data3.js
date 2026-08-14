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
    const show = (n, d) => {
      const kids = Array.isArray(n.children) ? n.children.map(c => c.name) : n.children;
      return `${'  '.repeat(d)}${n.name} [${n.kind}] children=${JSON.stringify(kids)}`;
    };
    const out = [];
    const walk = (list, d) => { for (const n of list) { out.push(show(n, d)); if (Array.isArray(n.children)) walk(n.children, d + 1); } };
    if (Array.isArray(s?.tree)) walk(s.tree, 0);
    return out;
  });
  console.log('菜单 tree 结构:', JSON.stringify(st, null, 1));
  await browser.close();
})();
