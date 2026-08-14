const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
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
  console.log('suggest 加载(预热后):', entMs + 'ms');
  // 选实体 → 插入 + 对象解析
  const t1 = Date.now();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  const resolved = await page.evaluate(() => {
    const el = document.querySelector('[data-object-ref]');
    return el ? el.getAttribute('data-text') : null;
  });
  console.log('实体插入→解析完成:', resolved ? (Date.now() - t1) + 'ms' : '未解析');
  await browser.close();
})();
