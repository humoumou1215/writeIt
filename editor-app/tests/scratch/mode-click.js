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
  // 点击 嵌入只读 tab
  await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    const lis = el.querySelectorAll('.tab-group li');
    lis[2].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const dump = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    return Array.from(el.querySelectorAll('.tab-group li')).map(li => ({ text: li.textContent.trim(), cls: li.className }));
  });
  console.log('点击后:', JSON.stringify(dump));
  await browser.close();
})();
