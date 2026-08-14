const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  const r = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    const schema = await editor.action((ctx) => ctx.get((await import('/@fs/media/writeIt/editor-app/node_modules/@milkdown/kit/lib/core.d.ts')).schemaCtx).catch(() => null));
    return { note: 'skip' };
  }).catch(() => null);
  console.log('skip');
  await browser.close();
})();
