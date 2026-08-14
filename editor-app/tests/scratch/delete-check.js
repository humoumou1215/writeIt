const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: 'Mermaid 图表集.md' }).click({ button: 'right' });
  await page.waitForTimeout(400);
  console.log('菜单出现:', await page.locator('.menu').count());
  await page.locator('.menu-item.danger', { hasText: '删除' }).click();
  await page.waitForTimeout(500);
  console.log('确认框出现:', await page.locator('.modal').count());
  await page.locator('.modal .danger').click();
  await page.waitForTimeout(1500);
  const inTree = await page.locator('.tree .name', { hasText: 'Mermaid 图表集.md' }).count();
  const ls = await page.evaluate(() => {
    const raw = localStorage.getItem('milkdown-note-mock-fs-v2');
    if (!raw) return null;
    return Object.keys(JSON.parse(raw).files);
  });
  console.log('删除后树中还存在:', inTree > 0, '| localStorage files:', JSON.stringify(ls));
  await browser.close();
})();
