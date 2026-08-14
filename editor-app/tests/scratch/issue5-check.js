const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 160)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  // @ 打开菜单，进入 数据 目录
  await page.keyboard.type('@');
  await page.waitForTimeout(900);
  const entries1 = await page.evaluate(() => Array.from(document.querySelectorAll('[data-ref-menu] .menu-group li')).map(li => li.textContent.trim()));
  console.log('根级:', JSON.stringify(entries1));
  // 找到 数据 目录（第二个 dir）并进入
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const entries2 = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    return { h6: el?.querySelector('h6')?.textContent, items: Array.from(el.querySelectorAll('.menu-group li')).map(li => li.textContent.trim()) };
  });
  console.log('进入数据目录后:', JSON.stringify(entries2));
  // 返回根，进 template
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const entries3 = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    return { h6: el?.querySelector('h6')?.textContent, items: Array.from(el.querySelectorAll('.menu-group li')).map(li => li.textContent.trim()) };
  });
  console.log('进入template目录后:', JSON.stringify(entries3));
  await browser.close();
})();
