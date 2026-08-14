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
    const changes = await page.evaluate(() => { const c = [...window.__colChanges]; return c; });
    console.log(name, '→', JSON.stringify(changes));
  };

  await step('打开笔记目录', () => page.locator('.tree .node', { hasText: '笔记' }).first().click());
  await step('打开会议记录', () => page.locator('.tree .name', { hasText: '会议记录.md' }).click());
  await step('点击📁图标展开', () => page.locator('.icon-col .icon-btn').first().click());
  await step('输入+Ctrl+S', async () => {
    await page.keyboard.press('End');
    await page.keyboard.type(' xx');
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(600);
  });
  await step('点⚙️打开设置', () => page.locator('.icon-col .icon-btn').nth(1).click());
  await step('切换主题 nord-dark', () => page.selectOption('.settings-modal select', 'nord-dark'));
  await step('Esc 关闭设置', () => page.keyboard.press('Escape'));
  await browser.close();
})();
