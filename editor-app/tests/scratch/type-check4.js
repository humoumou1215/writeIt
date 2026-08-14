const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: 'README.md' }).click();
  await page.waitForTimeout(4000);
  await page.keyboard.type('K');
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({
    text: document.querySelector('.ProseMirror').textContent.slice(-8),
    menus: Array.from(document.querySelectorAll('[data-ref-menu]')).map(m => m.getAttribute('data-show')),
  }));
  console.log('README 打 K 后:', JSON.stringify(st));
  await browser.close();
})();
