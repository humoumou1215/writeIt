const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const pages = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 250)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    // 强制重置引用演示为干净内容 + 表格
    fs.files['引用演示.md'] = 'doctype:demo\n\n# 引用机制演示\n\n## 表格测试\n\n| A | B |\n| --- | --- |\n| c1 | c2 |\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('引用演示.md'));
  await page.waitForTimeout(6000);
  const md0 = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('[debug] md 是否含表格语法:', JSON.stringify(md0 ? md0.slice(0, 80) : 'no-ed'));
  // 找宿主表格的单元格
  const td = page.locator('.ProseMirror td').first();
  const c = await td.count();
  console.log('[debug] 宿主表格 td 数:', c);
  if (c > 0) {
    await td.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    // 先移开鼠标（避免手柄显示遮挡），再点单元格内容中心
    await page.mouse.move(50, 50);
    await page.waitForTimeout(400);
    const box = await td.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(400);
      await page.keyboard.type('T1');
      await page.waitForTimeout(800);
    }
  }
  const res = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    return { mdHasT1: md.includes('T1') };
  });
  console.log('[debug] 宿主表格单元格输入进 doc:', JSON.stringify(res));
  await browser.close();
})();
