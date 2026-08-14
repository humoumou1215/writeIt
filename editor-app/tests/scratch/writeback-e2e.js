// §6.7 写回事务：编辑嵌入内容 → Ctrl+S → 源文件同步
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  page.on('console', (m) => { const t = m.text(); if (t.includes('[writeback]')) console.log('LOG:', t.slice(0, 200)); });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  // 源文件内容
  const srcBefore = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return fs.files['笔记/待办清单.md'] || 'MISSING';
  });
  console.log('[debug] 源文件前:', JSON.stringify(srcBefore.slice(0, 60)));
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);
  // 找待办清单嵌入块，在块内末尾输入一行
  const blocks = await page.locator('.ref-file-block').count();
  ok('嵌入块渲染', blocks > 0);
  await page.evaluate(() => {
    window.__editorGoBlockEnd && window.__editorGoBlockEnd('待办清单');
  });
  await page.keyboard.press('Enter');
  await page.keyboard.type('写回测试新条目');
  await page.waitForTimeout(1200);
  const dbg = await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll('.ref-file-block')).find(b => (b.querySelector('.ref-file-block-path')?.textContent || '').includes('待办清单'));
    const host = window.__editorGetMarkdown ? window.__editorGetMarkdown() : '';
    return {
      blockText: block ? block.textContent.slice(-80) : 'NO BLOCK',
      hostTail: host.slice(-120),
    };
  });
  console.log('[debug] 块内:', JSON.stringify(dbg.blockText));
  console.log('[debug] 宿主尾部:', JSON.stringify(dbg.hostTail));
  // 脏检测：嵌入编辑应标记 dirty（状态栏"未保存"）
  const dirty = await page.evaluate(() => document.querySelector('.statusbar .active-file')?.textContent?.includes('未保存') ?? false);
  ok('嵌入编辑后 dirty（双条件脏检测）', dirty);
  // Ctrl+S
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2000);
  const srcAfter = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return fs.files['笔记/待办清单.md'] || 'MISSING';
  });
  console.log('[debug] 源文件后:', JSON.stringify(srcAfter.slice(-60)));
  ok('源文件已同步（含新条目）', srcAfter.includes('写回测试新条目'));
  ok('源文件未丢失原内容', srcAfter.includes('待办清单') && srcAfter.includes('支持自动保存'));
  await browser.close();
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
