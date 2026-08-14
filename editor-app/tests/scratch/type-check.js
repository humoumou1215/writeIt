const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  // 直接用 document.execCommand? 不 —— 用 Playwright 打字
  const st1 = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    pm.focus();
    return { focused: pm === document.activeElement };
  });
  console.log('聚焦:', JSON.stringify(st1));
  await page.keyboard.type('Z');
  await page.waitForTimeout(500);
  const st2 = await page.evaluate(() => ({ text: document.querySelector('.ProseMirror').textContent.slice(-5) }));
  console.log('直接打 Z 后:', JSON.stringify(st2));
  await browser.close();
})();
