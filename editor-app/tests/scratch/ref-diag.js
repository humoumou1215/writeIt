const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  // 检查编辑器里的节点类型
  const info = await page.evaluate(async () => {
    const { editorViewCtx } = await import('/src/editor/ref/../../../../node_modules/.vite/deps/placeholder.js').catch(() => ({}));
    // 通过 DOM 检查
    const md = document.querySelector('.milkdown .ProseMirror');
    return {
      htmlLen: md?.innerHTML.length,
      doctypeCount: md?.querySelectorAll('.ref-doctype').length,
      fileRefCount: md?.querySelectorAll('a.ref-file').length,
      blockCount: md?.querySelectorAll('.ref-file-block').length,
      text: md?.textContent?.slice(0, 200),
      children: md ? Array.from(md.children).map(c => c.tagName + '.' + c.className.slice(0, 40)) : [],
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})();
