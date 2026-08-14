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
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const st = window.__refMenuState;
    return { mode: st?.mode, domMode: document.querySelector('[data-ref-menu] .tab-group li.selected')?.textContent.trim(), same: st ? 'ok' : 'null' };
  });
  console.log('状态:', JSON.stringify(r));
  await browser.close();
})();
