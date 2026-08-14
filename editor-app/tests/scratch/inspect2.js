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
  const info = await page.evaluate(() => {
    const rect = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height) }; };
    const rows = [0, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120, 150];
    const samples = rows.map(y => {
      const el = document.elementFromPoint(700, y);
      if (!el) return { y, el: null };
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      let chain = el.className ? String(el.className).slice(0, 40) : el.tagName;
      let p = el.parentElement;
      let depth = 0;
      while (p && depth < 4) { chain += ' < ' + (p.className ? String(p.className).slice(0, 30) : p.tagName); p = p.parentElement; depth++; }
      return { y, bg, el: chain };
    });
    return {
      tabbar: rect('.tabbar'),
      editorArea: rect('.editor-area'),
      milkdown: rect('.milkdown'),
      topbar: rect('.milkdown-top-bar'),
      pane: rect('.editor-pane'),
      tabbarBg: (() => { const el = document.querySelector('.tabbar'); return el ? getComputedStyle(el).backgroundColor : null; })(),
      tabActiveBg: (() => { const el = document.querySelector('.tab.active'); return el ? getComputedStyle(el).backgroundColor : null; })(),
      editorAreaBg: (() => { const el = document.querySelector('.editor-area'); return el ? getComputedStyle(el).backgroundColor : null; })(),
      milkdownBg: (() => { const el = document.querySelector('.milkdown'); return el ? getComputedStyle(el).backgroundColor : null; })(),
      topbarBg: (() => { const el = document.querySelector('.milkdown-top-bar'); return el ? getComputedStyle(el).backgroundColor : null; })(),
      samples,
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})();
