const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(500);
  await page.keyboard.type('MARKER');
  await page.waitForTimeout(300);
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('MARKER 位置:', md.indexOf('MARKER'), '| 总长:', md.length);
  console.log('md 末尾 60 字符:', JSON.stringify(md.slice(-60)));
  await browser.close();
})();
