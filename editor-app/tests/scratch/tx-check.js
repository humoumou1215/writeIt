const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: 'README.md' }).click();
  await page.waitForTimeout(4000);
  // 程序化插入事务
  const r = await page.evaluate(async () => {
    const ed = window.__editorDebug();
    if (!ed) return { err: 'no editor' };
    return await ed.action((ctx) => {
      // 通过动态导入取 editorViewCtx（与应用同模块图）
      return import('/src/editor/../node_modules/@milkdown/kit/lib/core/index.js').then(() => {
        const { editorViewCtx } = require_slash; // 占位
      }).catch(() => 'import fail');
    });
  }).catch(e => ({ err: String(e).slice(0, 120) }));
  console.log('事务测试:', JSON.stringify(r));
  // 试试 document 是否可编辑——派发一个 selection 事务（无内容变化）
  const r2 = await page.evaluate(() => {
    const ed = window.__editorDebug();
    return ed ? ed.action((ctx) => {
      // @milkdown 的 editor.action 返回 action(ctx) 结果；我们用同步方式读 doc size
      return { note: 'use __editorGoEnd instead' };
    }) : null;
  });
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  await page.keyboard.type('W');
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => ({ text: document.querySelector('.ProseMirror').textContent.slice(-8) }));
  console.log('goEnd 后打 W:', JSON.stringify(st));
  await browser.close();
})();
