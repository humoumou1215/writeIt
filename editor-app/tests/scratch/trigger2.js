const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (t.includes('[ref]')) console.log(t.slice(0, 160)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log('--- freshPara 后输入 ![[待办 ---');
  await page.keyboard.type('![[待办');
  await page.waitForTimeout(600);
  console.log('菜单组数:', await page.locator('[data-ref-menu] .menu-group').count());
  await browser.close();
})();
