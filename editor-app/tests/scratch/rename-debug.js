const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error') console.log('ERR:', t.slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  const mdBefore = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('重命名前含 [[README.md]]:', mdBefore.includes('[[README.md]]'));
  // 重命名 README.md → README-改.md（确保侧边栏展开）
  const collapsed = await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'));
  if (collapsed) { await page.locator('.icon-col .icon-btn').first().click(); await page.waitForTimeout(400); }
  await page.locator('.tree .name', { hasText: 'README.md' }).click({ button: 'right' });
  await page.waitForTimeout(400);
  await page.locator('.menu-item', { hasText: '重命名' }).click();
  await page.waitForTimeout(400);
  await page.locator('.tree .rename-input').fill('README-改.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  const mdAfter = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('重命名后含 [[README-改]]:', mdAfter.includes('[[README-改]]'));
  console.log('重命名后 md 片段:', mdAfter.slice(0, 150).replace(/\n/g, ' | '));
  // 改回
  await page.locator('.tree .name', { hasText: 'README-改.md' }).click({ button: 'right' });
  await page.waitForTimeout(400);
  await page.locator('.menu-item', { hasText: '重命名' }).click();
  await page.waitForTimeout(400);
  await page.locator('.tree .rename-input').fill('README.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await browser.close();
})();
