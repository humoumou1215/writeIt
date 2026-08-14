const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('['+m.type()+']', m.text().slice(0, 160)); });
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
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => {
      const el = document.querySelector('[data-ref-menu]');
      return {
        show: el?.getAttribute('data-show'),
        h6: el?.querySelector('h6')?.textContent ?? null,
        lis: Array.from(el?.querySelectorAll('li') ?? []).map(li => li.textContent.trim()).slice(0, 3),
      };
    });
    console.log('t+' + (i*400+400) + 'ms:', JSON.stringify(st));
    if (st.show === 'true' && st.lis.length >= 2) break;
  }
  await browser.close();
})();
