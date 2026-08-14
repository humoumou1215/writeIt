const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/周报.md'] = 'doctype:demo\n\n# 周报\n\n你好\n\n## 版本\n\nv0.2.1\n\n## 待办\n\n- [x] a\n- [ ] b\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(6000);
  const st = await page.evaluate(() => {
    return {
      drawer: document.querySelector('.annotation-drawer') ? 'yes' : 'no',
      drawerOpen: document.querySelector('.annotation-drawer.open') ? 'open' : 'closed',
      headHTML: document.querySelector('.annotation-drawer-head')?.innerHTML ?? 'NO-HEAD',
      cards: document.querySelectorAll('.ad-card').length,
      adCounts: document.querySelector('.ad-counts')?.textContent ?? 'NO',
    };
  });
  console.log('STATE:', JSON.stringify(st));
  await browser.close();
})();
