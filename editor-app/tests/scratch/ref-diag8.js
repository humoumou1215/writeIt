const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 250)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  // 点击前看树
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  const state1 = await page.evaluate(async () => {
    const debug = window.__editorDebug;
    const st = await import('/src/state/store.ts');
    return { debugType: typeof debug, active: st.state.activeTabId, tabNames: st.state.tabs.map(t => t.name) };
  });
  console.log('store(探测实例):', JSON.stringify(state1));
  // 用调试钩子里的编辑器解析
  const r = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    if (!editor) return { err: 'editor null' };
    const kit = await import('/@id/@milkdown/kit/core');
    return await editor.action((ctx) => {
      const parser = ctx.get(kit.parserCtx);
      const doc = parser('doctype:demo\n\n见 [[README.md]] 一文\n\n![[笔记/待办清单]]\n');
      const types = [];
      doc.descendants((n) => { types.push(n.type.name); return true; });
      return types;
    });
  });
  console.log('手动解析:', JSON.stringify(r));
  await browser.close();
})();
