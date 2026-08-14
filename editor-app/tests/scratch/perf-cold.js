const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 打开无对象引用的文件（避免预热 esbuild）
  await page.locator('.tree .name', { hasText: 'README.md' }).click();
  await page.waitForTimeout(4000);
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('[[template/demo/demo');
  await page.waitForTimeout(900);
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  let entMs = -1;
  for (let i = 0; i < 150; i++) {
    const has = await page.evaluate(() => {
      const el = document.querySelector('[data-ref-menu]');
      return el ? Array.from(el.querySelectorAll('.menu-group li')).some(li => li.textContent.includes('问候语') || li.textContent.includes('版本号')) : false;
    });
    if (has) { entMs = Date.now() - t0; break; }
    await page.waitForTimeout(20);
  }
  console.log('冷启动 suggest 加载:', entMs + 'ms');
  await browser.close();
})();
