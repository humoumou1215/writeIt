const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  // 检查菜单插件是否存在（spec 是否生效）
  const r = await page.evaluate(async () => {
    const m = await import('/src/editor/ref/menu/index.ts');
    return { hasRefMenu: !!m.refMenu, stateVisible: m.refMenuState.visible };
  });
  console.log('模块状态:', JSON.stringify(r));
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.keyboard.type('![');
  await page.waitForTimeout(500);
  console.log('输入 ![ 完成');
  await browser.close();
})();
