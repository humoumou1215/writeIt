const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 250)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  const cards = await page.evaluate(() => {
    const list = document.querySelectorAll('.ref-file-block');
    return Array.from(list).map(c => ({
      readonly: c.classList.contains('readonly'),
      header: c.querySelector('.ref-file-block-path')?.textContent,
      contentLen: c.querySelector('.ref-file-block-content')?.textContent?.length,
      contentStart: c.querySelector('.ref-file-block-content')?.textContent?.slice(0, 40),
    }));
  });
  console.log('卡片状态:', JSON.stringify(cards, null, 1));
  await browser.close();
})();
