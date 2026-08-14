const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.keyboard.type('[[');
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const all = document.querySelectorAll('.milkdown-slash-menu');
    return Array.from(all).map((el, i) => ({
      i,
      show: el.dataset.show,
      display: getComputedStyle(el).display,
      pos: getComputedStyle(el).position,
      html: el.innerHTML.slice(0, 150),
    }));
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})();
