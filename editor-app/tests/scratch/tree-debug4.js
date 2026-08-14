const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree').first().click({ position: { x: 12, y: 12 }, button: 'right' });
  await page.waitForTimeout(400);
  await page.locator('.menu-item', { hasText: '基于模板新建' }).click();
  await page.waitForTimeout(600);
  await page.locator('.tpl-item', { hasText: 'demo' }).first().click();
  await page.waitForTimeout(400);
  await page.keyboard.type('测试模板文件');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[class*="tab"]')).filter(el => el.textContent && el.textContent.includes('测试')).map(el => el.className);
    const panes = document.querySelectorAll('.editor-pane').length;
    const md = window.__editorGetMarkdown ? window.__editorGetMarkdown() : null;
    return { tabEls: tabs.slice(0,3), panes, mdHead: md ? md.slice(0, 30) : null };
  });
  console.log('创建后:', JSON.stringify(info));
  await browser.close();
})();
