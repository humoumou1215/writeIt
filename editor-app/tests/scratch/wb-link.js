// 场景 1：编辑 B 块 → B 脏 + A 脏（A 打开）→ 在 B 保存 → A、B 脏灭 + 内容都保存
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  page.on('console', (m) => { const t = m.text(); if (t.includes('[sync]') || t.includes('[writeback]')) console.log('LOG:', t.slice(0, 200)); });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  const openInTree = async (name) => {
    const path = name.includes('周报') ? '笔记/周报.md' : '笔记/嵌入测试.md';
    await page.evaluate((p) => window.__editorOpenPath && window.__editorOpenPath(p), path);
    await page.waitForTimeout(4500);
  };
  const dirtyState = () => page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.tabbar .tab')).map(t => ({
      name: t.querySelector('.tab-name')?.textContent?.trim(),
      dirty: !!t.querySelector('.dot.dirty'),
    }));
    return tabs;
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
  // A 打开
  await openInTree('周报.md');
  // B 打开
  await openInTree('嵌入测试.md');
  // 编辑 B 块
  await page.evaluate(() => window.__editorBlockAppend && window.__editorBlockAppend('周报', '联动测试条目'));
  await page.waitForTimeout(2000); // 等防抖联动
  let st = await dirtyState();
  ok('B 脏灯亮（块编辑）', st.find(t => t.name.includes('嵌入测试'))?.dirty === true);
  ok('A 脏灯亮（联动）', st.find(t => t.name.includes('周报'))?.dirty === true);
  // A 标签内容已刷新为最新（含新条目）
  await page.locator('.tabbar .tab', { hasText: '周报' }).click();
  await page.waitForTimeout(1200);
  const aContent = await page.evaluate(() => window.__editorGetMarkdown());
  ok('A 标签内容已刷新（含联动条目）', aContent.includes('联动测试条目'));
  // 在 B 保存
  await page.locator('.tabbar .tab', { hasText: '嵌入测试' }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2500);
  st = await dirtyState();
  ok('保存后 B 脏灭', st.find(t => t.name.includes('嵌入测试'))?.dirty === false);
  ok('保存后 A 脏灭', st.find(t => t.name.includes('周报'))?.dirty === false);
  const disk = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return (fs.files['笔记/周报.md'] || '').includes('联动测试条目');
  });
  ok('A 磁盘已同步', disk);
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
