const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 400)));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || t.includes('mount') || t.includes('create') || t.includes('schema')) console.log(m.type().toUpperCase() + ':', t.slice(0, 300)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/周报.md'] = 'doctype:demo\n\n# 周报\n\n<mark data-note="测试批注">锚定文本</mark> 结尾\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(5000);
  const boot = await page.evaluate(() => {
    const pane = document.querySelector('.editor-pane');
    return { paneHTML: pane ? pane.innerHTML.slice(0, 200) : null, bodyClasses: document.body.className };
  });
  console.log('PANE:', JSON.stringify(boot));
  const st = await page.evaluate(() => {
    return {
      tabs: Array.from(document.querySelectorAll('.tabbar .tab-name')).map(t => t.textContent.trim()),
      editorCount: document.querySelectorAll('.ProseMirror').length,
      marks: document.querySelectorAll('mark.annotation').length,
      marksAny: document.querySelectorAll('mark').length,
      htmlSpans: document.querySelectorAll('span[data-type="html"]').length,
      md: window.__editorGetMarkdown ? window.__editorGetMarkdown() : null,
    };
  });
  console.log('FULL:', JSON.stringify(st));
  await browser.close();
})();
