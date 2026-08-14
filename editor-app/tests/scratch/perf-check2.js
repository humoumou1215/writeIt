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
  // 预热（缓存树）
  await page.keyboard.type('@');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // 测量：键入 @ 到菜单可见
  const t0 = Date.now();
  await page.keyboard.type('@');
  let visibleMs = -1;
  for (let i = 0; i < 40; i++) {
    const v = await page.evaluate(() => document.querySelector('[data-ref-menu]')?.getAttribute('data-show') === 'true' || !!document.querySelector('[data-ref-menu] .menu-group li'));
    if (v) { visibleMs = Date.now() - t0; break; }
    await page.waitForTimeout(10);
  }
  console.log('按键→菜单可见:', visibleMs + 'ms');
  // 过滤输入每键延迟：输入 4 个字符，测量从输入到菜单 h6 更新
  const t1 = Date.now();
  await page.keyboard.type('会');
  let filterMs = -1;
  for (let i = 0; i < 30; i++) {
    const h = await page.evaluate(() => document.querySelector('[data-ref-menu] .menu-group h6')?.textContent ?? '');
    if (h.includes('会')) { filterMs = Date.now() - t1; break; }
    await page.waitForTimeout(10);
  }
  console.log('过滤输入(1键)→菜单更新:', filterMs + 'ms');
  await browser.close();
})();
