const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[menu-key]') || t.includes('setMode') || t.includes('shouldShow')) console.log('LOG:', t.slice(0, 100));
  });
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
  // 直接调用 setMode 看时序
  await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    el.querySelectorAll('.tab-group li')[2].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({ mode: window.__refMenuState.mode }));
  console.log('点击后 state.mode:', r.mode);
  await browser.close();
})();
