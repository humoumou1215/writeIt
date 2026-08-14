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
  await page.keyboard.type('@');
  await page.waitForTimeout(900);
  // 进入 笔记 → 周报
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  // 实体级出现，选 版本号（第 2 项）
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  const obj = await page.evaluate(() => {
    const el = document.querySelector('[data-object-ref]');
    return el ? { obj: el.getAttribute('data-object'), text: el.getAttribute('data-text') } : null;
  });
  console.log('md 含对象引用:', md.includes('[[笔记/周报#version]]'));
  console.log('object_ref 已解析:', JSON.stringify(obj));
  await browser.close();
})();
