const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 160)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(80); }
  await page.waitForTimeout(400);
  await page.keyboard.type('@');
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    const md = window.__editorGetMarkdown();
    return {
      hasFocus: pm === document.activeElement,
      docTail: JSON.stringify(md.slice(-30)),
      menus: Array.from(document.querySelectorAll('[data-ref-menu]')).map(m => m.getAttribute('data-show')),
    };
  });
  console.log('状态:', JSON.stringify(st));
  await browser.close();
})();
