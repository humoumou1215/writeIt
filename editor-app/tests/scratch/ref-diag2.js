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
    const { schemaCtx } = await import('/src/../../node_modules/.vite/deps/placeholder.js').catch(() => ({}));
    // 直接查 ProseMirror 内部：找到编辑器实例较难，改用 DOM + 解析器探针
    // 通过 window 上的 vite 模块拿不到，改用 schema 类型探测：尝试从编辑器 DOM 反查
    return { note: 'skip' };
  });
  // 用另一个途径：检查 getMarkdown 的序列化结果（如果节点注册了但没解析，文本仍是原样）
  const preview = await page.evaluate(() => document.querySelector('#preview')?.textContent?.slice(0, 300));
  console.log('preview markdown:', JSON.stringify(preview));
  await browser.close();
})();
