const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 展开 template → demo
  await page.locator('.tree .node', { hasText: 'template' }).first().click();
  await page.waitForTimeout(500);
  await page.locator('.tree .node', { hasText: 'demo' }).first().click();
  await page.waitForTimeout(600);
  const names = await page.evaluate(() => Array.from(document.querySelectorAll('.tree .name')).map(n => n.textContent.trim()));
  console.log('template/demo 子项:', JSON.stringify(names));
  const showAll = await page.evaluate(() => JSON.parse(localStorage.getItem('milkdown-note-settings-v1') || '{}').showAllFiles);
  console.log('showAllFiles:', showAll);
  await browser.close();
})();
