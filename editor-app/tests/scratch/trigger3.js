const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (t.includes('[ref]')) console.log(t.slice(0, 140)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.sidebar-actions .mini', { hasText: '＋文件' }).click();
  await page.waitForTimeout(300);
  await page.locator('.tree .rename-input').fill('菜单调试2.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  // 复刻步骤 1-3：[[ 会议 Enter
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[');
  await page.waitForTimeout(500);
  await page.keyboard.type('会议');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const st = await page.evaluate(async () => {
    const m = await import('/src/editor/ref/menu/index.ts');
    return { visible: m.refMenuState.visible, mode: m.refMenuState.mode };
  });
  console.log('步骤3后菜单状态:', JSON.stringify(st));
  // 步骤 4：freshPara + ![[待办
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('![[待办');
  await page.waitForTimeout(600);
  console.log('步骤4后菜单组数:', await page.locator('[data-ref-menu] .menu-group').count());
  await browser.close();
})();
