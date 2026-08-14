const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (t.includes('[M3]')) console.log(t.slice(0, 140)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  // 插入引用 Mermaid
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[Mermaid');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  // 删除 Mermaid
  const collapsed = await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'));
  if (collapsed) { await page.locator('.icon-col .icon-btn').first().click(); await page.waitForTimeout(400); }
  await page.locator('.tree .name', { hasText: 'Mermaid 图表集.md' }).click({ button: 'right' });
  await page.waitForTimeout(400);
  await page.locator('.menu-item.danger', { hasText: '删除' }).click();
  await page.waitForTimeout(400);
  await page.locator('.modal .danger').click();
  await page.waitForTimeout(1500);
  console.log('断链数量:', await page.locator('a.ref-file.ref-broken').count());
  // 点击断链
  await page.locator('a.ref-file.ref-broken').first().click();
  await page.waitForTimeout(800);
  console.log('替换菜单打开:', await page.locator('[data-ref-menu] .menu-group li').count() > 0);
  await page.keyboard.type('待办');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('替换后含待办:', md.includes('[[笔记/待办清单]]'), '| 断链数:', await page.locator('a.ref-file.ref-broken').count());
  await browser.close();
})();
