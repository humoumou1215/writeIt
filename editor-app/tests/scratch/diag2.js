const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  // 打开会议记录.md
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '会议记录.md' }).click();
  await page.waitForTimeout(2500);

  // 检查任务列表 DOM
  const taskInfo = await page.evaluate(() => {
    const md = document.querySelector('.milkdown .ProseMirror');
    if (!md) return 'no editor';
    const lis = md.querySelectorAll('li');
    const taskLis = Array.from(lis).filter(li => li.dataset.itemType === 'task');
    return {
      lis: lis.length,
      taskLis: taskLis.length,
      checkboxes: md.querySelectorAll('input[type=checkbox]').length,
      checkboxCls: md.querySelectorAll('input').length ? Array.from(md.querySelectorAll('input')).map(i => i.className || i.type) : [],
    };
  });
  console.log('任务列表 DOM:', JSON.stringify(taskInfo));

  // 打开待办清单（含任务列表）
  await page.locator('.tree .name', { hasText: '待办清单.md' }).click();
  await page.waitForTimeout(2000);
  const taskInfo2 = await page.evaluate(() => {
    const md = document.querySelector('.milkdown .ProseMirror');
    const lis = md.querySelectorAll('li');
    return { lis: lis.length, taskLis: Array.from(lis).filter(li => li.dataset.itemType === 'task').length };
  });
  console.log('待办清单任务 DOM:', JSON.stringify(taskInfo2));

  // 中键关闭测试
  const tabsBefore = await page.locator('.tab').count();
  await page.locator('.tab', { hasText: '待办清单.md' }).click({ button: 'middle' });
  await page.waitForTimeout(1000);
  const tabsAfter = await page.locator('.tab').count();
  const modalVisible = await page.isVisible('.modal').catch(() => false);
  console.log(`中键关闭: 前 ${tabsBefore} → 后 ${tabsAfter}, 确认框: ${modalVisible}`);
  await browser.close();
})();
