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
  await page.keyboard.type('@');
  await page.waitForTimeout(900);
  // 进入 笔记 → 周报
  await page.keyboard.press('Enter');  // 笔记(0)
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');  // 周报
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    return {
      h6: el?.querySelector('h6')?.textContent,
      items: Array.from(el.querySelectorAll('.menu-group li')).map(li => li.textContent.trim()),
    };
  });
  console.log('at 周报 Enter 后:', JSON.stringify(st));
  await browser.close();
})();
