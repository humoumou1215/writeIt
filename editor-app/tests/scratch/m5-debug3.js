const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/周报.md'] = 'doctype:demo\n\n# 周报\n\n你好\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(4500);
  const out = await page.evaluate(async () => {
    const ed = window.__editorDebug();
    const res = await new Promise((resolve) => {
      ed.action((ctx) => {
        const { editorViewCtx } = ctx;
        const doc = ctx.get(editorViewCtx).state.doc;
        const firsts = [];
        doc.forEach((n) => firsts.push(n.type.name + ':' + (n.textContent || '').slice(0, 20)));
        let firstLine = '';
        doc.forEach((node) => {
          if (firstLine) return;
          if (node.isTextblock && node.textContent) firstLine = node.textContent.trim();
        });
        resolve({ firsts, firstLine });
      });
    });
    return res;
  });
  console.log('RESULT:', JSON.stringify(out));
  await browser.close();
})();
