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
  // 进入 笔记 → 用 → 键到 会议记录 → 再 → 进入实体级 → ← 返回
  await page.keyboard.press('Enter');  // 笔记（Enter 进目录）
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowDown');  // hover 会议记录
  await page.keyboard.press('ArrowRight'); // → 进入实体级
  await page.waitForTimeout(800);
  const inEnt = await page.evaluate(() => document.querySelector('[data-ref-menu] h6')?.textContent);
  console.log('实体级:', inEnt);
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
  console.log(back.hover && back.hover.includes('会议记录') ? '✅ → 进入后 ← 回到会议记录' : '❌ 未恢复');
  await browser.close();
})();
