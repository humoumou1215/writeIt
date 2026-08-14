const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '会议记录.md' }).click();
  await page.waitForTimeout(2500);
  // 采样关键行的背景色（x=700 垂直扫描）
  const rows = await page.evaluate(() => {
    const results = [];
    // 找各元素位置
    const rect = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height) }; };
    results.push({ el: '.tabbar', ...rect('.tabbar') });
    results.push({ el: '.editor-area', ...rect('.editor-area') });
    results.push({ el: '.milkdown', ...rect('.milkdown') });
    const topBar = document.querySelector('.milkdown .top-bar, .milkdown [class*=top-bar], .milkdown header');
    if (topBar) { const r = topBar.getBoundingClientRect(); results.push({ el: 'crepe-topbar', y: Math.round(r.y), h: Math.round(r.height), cls: topBar.className }); }
    // 采样背景色
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const colors = [];
    const probe = (y) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.drawImage(document.elementFromPoint(700, y)?.ownerDocument?.documentElement || document.documentElement, 700, y, 1, 1, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${d[0]},${d[1]},${d[2]})`;
    };
    // 采样 tab 下方 5px、15px、25px 的行
    for (const y of [45, 52, 60, 70, 80, 95]) colors.push({ y, color: probe(y), el: document.elementFromPoint(700, y)?.className || '' });
    return { results, colors };
  });
  console.log(JSON.stringify(rows, null, 1));
  await page.screenshot({ path: '/tmp/inspect.png' });
  await browser.close();
})();
