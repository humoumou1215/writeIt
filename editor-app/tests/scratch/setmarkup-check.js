const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  const r = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    const { editorViewCtx } = await import('/@fs/media/writeIt/editor-app/node_modules/@milkdown/core/lib/index.js').catch(() => null);
    return { note: 'need kit import path' };
  }).catch(() => null);
  // 用编辑器 action 通过动态导入（应用内模块）做
  const r2 = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    // 找到 README ref 并 setNodeMarkup
    return await editor.action(async (ctx) => {
      const kit = await import('/src/editor/../../node_modules/@milkdown/core/lib/index.js').catch(() => null);
      if (!kit) return { err: 'kit import failed' };
      const view = ctx.get(kit.editorViewCtx);
      let pos = -1;
      view.state.doc.descendants((n, p) => {
        if (n.type.name === 'file_ref' && n.attrs.path === 'README.md') { pos = p; return false; }
        return true;
      });
      if (pos < 0) return { err: 'ref not found', doc: view.state.doc.textContent.slice(0, 60) };
      const tr = view.state.tr.setNodeMarkup(pos, undefined, { path: 'README-改' });
      view.dispatch(tr);
      const after = view.state.doc.nodeAt(pos);
      return { ok: true, afterPath: after?.attrs.path };
    });
  });
  console.log('setNodeMarkup 结果:', JSON.stringify(r2));
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('md 含 README-改:', md.includes('[[README-改]]'));
  await browser.close();
})();
