const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const { state } = await import('/src/state/store.ts');
    window.__stateProbe = () => state.sidebarCollapsed;
  });
  // 复刻流程
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '会议记录.md' }).click();
  await page.waitForTimeout(2500);
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(400);
  await page.keyboard.press('End');
  await page.keyboard.type(' xx');
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(800);
  await page.locator('.icon-col .icon-btn').nth(1).click();
  await page.waitForTimeout(500);
  await page.selectOption('.settings-modal select', 'nord-dark');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // 合成事件
  const r = await page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true });
    const before = window.__stateProbe();
    document.dispatchEvent(ev);  // 从 document 派发（类似焦点在 body）
    const after = window.__stateProbe();
    return { before, after, defaultPrevented: ev.defaultPrevented };
  });
  console.log('合成 Ctrl+B 结果:', JSON.stringify(r));
  await browser.close();
})();
