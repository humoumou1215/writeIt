const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.keyboard.type('[[');
  await page.waitForTimeout(800);
  const html = await page.evaluate(() => {
    const menu = document.querySelector('.milkdown-slash-menu');
    return menu ? menu.innerHTML.slice(0, 500) : 'NO MENU';
  });
  console.log('菜单 HTML:', html.slice(0, 400));
  const count = await page.locator('.menu-group').count();
  const tabs = await page.locator('.tab-group li').allTextContents();
  console.log('menu-group 数量:', count, '| tab 标签:', JSON.stringify(tabs));
  await browser.close();
})();
