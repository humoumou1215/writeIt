const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 注入按键监听，捕获空格键时运行 App 相同的循环逻辑
  const r = await page.evaluate(async () => {
    const m = await import('/src/state/settings.ts');
    const settings = m.settings;
    const comboMatches = m.comboMatches;
    const SHORTCUT_DEFS = m.SHORTCUT_DEFS;
    window.__spaceMatch = null;
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        for (const def of SHORTCUT_DEFS) {
          const combo = settings.shortcuts[def.id];
          if (combo && comboMatches(e, combo)) {
            window.__spaceMatch = def.id + '=' + combo;
            return;
          }
        }
        window.__spaceMatch = 'NONE';
      }
    });
    return { shortcuts: JSON.stringify(settings.shortcuts) };
  });
  console.log('快捷键映射:', r.shortcuts);
  // 打开文件并展开
  await page.locator('.tree .name', { hasText: 'README.md' }).click();
  await page.waitForTimeout(2000);
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  const out = await page.evaluate(() => ({ match: window.__spaceMatch, collapsed: document.querySelector('.content-col').classList.contains('collapsed') }));
  console.log('空格匹配结果:', JSON.stringify(out));
  await browser.close();
})();
