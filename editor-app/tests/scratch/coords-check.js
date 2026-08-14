const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  const get = () => page.evaluate(() => {
    const ed = window.__editorDebug();
    const info = ed.action((ctx) => {
      // 同步读 view
      return null;
    });
    return { noop: true };
  });
  const r = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    const ed = window.__editorDebug();
    // 用 __editorDebug 的 action 读 coords（同步，通过暴露的闭包）
    const coords = ed.action(() => null);
    return { coordsIsNull: coords === null };
  });
  console.log(JSON.stringify(r));
  await browser.close();
})();
