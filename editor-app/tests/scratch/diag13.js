const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 复刻到失败状态
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '会议记录.md' }).click();
  await page.waitForTimeout(2500);
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(400);
  await page.keyboard.press('End');
  await page.keyboard.type(' xx');
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(800);
  await page.locator('.icon-col .icon-btn').nth(1).click();
  await page.waitForTimeout(500);
  await page.selectOption('.settings-modal select', 'nord-dark');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // 在页面里注册一个与 App 完全相同的 bubble 监听器做对照
  const result = await page.evaluate(async () => {
    const m = await import('/src/state/settings.ts');
    const settings = m.settings;
    const comboMatches = m.comboMatches;
    const { state } = await import('/src/state/store.ts');
    const before = state.sidebarCollapsed;
    window.__probe = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { window.__probeHit = 'early-return:' + tag; return; }
      const combo = settings.shortcuts.toggleSidebar;
      const m = comboMatches(e, combo);
      window.__probeHit = m ? 'MATCH ' + combo : 'no-match ' + combo + ' key=' + e.key;
      if (m) { e.preventDefault(); state.sidebarCollapsed = !state.sidebarCollapsed; }
    };
    window.addEventListener('keydown', window.__probe);
    return { before };
  });
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(300);
  const out = await page.evaluate(() => ({ hit: window.__probeHit, after: window.__appState ? null : null }));
  const afterState = await page.evaluate(async () => (await import('/src/state/store.ts')).state.sidebarCollapsed);
  console.log('probe 结果:', JSON.stringify(out.hit), '| state:', result.before, '→', afterState);
  await browser.close();
})();
