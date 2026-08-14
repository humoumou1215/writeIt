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
  // 全角 ＠
  await page.keyboard.type('＠');
  await page.waitForTimeout(900);
  let open = await page.evaluate(() => document.querySelector('[data-ref-menu][data-show="true"]') !== null);
  console.log('全角 ＠ 触发:', open);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // 全角 ！＋半角 [[
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('！[[');
  await page.waitForTimeout(900);
  const mode = await page.evaluate(() => document.querySelector('[data-ref-menu] .tab-group li.selected')?.textContent.trim());
  open = await page.evaluate(() => document.querySelector('[data-ref-menu][data-show="true"]') !== null);
  console.log('全角 ！[[ 触发:', open, '模式:', mode);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // 快捷键：Tab 切模式
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('[[');
  await page.waitForTimeout(900);
  const m1 = await page.evaluate(() => document.querySelector('[data-ref-menu] .tab-group li.selected')?.textContent.trim());
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const m2 = await page.evaluate(() => document.querySelector('[data-ref-menu] .tab-group li.selected')?.textContent.trim());
  console.log('Tab 切模式:', m1, '→', m2);
  // → 进入目录（hover 笔记）
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  const h6 = await page.evaluate(() => document.querySelector('[data-ref-menu] h6')?.textContent);
  console.log('→ 进入目录后 h6:', h6);
  // ← 返回上级
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(500);
  const h6b = await page.evaluate(() => document.querySelector('[data-ref-menu] h6')?.textContent);
  console.log('← 返回后 h6:', h6b);
  await browser.close();
})();
