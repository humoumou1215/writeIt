const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { const t = m.text(); if (t.includes('[writeback]')) console.log('LOG:', t.slice(0, 150)); });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  // 建 B 文档嵌入周报
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/嵌入测试.md'] = 'doctype:demo\n\n# 嵌入测试\n\n![[笔记/周报]]\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '嵌入测试.md' }).click();
  await page.waitForTimeout(5000);
  const before = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return fs.files['笔记/周报.md'] || 'MISSING';
  });
  console.log('[debug] 周报前 len:', before.length);
  // 在周报块内末尾插入新段落
  const res = await page.evaluate(() => (window.__editorBlockAppend && window.__editorBlockAppend('周报', '回写复现条目')) ?? 'no-hook');
  console.log('[debug] append:', res);
  await page.waitForTimeout(800);
  // 保存
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return fs.files['笔记/周报.md'] || 'MISSING';
  });
  console.log('[debug] 周报后 len:', after.length, '含新条目:', after.includes('回写复现条目'));
  ok('写回：周报.md 同步新条目', after.includes('回写复现条目'));
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
