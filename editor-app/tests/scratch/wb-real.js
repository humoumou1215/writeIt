// 复现用户：真实点击块内输入 → A 联动 + 脏灯
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { const t = m.text(); if (t.includes('[sync]') || t.includes('[writeback]')) console.log('LOG:', t.slice(0, 150)); });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  const dirtyState = () => page.evaluate(() => {
    return Array.from(document.querySelectorAll('.tabbar .tab')).map(t => ({
      name: t.querySelector('.tab-name')?.textContent?.trim(),
      dirty: !!t.querySelector('.dot.dirty'),
    }));
  });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/嵌入测试.md'] = 'doctype:demo\n\n# 嵌入测试\n\n![[笔记/周报]]\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/周报.md'));
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/嵌入测试.md'));
  await page.waitForTimeout(4500);
  // 真实点击 B 的块内某行 → 直接输入
  const li = page.locator('.ref-file-block li').first();
  const box = await li.boundingBox().catch(() => null);
  console.log('[debug] li box:', JSON.stringify(box));
  if (box) {
    await page.mouse.click(box.x + 25, box.y + 8);
    await page.waitForTimeout(500);
    await page.keyboard.type('真实输入测试');
    await page.waitForTimeout(2500);
  }
  const st = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('周报'));
    return {
      blockHasNew: b ? b.textContent.includes('真实输入测试') : 'no-block',
      hostHasNew: (window.__editorGetMarkdown() || '').includes('真实输入测试'),
    };
  });
  console.log('[debug] 块含新文本:', st.blockHasNew, '宿主含新文本:', st.hostHasNew);
  ok('输入进块', st.blockHasNew === true);
  let ds = await dirtyState();
  console.log('[debug] 脏状态:', JSON.stringify(ds));
  ok('B 脏灯亮', ds.find(t => t.name.includes('嵌入测试'))?.dirty === true);
  ok('A 脏灯亮', ds.find(t => t.name.includes('周报'))?.dirty === true);
  // B 保存 → A 更新
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2500);
  const disk = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return (fs.files['笔记/周报.md'] || '').includes('真实输入测试');
  });
  const cur = await page.evaluate(async () => {
    // 切到 A 看内容尾部
    return '';
  });
  ok('B 保存后 A 磁盘同步', disk);
  ds = await dirtyState();
  console.log('[debug] 保存后脏:', JSON.stringify(ds));
  ok('B 保存后 B 脏灭', ds.find(t => t.name.includes('嵌入测试'))?.dirty === false);
  ok('B 保存后 A 脏灭', ds.find(t => t.name.includes('周报'))?.dirty === false);
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
