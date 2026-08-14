const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '会议记录.md' }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/media/writeIt/editor-app/demo-shots/07-布局修复后.png' });
  const ok = await page.evaluate(() => {
    const main = document.querySelector('.main').getBoundingClientRect();
    const h1 = document.querySelector('.milkdown h1');
    return {
      mainVisible: main.height > 300 && main.y >= 0,
      editorRendered: !!h1 && h1.getBoundingClientRect().height > 0,
      h1Text: h1?.textContent?.trim(),
    };
  });
  console.log('主区域可见:', ok.mainVisible, '| 编辑器渲染:', ok.editorRendered, '| 标题:', ok.h1Text);
  await browser.close();
})();
