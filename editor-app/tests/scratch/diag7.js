const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 直接 Ctrl+B
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  const c1 = await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'));
  console.log('1) Ctrl+B 收纳:', c1);
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  const c2 = await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'));
  console.log('2) Ctrl+B 展开:', !c2);
  // 打开文件后自动收纳 → 再 Ctrl+B 展开
  await page.locator('.tree .node', { hasText: 'README.md' }).click();
  await page.waitForTimeout(2000);
  const c3 = await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'));
  console.log('3) 打开文件自动收纳:', c3);
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  const c4 = await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'));
  console.log('4) Ctrl+B 展开:', !c4);
  await browser.close();
})();
