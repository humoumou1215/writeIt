const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    let z = fs.files['引用演示.md'] || '';
    if (!z.includes('![[笔记/周报]]')) z += '\n\n![[笔记/周报]]\n\n```js\n代码块测试\n```\n';
    fs.files['引用演示.md'] = z;
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('引用演示.md'));
  await page.waitForTimeout(6000);
  // 找代码块（.ProseMirror 内的 pre/code）
  const codePre = page.locator('.ProseMirror pre').first();
  const c = await codePre.count();
  console.log('[debug] 代码块数:', c);
  if (c > 0) {
    await codePre.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    const box = await codePre.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + 30, box.y + 15);
      await page.waitForTimeout(500);
      await page.keyboard.type('CODEX');
      await page.waitForTimeout(800);
    }
  }
  const res = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    return { mdHasCode: md.includes('CODEX') };
  });
  console.log('[debug] 代码块输入进 doc:', JSON.stringify(res));
  await browser.close();
})();
