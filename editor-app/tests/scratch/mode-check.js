const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('![[会议');
  await page.waitForTimeout(900);
  const st1 = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    return { show: el?.getAttribute('data-show'), mode: el?.querySelector('.tab-group li.selected')?.textContent.trim() };
  });
  console.log('![[会议 后:', JSON.stringify(st1));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  const st2 = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    return { show: el?.getAttribute('data-show'), mode: el?.querySelector('.tab-group li.selected')?.textContent.trim() };
  });
  console.log('ArrowRight 后:', JSON.stringify(st2));
  await browser.close();
})();
