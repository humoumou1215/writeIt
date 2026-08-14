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
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    return {
      show: el?.getAttribute('data-show'),
      html: el?.innerHTML.slice(0, 250),
    };
  });
  console.log('输入后未按 Enter:', JSON.stringify(st));
  // 现在按 Enter
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const st2 = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    return {
      show: el?.getAttribute('data-show'),
      lis: Array.from(el?.querySelectorAll('li') ?? []).map(li => li.textContent.trim()).slice(0, 4),
      h6: el?.querySelector('h6')?.textContent,
    };
  });
  console.log('按 Enter 后:', JSON.stringify(st2));
  await browser.close();
})();
