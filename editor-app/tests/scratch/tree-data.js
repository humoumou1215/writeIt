const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('@');
  await page.waitForTimeout(900);
  // 直接检查 app 的 fs.readTree 输出
  const tree = await page.evaluate(async () => {
    const { fs } = await import('/src/fs/index.ts');
    const t = await fs.readTree(true);
    const flat = (list) => list.map(n => ({ name: n.name, path: n.path, kind: n.kind, children: n.children ? flat(n.children) : undefined }));
    return flat(t);
  });
  console.log('fs.readTree:', JSON.stringify(tree, null, 1).slice(0, 1500));
  await browser.close();
})();
