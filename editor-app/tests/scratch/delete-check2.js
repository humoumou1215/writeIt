const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || t.includes('删除')) console.log('[' + m.type() + ']', t.slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 直接测 mock fs.remove
  const r = await page.evaluate(async () => {
    const { fs } = await import('/src/fs/index.ts');
    try {
      await fs.remove('Mermaid 图表集.md');
      const ls = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2'));
      return { ok: true, exists: 'Mermaid 图表集.md' in ls.files };
    } catch (e) {
      return { ok: false, err: String(e).slice(0, 200) };
    }
  });
  console.log('直接 fs.remove 结果:', JSON.stringify(r));
  await browser.close();
})();
