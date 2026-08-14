const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 160)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  // 段落中间插入：前段文字 + ![[待办
  await page.keyboard.type('前段文字');
  await page.keyboard.type('![[待办清单');
  await page.waitForTimeout(900);
  await page.keyboard.press('Enter');  // 嵌入模式直接插入
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.ref-file-block'));
    const last = cards[cards.length - 1];
    return {
      cards: cards.length,
      lastPath: last?.querySelector('.ref-file-block-path')?.textContent,
      lastLen: last?.querySelector('.ref-file-block-content')?.textContent?.length ?? 0,
    };
  });
  console.log('段落中间插入后:', JSON.stringify(st));
  await browser.close();
})();
