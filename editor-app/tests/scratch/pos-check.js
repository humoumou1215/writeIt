const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(400);
  // 光标位置
  const cur = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
  });
  console.log('光标位置:', JSON.stringify(cur));
  await page.keyboard.type(' @');
  await page.waitForTimeout(1200);
  const menu = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu][data-show="true"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // 找滚动容器
    let p = el.parentElement; const scrolls = [];
    while (p) { if (p.scrollHeight > p.clientHeight + 5) scrolls.push(p.className); p = p.parentElement; }
    return { top: Math.round(r.top), height: Math.round(r.height), scrolls: scrolls.slice(0, 3) };
  });
  console.log('菜单位置:', JSON.stringify(menu));
  await browser.close();
})();
