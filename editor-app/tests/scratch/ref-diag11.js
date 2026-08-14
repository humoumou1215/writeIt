const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE:', m.text().slice(0, 300)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  // 检查 toast 提示
  const toasts = await page.locator('.toast').allTextContents();
  console.log('toasts:', JSON.stringify(toasts));
  // 检查文档中的 file_block 状态
  const r = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    if (!editor) return { err: 'no editor' };
    const kit = await import('/@id/@milkdown/kit/core');
    return await editor.action((ctx) => {
      const view = ctx.get(kit.editorViewCtx);
      const doc = view.state.doc;
      const info = [];
      doc.descendants((n, pos) => {
        if (n.type.name === 'file_block') {
          info.push({ pos, path: n.attrs.path, readonly: n.attrs.readonly, size: n.content.size });
        }
        return true;
      });
      return info;
    });
  });
  console.log('file_block 节点状态:', JSON.stringify(r, null, 1));
  await browser.close();
})();
