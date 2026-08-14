const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['引用演示.md'] = 'doctype:demo\n\n# 引用机制演示\n\n## 周报嵌入\n\n![[笔记/周报]]\n\n## 表格\n\n| A | B |\n| --- | --- |\n| c1 | c2 |\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('引用演示.md'));
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => {
    const blockLi = document.querySelector('.ref-file-block li');
    const tableTd = document.querySelector('.ProseMirror td');
    const blockContent = document.querySelector('.ref-file-block-content');
    const p = document.querySelector('.ProseMirror p');
    const getDesc = (el) => {
      let d = el ? el.pmViewDesc : null;
      return d ? { cls: d.constructor.name, isNode: !!d.node, parentCls: d.parent ? d.parent.constructor.name : 'none' } : null;
    };
    return {
      blockLi: getDesc(blockLi),
      tableTd: getDesc(tableTd),
      blockContent: getDesc(blockContent),
      plainP: getDesc(p),
    };
  });
  console.log('[debug] pmViewDesc 对比:', JSON.stringify(info, null, 1));
  await browser.close();
})();
