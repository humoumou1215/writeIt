const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(async () => {
    const { fs } = await import('/src/fs/index.ts');
    await fs.createFile('探针文件');
    await fs.writeFile('探针文件', 'x');
    const tree = await fs.readTree(true);
    const has = tree.some(n => n.name === '探针文件');
    const raw = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return { has, inRaw: '探针文件' in (raw.files || {}) };
  });
  console.log('mock 探针:', JSON.stringify(r));
  await browser.close();
})();
