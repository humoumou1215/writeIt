const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type().toUpperCase()+':', m.text().slice(0, 300)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  const treeText = await page.evaluate(() => document.querySelector('.tree')?.textContent);
  console.log('TREE TEXT:', JSON.stringify(treeText?.slice(0, 200)));
  await page.screenshot({ path: '/media/writeIt/editor-app/demo-shots/diag.png' });
  await browser.close();
})();
