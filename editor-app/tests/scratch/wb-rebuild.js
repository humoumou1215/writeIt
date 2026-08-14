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
  await page.evaluate(() => { window.__fbvCount = 0; });
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('引用演示.md'));
  await page.waitForTimeout(6000);
  const st = await page.evaluate(() => {
    const li = document.querySelector('.ref-file-block-content li');
    const p = document.querySelector('.ref-file-block-content p');
    return {
      fbvCount: window.__fbvCount,
      liPm: li ? !!li.pmViewDesc : 'no-li',
      pPm: p ? !!p.pmViewDesc : 'no-p',
      pCls: p ? p.className.toString().slice(0, 20) : 'no-p',
    };
  });
  console.log('[debug] 物化后:', JSON.stringify(st));
  await browser.close();
})();
