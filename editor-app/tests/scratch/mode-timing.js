const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { if (m.text().includes('[menu-key]') || m.text().includes('setMode')) console.log('LOG:', m.text().slice(0, 90)); });
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
  // 立即 + 延迟检查
  for (const delay of [0, 50, 200, 500]) {
    await page.waitForTimeout(delay);
    const mode = await page.evaluate(() => document.querySelector('[data-ref-menu] .tab-group li.selected')?.textContent.trim());
    console.log('t+' + delay + 'ms 模式:', mode);
  }
  await browser.close();
})();
