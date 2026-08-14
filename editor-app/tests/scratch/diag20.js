const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.__colChanges = [];
    const el = document.querySelector('.content-col');
    new MutationObserver(() => {
      window.__colChanges.push(Date.now() + ':' + el.classList.contains('collapsed'));
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  });
  const step = async (name, fn) => {
    await page.evaluate(() => { window.__colChanges = []; });
    await fn();
    await page.waitForTimeout(350);
    const changes = await page.evaluate(() => [...window.__colChanges]);
    console.log(name, '→', JSON.stringify(changes));
  };
  await step('打开文件', () => page.locator('.tree .name', { hasText: 'README.md' }).click());
  await step('图标展开', () => page.locator('.icon-col .icon-btn').first().click());
  await step('仅输入 xx', async () => {
    await page.keyboard.press('End');
    await page.keyboard.type(' xx');
  });
  await step('仅 Ctrl+S', async () => {
    await page.keyboard.press('Control+s');
  });
  await step('仅 Control 键', async () => {
    await page.keyboard.down('Control');
    await page.keyboard.up('Control');
  });
  await browser.close();
})();
