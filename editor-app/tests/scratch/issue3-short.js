const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 新建一个较短的文档：把引用演示内容换成 30 行左右
  await page.locator('.tree .name', { hasText: 'README.md' }).click();
  await page.waitForTimeout(4000);
  // README 较短；goEnd 后光标应在视口内
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  const cur = await page.evaluate(() => {
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    return { top: Math.round(r.top), vh: window.innerHeight, onScreen: r.top > 0 && r.top < window.innerHeight - 30 };
  });
  console.log('光标:', JSON.stringify(cur));
  await page.keyboard.type(' @');
  await page.waitForTimeout(1200);
  const menu = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu][data-show="true"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight, onScreen: r.top >= 0 && r.bottom <= window.innerHeight };
  });
  console.log('菜单:', JSON.stringify(menu));
  console.log(menu ? (menu.top < cur.top ? '→ 在光标上方（翻转）' : '→ 在光标下方') : '菜单未打开');
  console.log(menu && menu.onScreen ? '✅ 在屏幕内' : '❌ 出屏');
  await browser.close();
})();
