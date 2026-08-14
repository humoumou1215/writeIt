const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['引用演示.md'] = 'doctype:demo\n\n# 引用机制演示\n\n## 周报嵌入\n\n![[笔记/周报]]\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('引用演示.md'));
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => {
    const content = document.querySelector('.ref-file-block-content');
    const walk = (el, depth, acc) => {
      if (!el || depth > 4) return;
      const d = el.pmViewDesc;
      acc.push({
        tag: el.nodeName, depth,
        pm: d ? d.constructor.name : 'NONE',
        cls: (el.className || '').toString().slice(0, 25),
        kids: el.childNodes.length,
      });
      for (const c of el.childNodes) walk(c, depth + 1, acc);
    };
    const acc = [];
    walk(content, 0, acc);
    return acc.slice(0, 25);
  });
  console.log('[debug] 块内容 DOM pmViewDesc:', JSON.stringify(info, null, 1));
  await browser.close();
})();
