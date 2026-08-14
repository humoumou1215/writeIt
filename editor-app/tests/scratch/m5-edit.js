// ⚠ 标注不拦截输入：标注后能在单元格内输入文字
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(4000);
  // 粘贴 3 列需求表（A | 空 | 空）→ ⚠ 出现
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const table = '## 需求\n| 前置 | 后置 | 第三列 |\n| :--- | :--- | :--- |\n| A |  |  |';
    const pm = document.querySelector('.ProseMirror');
    pm.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', table);
    pm.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(2500);
  const marks = await page.locator('.validate-mark').count();
  ok('⚠ 标注出现', marks > 0);
  const tdCount = await page.locator('.ProseMirror td').count();
  console.log('[debug] td 数量:', tdCount);

  // 点击后置空单元格（⚠ 所在单元格）→ 输入文字
  const cell = page.locator('.ProseMirror td').nth(3); // 数据行第 2 格（后置）
  await cell.click();
  await page.waitForTimeout(300);
  await page.keyboard.type('B');
  await page.waitForTimeout(1200);
  const cellText = await page.locator('.ProseMirror td').nth(3).textContent();
  ok('⚠ 单元格内可输入（输入 B 成功）', (cellText || '').includes('B'));

  // 输入后 ⚠ 应消失（违规解决：后置已填）——等防抖重校验
  await page.waitForTimeout(2200);
  const marks2 = await page.locator('.validate-mark').count();
  ok('输入后 ⚠ 消失（违规解决）', marks2 === 0);
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  ok('序列化含 B', md.includes('| A  | B'));
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
