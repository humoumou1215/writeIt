const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  // 用户场景：一直回车到底部，光标在视口内（自动滚动跟随）
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(80); }
  await page.waitForTimeout(400);
  const curBefore = await page.evaluate(() => {
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    return { top: Math.round(r.top), vh: window.innerHeight };
  });
  await page.keyboard.type('@');
  await page.waitForTimeout(1200);
  const menu = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu][data-show="true"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight, visible: r.top >= 0 && r.bottom <= window.innerHeight };
  });
  console.log('光标(按@前):', JSON.stringify(curBefore));
  console.log('菜单:', JSON.stringify(menu), menu && menu.top < curBefore.top ? '→ 在光标上方(翻转) ✅' : '→ 在光标下方 ❌');
  await browser.close();
})();
