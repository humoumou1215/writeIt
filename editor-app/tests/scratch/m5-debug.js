const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/周报.md'] = 'doctype:demo\n\n# 周报\n\n你好\n\n## 版本\n\nv0.2.1\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => {
    const ed = window.__editorDebug && window.__editorDebug();
    let docFirstLine = null, templateCount = null, doctype = null;
    if (ed) {
      ed.action((ctx) => {
        try {
          const { editorViewCtx } = require ? {} : {};
        } catch {}
      });
    }
    // 直接从编辑器 markdown 看首行
    const md = window.__editorGetMarkdown ? window.__editorGetMarkdown() : null;
    docFirstLine = md ? md.split('\n')[0] : null;
    return { docFirstLine, panel: document.querySelector('.validate-panel')?.textContent?.slice(0, 80) ?? 'NO' };
  });
  console.log('state:', JSON.stringify(st));
  await browser.close();
})();
