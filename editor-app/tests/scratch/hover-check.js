const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.sidebar-actions .mini', { hasText: '＋文件' }).click();
  await page.waitForTimeout(300);
  await page.locator('.tree .rename-input').fill('悬停检查.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('![[待办');
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const menu = document.querySelector('[data-ref-menu]');
    if (!menu) return { err: 'no menu' };
    const groups = Array.from(menu.querySelectorAll('.menu-group')).map(g => ({
      h6: g.querySelector('h6')?.textContent,
      hovered: !!g.querySelector('li.hover'),
      items: g.querySelectorAll('li').length,
    }));
    const st = { mode: '?' };
    return { groups };
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})();
