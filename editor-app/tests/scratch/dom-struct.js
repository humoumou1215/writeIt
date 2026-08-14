const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    // 打开菜单（先输入 @ 在开头段落，避免滚动问题）
    const chain = [];
    let el = pm;
    while (el) {
      const cs = getComputedStyle(el);
      chain.push({ cls: String(el.className).slice(0, 40), pos: cs.position, overflow: cs.overflowY, scrollH: el.scrollHeight, clientH: el.clientHeight });
      el = el.parentElement;
    }
    return chain;
  });
  console.log('ProseMirror 父链:', JSON.stringify(info, null, 1));
  await browser.close();
})();
