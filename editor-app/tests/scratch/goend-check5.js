const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || t.includes('ref]')) console.log('['+m.type()+']', t.slice(0, 130)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(500);
  await page.keyboard.type('[[');
  await page.waitForTimeout(700);
  console.log('[[ 菜单打开:', await page.locator('[data-ref-menu] .menu-group li').count() > 0);
  await browser.close();
})();
