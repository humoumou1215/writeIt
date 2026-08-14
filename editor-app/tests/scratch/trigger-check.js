const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  // 逐字符输入，观察菜单状态
  for (const ch of '![[') {
    await page.keyboard.type(ch);
    await page.waitForTimeout(300);
    const open = await page.locator('[data-ref-menu] .menu-group').count();
    console.log(`输入 ${JSON.stringify(ch)} 后菜单组数:`, open);
  }
  await page.keyboard.type('待办');
  await page.waitForTimeout(500);
  console.log('输入 待办 后菜单组数:', await page.locator('[data-ref-menu] .menu-group').count());
  await browser.close();
})();
