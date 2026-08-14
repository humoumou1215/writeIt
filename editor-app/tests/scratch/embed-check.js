const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 160)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('![[待办清单');
  await page.waitForTimeout(900);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.ref-file-block'));
    return cards.map(c => ({
      path: c.querySelector('.ref-file-block-path')?.textContent,
      readonly: c.classList.contains('readonly'),
      contentLen: c.querySelector('.ref-file-block-content')?.textContent?.length ?? 0,
      content: (c.querySelector('.ref-file-block-content')?.textContent ?? '').slice(0, 40),
    }));
  });
  console.log('插入后卡片:', JSON.stringify(st));
  await browser.close();
})();
