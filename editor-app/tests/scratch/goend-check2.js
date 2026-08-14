const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  // 用编辑器 action 直接查（通过 debug 钩子 + 页面内 kit 模块）
  await page.evaluate(async () => {
    const kit = await import('/@fs/media/writeIt/editor-app/node_modules/@milkdown/kit/lib/core.js');
    window.__kitCore = kit;
  });
  const before = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    return editor.action((ctx) => ctx.get(window.__kitCore.editorViewCtx).state.selection.from);
  });
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(1000);
  const after = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    return editor.action((ctx) => ctx.get(window.__kitCore.editorViewCtx).state.selection.from);
  });
  const docSize = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    return editor.action((ctx) => ctx.get(window.__kitCore.editorViewCtx).state.doc.content.size);
  });
  console.log('before:', before, 'after:', after, 'docSize:', docSize);
  await page.keyboard.type('[[Mermaid');
  await page.waitForTimeout(700);
  console.log('菜单打开:', await page.locator('[data-ref-menu] .menu-group li').count() > 0);
  await browser.close();
})();
