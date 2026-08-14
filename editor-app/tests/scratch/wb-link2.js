// 场景 2/3：A 保存 → B 脏联动；B 关闭语义
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  const dirtyState = () => page.evaluate(() => {
    return Array.from(document.querySelectorAll('.tabbar .tab')).map(t => ({
      name: t.querySelector('.tab-name')?.textContent?.trim(),
      dirty: !!t.querySelector('.dot.dirty'),
    }));
  });
  const clickTab = async (name) => {
    await page.locator('.tabbar .tab', { hasText: name }).click();
    await page.waitForTimeout(1000);
  };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/嵌入测试.md'] = 'doctype:demo\n\n# 嵌入测试\n\n![[笔记/周报]]\n\n## 其他章节\n\n原始段落。\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/周报.md'));
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/嵌入测试.md'));
  await page.waitForTimeout(4500);

  // 编辑 B 块
  await page.evaluate(() => window.__editorBlockAppend && window.__editorBlockAppend('周报', '场景2条目'));
  await page.waitForTimeout(2000);
  let st = await dirtyState();
  ok('编辑块后 B 脏', st.find(t => t.name.includes('嵌入测试'))?.dirty === true);
  ok('编辑块后 A 脏', st.find(t => t.name.includes('周报'))?.dirty === true);

  // 场景 2：在 A 保存
  await clickTab('周报');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2500);
  st = await dirtyState();
  ok('A 保存后 A 脏灭', st.find(t => t.name.includes('周报'))?.dirty === false);
  ok('A 保存后 B 脏灭（仅块改动）', st.find(t => t.name.includes('嵌入测试'))?.dirty === false);
  const disk2 = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return (fs.files['笔记/周报.md'] || '').includes('场景2条目');
  });
  ok('A 保存写盘含块改动', disk2);

  // 场景 2b：B 有其他改动 → A 保存后 B 脏保持
  await clickTab('嵌入测试');
  await page.evaluate(() => window.__editorGoEnd && window.__editorGoEnd());
  await page.keyboard.press('Enter');
  await page.keyboard.type('B的独立修改');
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__editorBlockAppend && window.__editorBlockAppend('周报', '场景2b条目'));
  await page.waitForTimeout(2000);
  await clickTab('周报');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2500);
  st = await dirtyState();
  ok('A 保存后 A 脏灭', st.find(t => t.name.includes('周报'))?.dirty === false);
  ok('B 有其他改动 → B 脏保持', st.find(t => t.name.includes('嵌入测试'))?.dirty === true);
  // B 保存 → B 脏灭
  await clickTab('嵌入测试');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2500);
  st = await dirtyState();
  ok('B 保存后 B 脏灭', st.find(t => t.name.includes('嵌入测试'))?.dirty === false);
  const diskB = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return (fs.files['笔记/嵌入测试.md'] || '').includes('B的独立修改');
  });
  ok('B 独立修改已保存', diskB);
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
