const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    let z = fs.files['引用演示.md'] || '';
    if (!z.includes('![[笔记/周报]]')) z += '\n\n![[笔记/周报]]\n';
    fs.files['引用演示.md'] = z;
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('引用演示.md'));
  await page.waitForTimeout(6000);
  const block = page.locator('.ref-file-block').first();
  const li = block.locator('li').first();
  await li.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  const box = await li.boundingBox().catch(() => null);
  console.log('[debug] li:', JSON.stringify(box));
  if (box) {
    await page.mouse.click(box.x + 25, box.y + 8);
    await page.waitForTimeout(500);
    await page.keyboard.type('Q1');
    await page.waitForTimeout(1000);
  }
  const res = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    return { mdHasQ1: md.includes('Q1') };
  });
  console.log('[debug] 无 header 实验 输入进 doc:', JSON.stringify(res));
  await browser.close();
})();
