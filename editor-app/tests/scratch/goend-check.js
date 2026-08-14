const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    const { editorViewCtx } = await import('/@fs/media/writeIt/editor-app/node_modules/@milkdown/core/lib/index.js').catch(() => ({ editorViewCtx: null }));
    if (!editor) return { err: 'no editor' };
    const docSize = await editor.action((ctx) => ctx.get(editorViewCtx).state.doc.content.size);
    const selPos = await editor.action((ctx) => ctx.get(editorViewCtx).state.selection.from);
    return { docSize, selPos };
  }).catch((e) => ({ err: String(e).slice(0, 120) }));
  console.log('goEnd 后:', JSON.stringify(r));
  await page.keyboard.type('[[Mermaid');
  await page.waitForTimeout(600);
  console.log('菜单打开:', await page.locator('[data-ref-menu] .menu-group li').count() > 0);
  await browser.close();
})();
