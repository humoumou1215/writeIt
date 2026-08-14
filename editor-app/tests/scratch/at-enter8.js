const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: 'README.md' }).click();
  await page.waitForTimeout(4000);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(120); }
  await page.keyboard.type('@');
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    const atIdx = md.indexOf('@');
    return {
      menus: Array.from(document.querySelectorAll('[data-ref-menu]')).map(m => m.getAttribute('data-show')),
      atIdx,
      around: md.slice(Math.max(0, atIdx - 20), atIdx + 20).replace(/\n/g, '⏎'),
    };
  });
  console.log('3×Enter 后打 @:', JSON.stringify(st));
  await browser.close();
})();
