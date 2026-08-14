const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['引用演示.md'] = 'doctype:demo\n\n# 测试\n\n- 列表项一\n- 列表项二\n\n普通段落。\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('引用演示.md'));
  await page.waitForTimeout(5000);
  const li = page.locator('.ProseMirror li').first();
  await li.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  const box = await li.boundingBox().catch(() => null);
  console.log('[debug] 宿主 li box:', JSON.stringify(box));
  if (box) {
    await page.mouse.click(box.x + 25, box.y + 8);
    await page.waitForTimeout(400);
    await page.keyboard.type('L1');
    await page.waitForTimeout(800);
  }
  const res = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    return { mdHasL1: md.includes('L1') };
  });
  console.log('[debug] 宿主列表输入进 doc:', JSON.stringify(res));
  await browser.close();
})();
