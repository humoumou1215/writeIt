const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: 'README.md' }).click();
  await page.waitForTimeout(4000);
  await page.keyboard.type('@');
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('[data-ref-menu]'));
    return {
      menus: menus.map(m => m.getAttribute('data-show')),
      docHead: window.__editorGetMarkdown().slice(0, 40),
    };
  });
  console.log('文档开头打 @:', JSON.stringify(st));
  await browser.close();
})();
