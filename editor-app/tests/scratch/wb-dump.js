const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { const t = m.text(); if (t.includes('[writeback]')) console.log('LOG:', t.slice(0, 120)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.__editorGoBlockEnd && window.__editorGoBlockEnd('待办清单'));
  await page.keyboard.press('Enter');
  await page.keyboard.type('写回测试新条目');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2000);
  const dump = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return Object.keys(fs.files).filter(k => k.includes('待办清单')).map(k => k + ' => ' + JSON.stringify(fs.files[k] || ''));
  });
  console.log('FS KEYS:', JSON.stringify(dump));
  await browser.close();
})();
