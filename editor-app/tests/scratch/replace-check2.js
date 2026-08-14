const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (t.includes('[M3]')) console.log('LOG:', t.slice(0, 150)); });
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
  const collapsed = await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'));
  if (collapsed) { await page.locator('.icon-col .icon-btn').first().click(); await page.waitForTimeout(400); }
  await page.locator('.tree .name', { hasText: 'Mermaid 图表集.md' }).click({ button: 'right' });
  await page.waitForTimeout(400);
  await page.locator('.menu-item.danger', { hasText: '删除' }).click();
  await page.waitForTimeout(400);
  await page.locator('.modal .danger').click();
  await page.waitForTimeout(1500);
  // 点击断链 + 替换
  await page.locator('a.ref-file.ref-broken').first().click();
  await page.waitForTimeout(800);
  await page.keyboard.type('待办');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('=== 完整 md 尾部 ===');
  console.log(md.slice(-400));
  await browser.close();
})();
