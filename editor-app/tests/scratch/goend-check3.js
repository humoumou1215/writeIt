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
  await page.waitForTimeout(1000);
  // 检查光标是否在文档末尾：输入测试文本看是否追加到结尾
  await page.keyboard.type('@');
  await page.waitForTimeout(600);
  console.log('@ 菜单打开:', await page.locator('[data-ref-menu] .menu-group li').count() > 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.type('[[Mermaid');
  await page.waitForTimeout(600);
  console.log('[[ 菜单打开:', await page.locator('[data-ref-menu] .menu-group li').count() > 0);
  await browser.close();
})();
