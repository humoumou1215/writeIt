const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  // 滚动编辑器到末尾并点击末尾文字（用户真实操作）
  await page.evaluate(() => {
    const pane = document.querySelector('.editor-pane') || document.querySelector('.milkdown');
    if (pane) pane.scrollTop = pane.scrollHeight;
    // 点击文档最后一个可见段落末尾
    const pm = document.querySelector('.ProseMirror');
    const blocks = pm.querySelectorAll('p, h1, h2, h3, li');
    const last = blocks[blocks.length - 1];
    if (last) {
      const r = last.getBoundingClientRect();
      const x = Math.min(r.right - 20, window.innerWidth - 30);
      const y = Math.min(r.bottom - 10, window.innerHeight - 30);
      document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
    }
  });
  await page.waitForTimeout(500);
  const cur = await page.evaluate(() => {
    const sel = window.getSelection();
    const r = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    return r ? { top: Math.round(r.top), vh: window.innerHeight } : null;
  });
  console.log('点击后光标:', JSON.stringify(cur));
  await page.keyboard.type(' @');
  await page.waitForTimeout(1200);
  const menu = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu][data-show="true"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, onScreen: r.top >= 0 && r.bottom <= window.innerHeight };
  });
  console.log('菜单:', JSON.stringify(menu));
  console.log(menu && menu.top < cur.top ? '→ 在光标上方（翻转成功）' : '→ 仍在光标下方');
  console.log(menu && menu.onScreen ? '→ 菜单在屏幕内 ✅' : '→ 菜单出屏 ❌');
  await browser.close();
})();
