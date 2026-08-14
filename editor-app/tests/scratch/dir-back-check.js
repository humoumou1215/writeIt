const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('@');
  await page.waitForTimeout(900);
  // 根级 hover 数据（第 2 项）→ → 进入 → ← 返回
  await page.keyboard.press('ArrowDown');  // hover 数据
  await page.keyboard.press('ArrowRight'); // → 进入数据目录
  await page.waitForTimeout(500);
  const inDir = await page.evaluate(() => document.querySelector('[data-ref-menu] h6')?.textContent);
  console.log('进入:', inDir);
  await page.keyboard.press('ArrowLeft');  // ← 返回
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    return {
      h6: el?.querySelector('h6')?.textContent,
      hover: el?.querySelector('.menu-group li.hover')?.textContent.trim() ?? null,
    };
  });
  console.log('← 返回后:', JSON.stringify(back));
  console.log(back.h6 === '文件' && back.hover && back.hover.includes('数据') ? '✅ 回到数据目录' : '❌ 未回到数据');
  await browser.close();
})();
