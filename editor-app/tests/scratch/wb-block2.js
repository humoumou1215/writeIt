const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 250)));
  page.on('console', (m) => { const t = m.text(); if (t.includes('[fbv]')) console.log('LOG:', t.slice(0, 150)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    // 干净引用演示：标准内容 + 周报块
    fs.files['引用演示.md'] = 'doctype:demo\n\n# 引用机制演示\n\n## 周报嵌入\n\n![[笔记/周报]]\n';
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
  console.log('[debug] li box:', JSON.stringify(box));
  if (box) {
    await page.mouse.click(box.x + 25, box.y + 8);
    await page.waitForTimeout(500);
    // 真实键盘输入（Playwright type —— 走 DOMObserver 路径）
    await page.keyboard.type('K1');
    await page.waitForTimeout(1000);
  }
  const res = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    const sel = window.__editorSelection();
    // 检查块内容（物化内容的序列化）
    const b = document.querySelector('.ref-file-block');
    return {
      mdHasZ: md.includes('块输入Z'),
      mdLen: md.length,
      blockHasZ: b ? b.textContent.includes('Z1') : 'no-block',
      sel,
    };
  });
  console.log('[debug] 块内输入结果:', JSON.stringify(res));
  await browser.close();
})();
