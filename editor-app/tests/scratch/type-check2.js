const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('['+m.type()+']', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.keyboard.type('Z');
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => {
    const ed = window.__editorDebug();
    return { text: document.querySelector('.ProseMirror').textContent.slice(-6) };
  });
  console.log('打 Z 后:', JSON.stringify(st));
  await browser.close();
})();
