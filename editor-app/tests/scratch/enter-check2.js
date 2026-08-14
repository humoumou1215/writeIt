const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  const docBefore = await page.evaluate(() => {
    const ed = window.__editorDebug();
    return { size: ed.action(c => c.get(require_editorViewCtx)) };
  }).catch(() => null);
  // 用 editor action 读 doc 大小
  const read = (label) => page.evaluate(async (l) => {
    const { editorViewCtx } = await import('/@fs/media/writeIt/editor-app/src/../node_modules/@milkdown/core/lib/index.js').catch(() => null);
    return l;
  }, label).catch(() => null);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('X');
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    return {
      activeTag: document.activeElement?.tagName,
      activeClass: document.activeElement?.className,
      pmText: pm?.textContent.slice(-20),
    };
  });
  console.log('输入后:', JSON.stringify(st));
  await browser.close();
})();
