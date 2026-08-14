// 问题 2：A（源文件）编辑保存 → B（已打开，嵌入 A）的块应刷新
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/嵌入测试.md'] = 'doctype:demo\n\n# 嵌入测试\n\n![[笔记/周报]]\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  // B 先打开
  await page.locator('.tree .name', { hasText: '嵌入测试.md' }).click();
  await page.waitForTimeout(5000);
  const bBefore = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('周报'));
    return b ? b.textContent.includes('源文件同步测试') : 'no';
  });
  // 打开 A（周报）——侧边栏展开
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(400);
  if (await page.locator('.tree .name', { hasText: '周报.md' }).count() === 0) {
    await page.locator('.tree .node', { hasText: '笔记' }).first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(4500);
  // A 编辑：末尾加文本
  await page.evaluate(() => window.__editorGoEnd && window.__editorGoEnd());
  await page.keyboard.press('Enter');
  await page.keyboard.type('源文件同步测试');
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2500);
  // 切回 B → 块应刷新
  await page.locator('.tabbar .tab', { hasText: '嵌入测试' }).click();
  await page.waitForTimeout(2000);
  const bAfter = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('周报'));
    return b ? b.textContent.includes('源文件同步测试') : 'no';
  });
  ok('B 的嵌入块刷新（A 保存后）', bAfter === true);
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
