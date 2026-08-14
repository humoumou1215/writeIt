const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { if (m.text().includes('[dbg]')) console.log('LOG:', m.text().slice(0, 300)); });
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
  await page.evaluate(async () => {
    const ed = window.__editorDebug();
    ed.action(async (ctx) => {
      const { editorViewCtx } = await import('@milkdown/kit/core');
      const doc = ctx.get(editorViewCtx).state.doc;
      const firsts = [];
      doc.forEach((n) => {
        firsts.push(n.type.name + ':' + (n.textContent || '').slice(0, 30));
      });
      console.log('[dbg] top nodes:', JSON.stringify(firsts));
      // 手动提取
      let firstLine = '';
      doc.forEach((node) => {
        if (firstLine) return;
        if (node.isTextblock && node.textContent) firstLine = node.textContent.trim();
      });
      console.log('[dbg] firstLine=', JSON.stringify(firstLine));
      const re = /^doctype\s*:\s*([A-Za-z0-9_\-]+)\s*$/;
      console.log('[dbg] match=', re.test(firstLine));
    });
  });
  await page.waitForTimeout(1200);
  await browser.close();
})();
