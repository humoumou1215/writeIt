const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 250)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  // 直接调 resolveRefs 看是否补物化
  const r = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    const m = await import('/src/editor/ref/index.ts');
    await m.resolveRefs(editor);
    await new Promise(r => setTimeout(r, 1500));
    const kit = await import('/@id/@milkdown/kit/core');
    return await editor.action((ctx) => {
      const view = ctx.get(kit.editorViewCtx);
      const doc = view.state.doc;
      const info = [];
      doc.descendants((n, pos) => {
        if (n.type.name === 'file_block') info.push({ pos, path: n.attrs.path, size: n.content.size, first: n.firstChild?.type.name });
        return true;
      });
      return info;
    });
  });
  console.log('二次 resolve 后:', JSON.stringify(r, null, 1));
  await browser.close();
})();
