const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '待办清单.md' }).click();
  await page.waitForTimeout(2500);
  const html = await page.evaluate(() => {
    const md = document.querySelector('.milkdown .ProseMirror');
    const li = md.querySelector('li');
    return li ? li.outerHTML.slice(0, 400) : 'no li';
  });
  console.log('li HTML:', html);
  await browser.close();
})();
