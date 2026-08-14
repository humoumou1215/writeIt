const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('/demo');
  await page.waitForTimeout(900);
  const menuState = await page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('.milkdown-slash-menu'));
    return menus.map(m => ({
      show: m.getAttribute('data-show'),
      html: m.innerHTML.slice(0, 300),
    }));
  });
  console.log('菜单:', JSON.stringify(menuState, null, 1).slice(0, 900));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  const lines = md.split('\n').filter(l => l.includes('模板') || l.includes('{{') || l.includes('版本') || l.includes('doctype'));
  console.log('插入后相关行:', JSON.stringify(lines));
  await browser.close();
})();
