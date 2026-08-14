const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(4000);
  // 在末尾加需求表（用户场景：3 列，A 后置空）
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const table = '## 需求\n| 前置 | 后置 | 第三列 |\n| :--- | :--- | :--- |\n| A |  |  |';
    const pm = document.querySelector('.ProseMirror');
    pm.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', table);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    pm.dispatchEvent(ev);
  });
  await page.waitForTimeout(2000);
  // 检查单元格解析结果
  const st = await page.evaluate(() => {
    const ed = window.__editorDebug();
    let out = null;
    ed.action((ctx) => {
      const { editorViewCtx } = window.__proto__ ? { editorViewCtx: null } : {};
    });
    // 直接看 DOM 单元格
    const cells = Array.from(document.querySelectorAll('.ProseMirror td, .ProseMirror th'));
    const cellTexts = cells.map(c => JSON.stringify(c.textContent));
    // markdown 序列化
    const md = window.__editorGetMarkdown();
    const last = md.split('## 需求')[1] || '';
    return { cellTexts, tableMd: last.slice(0, 300) };
  });
  console.log('单元格 textContent:', JSON.stringify(st.cellTexts));
  console.log('表格 md:', JSON.stringify(st.tableMd));
  // ⚠ 的 DOM 位置 + 表格列数
  const pos = await page.evaluate(() => {
    const marks = Array.from(document.querySelectorAll('.validate-mark'));
    const table = document.querySelector('.ProseMirror table');
    const firstRow = table ? table.querySelector('tr') : null;
    const colCount = firstRow ? firstRow.children.length : 0;
    return {
      marks: marks.map(m => {
        const cell = m.closest('td, th');
        return { inCell: cell ? cell.textContent.slice(0, 10) : 'NO-CELL', x: Math.round(m.getBoundingClientRect().left) };
      }),
      colCount,
    };
  });
  console.log('⚠ 位置与列数:', JSON.stringify(pos));
  await browser.close();
})();
