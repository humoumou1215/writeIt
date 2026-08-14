const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  // 先拍 / 菜单
  await page.keyboard.type('/');
  await page.waitForTimeout(700);
  await page.screenshot({ path: '/media/writeIt/editor-app/demo-shots/13-斜杠菜单.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.type('[[');
  await page.waitForTimeout(700);
  await page.screenshot({ path: '/media/writeIt/editor-app/demo-shots/14-引用菜单同款UI.png' });
  await browser.close();
  console.log('对比截图完成');
})();
