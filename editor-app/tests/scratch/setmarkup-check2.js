const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  await page.evaluate(() => window.__editorSetRefPath('README.md', 'README-改'));
  await page.waitForTimeout(500);
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('setNodeMarkup 后 md 含 [[README-改]]:', md.includes('[[README-改]]'));
  console.log('README 行:', JSON.stringify(md.split('\n').find(l => l.includes('README'))));
  await browser.close();
})();
