const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  await page.evaluate(async () => {
    const mod = await import('/src/editor/../../node_modules/.vite/deps/placeholder.js').catch(() => ({}));
    window.__kit = await import('/@id/@milkdown/kit/core');
  });
  const info = await page.evaluate(async () => {
    const kit = window.__kit;
    const editor = window.__editorDebug?.();
    if (!editor) return { error: 'no editor debug hook' };
    const schema = await editor.action((ctx) => ctx.get(kit.schemaCtx));
    const nodes = Object.keys(schema.nodes);
    const doc = await editor.action((ctx) => ctx.get(kit.editorViewCtx).state.doc);
    const types = [];
    doc.descendants((n) => { types.push(n.type.name); return true; });
    return { nodes, types };
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})();
