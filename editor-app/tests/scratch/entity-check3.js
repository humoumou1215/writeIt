const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('[[笔记/周报');
  await page.waitForTimeout(1200);
  const st = await page.evaluate(async () => {
    const m = await import('/src/editor/ref/menu/index.ts');
    return { visible: m.refMenuState.visible, query: m.refMenuState.query, recentTyped: m.refMenuState.recentTyped, mode: m.refMenuState.mode };
  });
  console.log('refMenuState:', JSON.stringify(st));
  // 检查 ProseMirror 是否收到键（DOM 文本确认）
  const text = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    return pm ? pm.textContent.slice(-30) : '';
  });
  console.log('文档末尾文本:', JSON.stringify(text));
  await browser.close();
})();
