// 决定性测试：块内真实 IME composition 输入是否进 doc
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/嵌入测试.md'));
  await page.waitForTimeout(4500);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/嵌入测试.md'] = 'doctype:demo\n\n# 嵌入测试\n\n![[笔记/周报]]\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/嵌入测试.md'));
  await page.waitForTimeout(5000);
  const zli = page.locator('.ref-file-block li').first();
  await zli.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const zbox = await zli.boundingBox();
  await page.mouse.click(zbox.x + 25, zbox.y + 8);
  await page.waitForTimeout(500);
  // 1. IME 组合输入（Playwright 官方 IME 模拟）
  try {
    await page.keyboard.imeSetComposition('组合', { selection: 2 });
    await page.waitForTimeout(800);
    const during = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => x.textContent.includes('组合'));
      return b ? 'yes' : 'no';
    });
    console.log('[debug] 组合中块DOM含文本:', during);
    // 提交组合（insertText 提交）
    await page.keyboard.insertText('组合');
    await page.waitForTimeout(1200);
  } catch (e) {
    console.log('[debug] imeSetComposition 失败:', String(e).slice(0, 100));
  }
  let d = await page.evaluate(() => window.__writebackDiag());
  const blockHas = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => x.textContent.includes('组合'));
    return b ? 'yes' : 'no';
  });
  console.log('[debug] IME 提交后块DOM:', blockHas, 'dirty:', JSON.stringify(d.tabs.map(t => ({ t: t.tab, dirty: t.dirty, blocks: t.currentBlocks }))));
  const zhou = d.tabs.find(t => t.tab === '笔记/嵌入测试.md')?.currentBlocks?.['笔记/周报'];
  ok('IME 组合输入进块（len > 305）', zhou && zhou.len > 305);
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
