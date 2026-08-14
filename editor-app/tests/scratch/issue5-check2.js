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
  const hover = () => page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    return {
      h6: el?.querySelector('h6')?.textContent,
      hover: el?.querySelector('.menu-group li.hover')?.textContent.trim() ?? null,
      items: Array.from(el.querySelectorAll('.menu-group li')).map(li => li.textContent.trim()),
    };
  });
  console.log('打开后:', JSON.stringify(await hover()));
  // 1 次 ArrowDown → hover 数据 → Enter
  await page.keyboard.press('ArrowDown');
  console.log('↓1:', JSON.stringify(await hover()));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  console.log('进数据后:', JSON.stringify(await hover()));
  // Backspace 回根 → 进 template
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  console.log('回根:', JSON.stringify(await hover()));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  console.log('进template后:', JSON.stringify(await hover()));
  // 进 demo
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  console.log('进demo后:', JSON.stringify(await hover()));
  await browser.close();
})();
