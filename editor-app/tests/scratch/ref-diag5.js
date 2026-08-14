const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  const treeNames = await page.locator('.tree .name').allTextContents();
  console.log('树内文件:', JSON.stringify(treeNames));
  const hasRef = treeNames.some(t => t.includes('引用演示'));
  console.log('含 引用演示:', hasRef);
  if (hasRef) {
    await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
    await page.waitForTimeout(2500);
    const tabs = await page.locator('.tab-name').allTextContents();
    const milkdown = await page.locator('.milkdown').count();
    console.log('点击后标签:', JSON.stringify(tabs), '| milkdown 数量:', milkdown);
    const st = await page.evaluate(async () => {
      const m = await import('/src/state/store.ts');
      return { active: m.state.activeTabId, tabs: m.state.tabs.map(t => t.name) };
    });
    console.log('store 状态:', JSON.stringify(st));
  }
  await browser.close();
})();
