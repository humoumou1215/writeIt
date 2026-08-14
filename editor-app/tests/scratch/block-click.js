const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/嵌入测试.md'] = 'doctype:demo\n\n# 嵌入测试\n\n![[笔记/周报]]\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  // 先打开周报（A），再打开嵌入测试（B）——多标签场景
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(4500);
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(400);
  // 笔记目录可能已展开（toggle 会收起）——直接尝试点嵌入测试.md
  const target = page.locator('.tree .name', { hasText: '嵌入测试.md' });
  if (await target.count() === 0) {
    await page.locator('.tree .node', { hasText: '笔记' }).first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('.tree .name', { hasText: '嵌入测试.md' }).click();
  await page.waitForTimeout(5000);
  // 点击块内第一个列表项
  const li = page.locator('.ref-file-block li').first();
  const box = await li.boundingBox().catch(() => null);
  console.log('[debug] li box:', JSON.stringify(box));
  if (box) {
    await page.mouse.click(box.x + 25, box.y + 8);
    await page.waitForTimeout(400);
    await page.keyboard.press('End');
    await page.keyboard.type('点击输入测试');
    await page.waitForTimeout(800);
  }
  const st = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('周报'));
    const md = window.__editorGetMarkdown ? window.__editorGetMarkdown() : '';
    return {
      blockHasNew: b ? b.textContent.includes('点击输入测试') : 'no-block',
      hostHasNew: md.includes('点击输入测试'),
    };
  });
  console.log('[debug] 块含新文本:', st.blockHasNew, '宿主含新文本:', st.hostHasNew);
  await browser.close();
})();
