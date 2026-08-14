const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  // 检查 shouldShow 链路：手动触发 provider.update 前后的状态
  const r = await page.evaluate(async () => {
    const state = (await import('/src/editor/ref/menu/index.ts')).refMenuState;
    return { visible: state.visible, query: state.query, mode: state.mode, triggerFrom: state.triggerFrom };
  });
  console.log('初始状态:', JSON.stringify(r));
  await page.keyboard.type('[[');
  await page.waitForTimeout(600);
  const r2 = await page.evaluate(async () => {
    const m = await import('/src/editor/ref/menu/index.ts');
    return { visible: m.refMenuState.visible, query: m.refMenuState.query, mode: m.refMenuState.mode };
  });
  console.log('输入 [[ 后状态:', JSON.stringify(r2));
  // 直接测 getTextBeforeCursor / matchTrigger 逻辑
  const r3 = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    const m = await import('/src/editor/ref/menu/index.ts');
    return 'skip';
  });
  await browser.close();
})();
