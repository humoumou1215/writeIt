const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 复刻
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
  // 检查焦点和所有 keydown 监听器
  const info = await page.evaluate(() => {
    const ae = document.activeElement;
    return {
      focusedTag: ae?.tagName,
      focusedClass: ae?.className || '',
      focusedInEditor: !!ae?.closest?.('.milkdown'),
      bodyFocused: ae === document.body,
    };
  });
  console.log('焦点状态:', JSON.stringify(info));
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  console.log('Ctrl+B 后 collapsed:', await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed')));
  await browser.close();
})();
