const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  // 构造一个含 <br /> 单元格的表格文档
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/周报.md'] = 'doctype:demo\n\n# 周报\n\n## 版本\n\nv0.2.1\n\n## 需求\n\n| 前置 | 后置 |\n| --- | --- |\n| A | <br /> |\n| <br /> | B |\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(5000);
  // 检查表格单元格的实际节点结构 + 校验结果
  const st = await page.evaluate(async () => {
    const ed = window.__editorDebug();
    const info = await new Promise((resolve) => {
      ed.action((ctx) => {
        const { editorViewCtx } = ctx;
        const doc = ctx.get(editorViewCtx).state.doc;
        const cells = [];
        doc.descendants((n) => {
          if (n.type.name === 'table_cell' || n.type.name === 'table_header') {
            cells.push({
              name: n.type.name,
              textContent: JSON.stringify(n.textContent),
              childTypes: n.content.content.map((c) => c.type.name + ':' + JSON.stringify(c.textContent || (c.type.name))),
            });
          }
        });
        resolve({ cells, markdown: null });
      });
    });
    const panel = document.querySelector('.validate-panel')?.textContent?.slice(0, 150) ?? 'NO PANEL';
    const marks = await (async () => {
      const m = document.querySelectorAll('.validate-mark');
      return Array.from(m).map(x => ({ level: x.dataset.level, title: x.title }));
    })();
    return { info, panel, marks };
  });
  console.log('单元格:', JSON.stringify(st.info.cells, null, 1));
  console.log('面板:', JSON.stringify(st.panel));
  console.log('标注:', JSON.stringify(st.marks));
  await browser.close();
})();
