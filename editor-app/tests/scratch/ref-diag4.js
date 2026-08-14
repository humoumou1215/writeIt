const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  const info = await page.evaluate(async () => {
    const store = await import('/@id/@milkdown/kit/core').then(() => null).catch(() => null);
    const st = await import('/src/state/store.ts');
    const debug = window.__editorDebug;
    let editor = null;
    try { editor = debug ? debug() : null; } catch (e) { return { debugErr: e.message }; }
    if (!editor) return { debugType: typeof debug, activeTabId: st.state.activeTabId, tabs: st.state.tabs.map(t => t.name) };
    const kit = await import('/@id/@milkdown/kit/core');
    const schema = await editor.action((ctx) => ctx.get(kit.schemaCtx));
    const doc = await editor.action((ctx) => ctx.get(kit.editorViewCtx).state.doc);
    const types = [];
    doc.descendants((n) => { types.push(n.type.name); return true; });
    return { schemaNodes: Object.keys(schema.nodes), docTypes: types };
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})();
