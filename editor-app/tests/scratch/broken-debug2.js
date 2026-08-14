const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (t.includes('[M3]')) console.log(t.slice(0, 140)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[Mermaid');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  console.log('已插入引用');
  // 删除 Mermaid
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: 'Mermaid 图表集.md' }).click({ button: 'right' });
  await page.waitForTimeout(400);
  await page.locator('.menu-item.danger', { hasText: '删除' }).click();
  await page.waitForTimeout(400);
  await page.locator('.modal .danger').click();
  await page.waitForTimeout(2000);
  const info = await page.evaluate(async () => {
    const m = await import('/src/editor/ref/app-plugin.ts');
    const exists = await m.refPathExists('Mermaid 图表集');
    return {
      exists,
      brokenDom: document.querySelectorAll('.ref-broken').length,
      chipPaths: Array.from(document.querySelectorAll('a.ref-file')).map(a => a.getAttribute('data-path')),
    };
  });
  console.log('检查:', JSON.stringify(info));
  await browser.close();
})();
