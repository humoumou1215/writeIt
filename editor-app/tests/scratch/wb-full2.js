// 完整链路：块内真实 beforeinput 输入 → 脏 → 联动 → 保存写回
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 250)));
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  const diag = () => page.evaluate(() => window.__writebackDiag());
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['引用演示.md'] = 'doctype:demo\n\n# 引用机制演示\n\n## 周报嵌入\n\n![[笔记/周报]]\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('引用演示.md'));
  await page.waitForTimeout(5500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/周报.md'));
  await page.waitForTimeout(4500);
  // 回引用演示 → 点块内 li → beforeinput 输入
  await page.locator('.tabbar .tab', { hasText: '引用演示' }).click();
  await page.waitForTimeout(1200);
  const block = page.locator('.ref-file-block').first();
  const li = block.locator('li').first();
  await li.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  const box = await li.boundingBox();
  await page.mouse.click(box.x + 25, box.y + 8);
  await page.waitForTimeout(500);
  const ins = await page.evaluate(() => {
    const li = document.querySelector('.ref-file-block li');
    if (!li) return 'no-li';
    const ev = new InputEvent('beforeinput', { inputType: 'insertText', data: '全链路X', bubbles: true, cancelable: true, composed: true });
    li.dispatchEvent(ev);
    return 'sent';
  });
  await page.waitForTimeout(2000);
  let d = await diag();
  const bHas = await block.textContent().then(t => t.includes('全链路X')).catch(() => 'err');
  ok('输入进块内容', bHas === true);
  const bTab = d.tabs.find(t => t.tab === '引用演示.md');
  ok('B 脏灯亮', bTab?.dirty === true);
  const aTab = d.tabs.find(t => t.tab === '笔记/周报.md');
  ok('A 脏灯亮（联动）', aTab?.dirty === true);
  console.log('[debug] 输入后 diag:', JSON.stringify(d.tabs.map(t => ({ t: t.tab, dirty: t.dirty, blocks: t.currentBlocks }))));
  // B 保存 → 写回
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(3000);
  d = await diag();
  const disk = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return (fs.files['笔记/周报.md'] || '').includes('全链路X');
  });
  ok('A 磁盘同步', disk);
  ok('B 脏灭', d.tabs.find(t => t.tab === '引用演示.md')?.dirty === false);
  ok('A 脏灭', d.tabs.find(t => t.tab === '笔记/周报.md')?.dirty === false);
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
