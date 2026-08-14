const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const traces = [];
  page.on('console', (m) => { if (m.text().includes('AUTO-COLLAPSE')) traces.push(m.text()); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: 'README.md' }).click();
  await page.waitForTimeout(2000);
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(300);
  console.log('打开文件时的 AUTO-COLLAPSE 次数:', traces.length);
  await page.keyboard.press(' ');
  await page.waitForTimeout(400);
  console.log('按空格后 AUTO-COLLAPSE 次数:', traces.length, '| collapsed:', await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed')));
  if (traces.length) console.log('最新调用栈:', traces[traces.length - 1].split('\n').slice(0, 8).join('\n'));
  await browser.close();
})();
