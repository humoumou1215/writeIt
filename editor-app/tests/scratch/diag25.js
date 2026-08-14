const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '会议记录.md' }).click();
  await page.waitForTimeout(2000);
  // 读取实际树 + 计算 flatFiles
  const info = await page.evaluate(async () => {
    const { state } = await import('/src/state/store.ts');
    const flat = [];
    const walk = (list) => {
      for (const e of list) {
        if (e.kind === 'file') flat.push(e.path);
        else if (e.children) walk(e.children);
      }
    };
    walk(state.tree);
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    return { flat, activePath: activeTab?.path, idx: flat.indexOf(activeTab?.path || '') };
  });
  console.log('flatFiles:', JSON.stringify(info.flat));
  console.log('activePath:', info.activePath, '| idx:', info.idx, '| 下一个应为:', info.flat[info.idx + 1]);
  await browser.close();
})();
