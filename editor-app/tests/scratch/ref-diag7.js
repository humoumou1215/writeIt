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
    const kit = await import('/@id/@milkdown/kit/core');
    return await editor.action((ctx) => {
      const parser = ctx.get(kit.parserCtx);
      const doc = parser('doctype:demo\n\n见 [[README.md]] 一文\n\n![[笔记/待办清单]]\n');
      const types = [];
      doc.descendants((n) => { types.push(n.type.name); return true; });
      return types;
    });
  });
  console.log('手动解析结果节点:', JSON.stringify(r));
  await browser.close();
})();
