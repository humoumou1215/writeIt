const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  const cards = await page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('.ref-file-block'));
    return list.map(c => ({
      readonly: c.classList.contains('readonly'),
      header: c.querySelector('.ref-file-block-path')?.textContent,
      len: c.querySelector('.ref-file-block-content')?.textContent?.length ?? 0,
      hasMilk: (c.querySelector('.ref-file-block-content')?.textContent ?? '').includes('🥛'),
    }));
  });
  console.log(JSON.stringify(cards, null, 1));
  await browser.close();
})();
