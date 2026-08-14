// 用户环境重建：引用演示含周报块 + demo 块 → 点击周报块输入 → 全链路
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { const t = m.text(); if (t.includes('[writeback]') || t.includes('[sync]')) console.log('LOG:', t.slice(0, 160)); });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  const diag = () => page.evaluate(() => window.__writebackDiag());
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  // 引用演示加周报块 + demo 块（对齐用户环境）
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    let z = fs.files['引用演示.md'] || '';
    if (!z.includes('![[笔记/周报]]')) z += '\n## 周报嵌入\n\n![[笔记/周报]]\n';
    if (!z.includes('![[template/demo/demo]]')) z += '\n![[template/demo/demo]]\n';
    fs.files['引用演示.md'] = z;
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('引用演示.md'));
  await page.waitForTimeout(5500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/周报.md'));
  await page.waitForTimeout(4500);
  // 激活引用演示 → 点周报块 li → 输入
  await page.locator('.tabbar .tab', { hasText: '引用演示' }).click();
  await page.waitForTimeout(1200);
  const zhouBlock = page.locator('.ref-file-block', { has: page.locator('.ref-file-block-path', { hasText: '周报' }) }).first();
  // 滚动到周报块
  await zhouBlock.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  // 测 A：点击块内标题文字（# 周报）
  const zhead = zhouBlock.locator('h1, h2').first();
  let zbox = await zhead.boundingBox().catch(() => null);
  console.log('[debug] 块标题 box:', JSON.stringify(zbox));
  if (zbox) {
    await page.mouse.click(zbox.x + 30, zbox.y + 10);
    await page.waitForTimeout(400);
    await page.keyboard.type('用户输入X');
    await page.waitForTimeout(2000);
  }
  let bHas1 = await zhouBlock.textContent().then(t => t.includes('用户输入X')).catch(() => 'err');
  console.log('[debug] 标题点击后块含新文本:', bHas1);
  // 测 B：点击块内空白（标题与列表之间）
  if (!bHas1) {
    const zbox2 = await zhouBlock.boundingBox();
    if (zbox2) {
      await page.mouse.click(zbox2.x + 100, zbox2.y + zbox2.height - 20);
      await page.waitForTimeout(400);
      await page.keyboard.type('空白输入Y');
      await page.waitForTimeout(2000);
    }
  }
  const bHas2 = await zhouBlock.textContent().then(t => t.includes('空白输入Y') || t.includes('用户输入X')).catch(() => 'err');
  console.log('[debug] 空白点击后块含新文本:', bHas2);
  let d = await diag();
  const bHas = await zhouBlock.textContent().then(t => t.includes('用户输入X')).catch(() => 'err');
  console.log('[debug] 周报块含新文本:', bHas);
  console.log('[debug] diag:', JSON.stringify(d.tabs.map(t => ({ t: t.tab, dirty: t.dirty, mdLen: t.mdLen, ue: t.userEditedAt, les: t.lastExternalSyncAt, noU: t.noUserEditsSinceSync }))));
  ok('输入进周报块', bHas2 === true);
  ok('B dirty（块编辑）', d.tabs.find(t => t.tab === '引用演示.md')?.dirty === true);
  ok('A 脏亮（联动）', d.tabs.find(t => t.tab === '笔记/周报.md')?.dirty === true);
  // B 保存 → A 同步
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(3000);
  d = await diag();
  console.log('[debug] 保存后 diag:', JSON.stringify(d.tabs.map(t => ({ t: t.tab, dirty: t.dirty, ue: t.userEditedAt, les: t.lastExternalSyncAt }))));
  ok('保存后 B 脏灭', d.tabs.find(t => t.tab === '引用演示.md')?.dirty === false);
  ok('保存后 A 脏灭', d.tabs.find(t => t.tab === '笔记/周报.md')?.dirty === false);
  ok('A lastExternalSyncAt > 0（联动过）', d.tabs.find(t => t.tab === '笔记/周报.md')?.lastExternalSyncAt > 0);
  const disk = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return (fs.files['笔记/周报.md'] || '').includes('用户输入X');
  });
  ok('A 磁盘同步', disk);
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
