const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  const md = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    const kit = await import('/@id/@milkdown/kit/utils');
    return await editor.action(kit.getMarkdown());
  });
  console.log('getMarkdown 结果:\n' + md);
  await browser.close();
})();
