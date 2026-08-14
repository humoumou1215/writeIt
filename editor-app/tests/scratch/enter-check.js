const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(150); }
  await page.waitForTimeout(300);
  const st1 = await page.evaluate(() => ({ md: window.__editorGetMarkdown().slice(-50), menus: Array.from(document.querySelectorAll('[data-ref-menu]')).map(m => m.getAttribute('data-show')) }));
  console.log('3×Enter 后:', JSON.stringify(st1));
  await page.keyboard.type('X');
  await page.waitForTimeout(500);
  const st2 = await page.evaluate(() => ({ md: window.__editorGetMarkdown().slice(-50), menus: Array.from(document.querySelectorAll('[data-ref-menu]')).map(m => m.getAttribute('data-show')) }));
  console.log('输入 X 后:', JSON.stringify(st2));
  await browser.close();
})();
