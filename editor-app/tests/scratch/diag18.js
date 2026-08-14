const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 复刻
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
  // 在 ⚙️ 按钮上合成 Ctrl+B（真实按键的目标）
  const r = await page.evaluate(() => {
    const btn = document.querySelector('.icon-col .icon-btn:nth-child(2)');
    btn.focus();
    const ev = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true });
    const collapsedBefore = document.querySelector('.content-col').classList.contains('collapsed');
    btn.dispatchEvent(ev);
    const collapsedAfter = document.querySelector('.content-col').classList.contains('collapsed');
    return { targetTag: ev.target.tagName, collapsedBefore, collapsedAfter, prevented: ev.defaultPrevented };
  });
  console.log('按钮上合成 Ctrl+B:', JSON.stringify(r));
  // 真实按键对照
  await page.evaluate(() => { document.querySelector('.content-col').classList.remove('collapsed'); });
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(300);
  console.log('真实 Ctrl+B 后 DOM collapsed:', await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed')));
  await browser.close();
})();
