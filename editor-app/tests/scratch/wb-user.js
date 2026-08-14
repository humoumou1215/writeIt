// 复现用户环境：引用演示.md（多块）+ 周报.md → 点击块内不同位置输入
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  const diag = () => page.evaluate(() => window.__writebackDiag());
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('引用演示.md'));
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/周报.md'));
  await page.waitForTimeout(4500);
  // 1. 列出引用演示的块
  const blocks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.ref-file-block')).map(b => ({
      path: b.querySelector('.ref-file-block-path')?.textContent,
      readonly: b.classList.contains('readonly'),
      hasLi: !!b.querySelector('li'),
      text: b.textContent.slice(0, 20),
    }));
  });
  console.log('[debug] 块列表:', JSON.stringify(blocks));
  // 1.5 激活引用演示标签
  await page.locator('.tabbar .tab', { hasText: '引用演示' }).click();
  await page.waitForTimeout(1200);
  // 2. 点击周报块内 li 文字 → 输入
  const li = page.locator('.ref-file-block li').first();
  const liBox = await li.boundingBox().catch(() => null);
  if (liBox) {
    await page.mouse.click(liBox.x + 25, liBox.y + 8);
    await page.waitForTimeout(400);
    await page.keyboard.type('点击输入A');
    await page.waitForTimeout(1500);
  }
  let d = await diag();
  const bAfter = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('周报'));
    return b ? b.textContent.includes('点击输入A') : 'no';
  });
  console.log('[debug] li 点击后 块含新文本:', bAfter, 'dirty:', JSON.stringify(d.tabs.map(t => ({ t: t.tab, dirty: t.dirty, mdLen: t.mdLen }))));
  ok('li 点击输入进块', bAfter === true);
  ok('li 点击后 B dirty', d.tabs.find(t => t.tab === '引用演示.md')?.dirty === true);
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
