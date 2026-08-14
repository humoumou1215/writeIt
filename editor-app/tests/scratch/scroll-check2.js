const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: 'README.md' }).click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => {
    const pane = document.querySelector('.editor-pane');
    const pm = document.querySelector('.ProseMirror');
    const sel = window.getSelection();
    const r = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    // caret 的坐标（coordsAtPos 通过 selection 的 DOM 定位）
    const caretEl = pm.querySelector('.ProseMirror-selectednode') || null;
    return {
      scrollTop: pane.scrollTop,
      maxScroll: pane.scrollHeight - pane.clientHeight,
      curTop: r ? Math.round(r.top) : null,
      pmScrollH: pm.scrollHeight,
      pmClientH: pm.clientHeight,
      paneTop: Math.round(pane.getBoundingClientRect().top),
      paneBottom: Math.round(pane.getBoundingClientRect().bottom),
    };
  });
  console.log(JSON.stringify(st));
  await browser.close();
})();
