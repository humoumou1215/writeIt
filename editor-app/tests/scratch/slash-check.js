const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  await page.keyboard.type('\n/');
  await page.waitForTimeout(1000);
  const info = await page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('.milkdown-slash-menu'));
    return menus.map(m => ({
      show: m.getAttribute('data-show'),
      html: m.innerHTML.slice(0, 400),
    }));
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 1200));
  await browser.close();
})();
