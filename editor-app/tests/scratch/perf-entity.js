const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { if (m.text().includes('[menu-perf]') || m.text().includes('[template]')) console.log('LOG:', m.text().slice(0, 120)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('[[笔记/周报');
  await page.waitForTimeout(900);
  // 测量：Enter 选中文件 → 实体级出现
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  let entMs = -1;
  for (let i = 0; i < 100; i++) {
    const has = await page.evaluate(() => {
      const el = document.querySelector('[data-ref-menu]');
      return el ? Array.from(el.querySelectorAll('.menu-group li')).some(li => li.textContent.includes('问候语') || li.textContent.includes('版本号')) : false;
    });
    if (has) { entMs = Date.now() - t0; break; }
    await page.waitForTimeout(20);
  }
  console.log('选文件→实体级出现:', entMs + 'ms (首次含 esbuild-wasm 初始化)');
  await browser.close();
})();
