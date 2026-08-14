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
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('[[笔记/周报');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => {
      const el = document.querySelector('[data-ref-menu]');
      const ent = document.querySelectorAll('[data-ref-menu] li');
      return {
        show: el?.getAttribute('data-show'),
        liCount: ent.length,
        lis: Array.from(ent).map(li => li.textContent.trim()).slice(0, 5),
        selectedPath: el?.querySelector('h6')?.textContent,
      };
    });
    console.log('状态:', JSON.stringify(st));
    if (st.liCount >= 2) break;
  }
  await browser.close();
})();
