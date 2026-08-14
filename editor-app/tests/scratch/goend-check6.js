const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(500);
  await page.keyboard.type('[[');
  await page.waitForTimeout(700);
  const st = await page.evaluate(async () => {
    const m = await import('/src/editor/ref/menu/index.ts');
    return { visible: m.refMenuState.visible, query: m.refMenuState.query };
  });
  console.log('菜单状态:', JSON.stringify(st));
  console.log('容器存在:', await page.locator('[data-ref-menu]').count(), '| data-show:', await page.locator('[data-ref-menu]').getAttribute('data-show'));
  console.log('菜单组数:', await page.locator('[data-ref-menu] .menu-group').count());
  await browser.close();
})();
