const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning' || t.includes('[card]')) console.log(m.type().toUpperCase() + ':', t.slice(0, 300)); });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/周报.md'] = 'doctype:demo\n\n# 周报\n\n这是一段用于测试批注功能的文本内容。\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(4500);
  // 选中"用于测试批注功能"这段文本
  const pm = page.locator('.ProseMirror p', { hasText: '这是一段用于测试批注功能的文本内容' }).first();
  const box = await pm.boundingBox();
  if (!box) { console.log('no box'); process.exit(1); }
  const txtStartX = box.x + 10, txtEndX = box.x + 240;
  await page.mouse.move(txtStartX, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(txtEndX, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const toolbar = await page.locator('.milkdown-toolbar').count();
  ok('选中文本后 toolbar 出现', toolbar > 0);
  const items = await page.evaluate(() => Array.from(document.querySelectorAll('.milkdown-toolbar [data-toolbar-item]')).map(i => i.getAttribute('data-toolbar-item')));
  console.log('[debug] toolbar items:', JSON.stringify(items));
  const tbHTML = await page.evaluate(() => document.querySelector('.milkdown-toolbar')?.outerHTML.slice(0, 500) ?? 'NO');
  console.log('[debug] toolbar html:', JSON.stringify(tbHTML));
  // 点"添加批注"
  const addBtn = page.locator('[data-toolbar-item="add-annotation"]').first();
  if (await addBtn.count() > 0) {
    await addBtn.click();
    await page.waitForTimeout(600);
    const inputVisible = await page.locator('.annotation-input-visible').count();
    ok('批注输入浮窗出现', inputVisible > 0);
    await page.locator('.annotation-input-ta').fill('人工批注内容');
    // 输入浮窗交互：Enter 确认提交（按钮组已改为快捷键交互）
    await page.locator('.annotation-input-ta').press('Enter');
    await page.waitForTimeout(1200);
    const marks = await page.locator('.ProseMirror mark.annotation').count();
    ok('批注节点插入（mark.annotation）', marks > 0);
    const md = await page.evaluate(() => window.__editorGetMarkdown());
    console.log('[debug] md:', JSON.stringify(md.slice(-120)));
    // v7.1：单引号属性 + JSON 双引号原样（不再 &quot; 转义）
    ok('md 含线程 JSON（人工批注内容）', /data-note='[^']*"c":"人工批注内容"/.test(md));
    // 批注卡无删除按钮（v4 决策）
    await page.locator('.ProseMirror mark.annotation').first().click();
    await page.waitForTimeout(800);
    const delBtn = await page.locator('.ad-card.active .mini.danger').count();
    ok('批注卡无删除按钮', delBtn === 0);
    // v6：卡片默认收起，点击头部展开（显示回复输入框）
    await page.locator('.ad-card.active .ad-card-head').first().click();
    await page.waitForTimeout(600);
    // Enter 换行不提交 + ESC 清空
    const rta = page.locator('.ad-card.active .ad-reply textarea');
    await rta.fill('第一行');
    await rta.press('Enter');
    await rta.press('Enter');
    const valEnter = await rta.inputValue();
    ok('Enter 换行不提交', valEnter.includes('\n'));
    await rta.fill('待取消');
    await rta.press('Escape');
    const valEsc = await rta.inputValue();
    ok('ESC 清空草稿', valEsc === '');
    // Ctrl+Enter 提交回复
    await rta.fill('用 Ctrl+Enter 发送的回复');
    await rta.press('Control+Enter');
    await page.waitForTimeout(1200);
    const replyComments = await page.evaluate(() => {
      const card = document.querySelector('.ad-card.active');
      const authors = Array.from(card.querySelectorAll('.ad-comment .ad-author')).map(a => a.textContent);
      const contents = Array.from(card.querySelectorAll('.ad-comment-content')).map(c => c.textContent);
      return { authors, contents };
    });
    ok('Ctrl+Enter 提交回复', replyComments.contents.some(c => c.includes('Ctrl+Enter 发送的回复')));
  } else {
    console.log('❌ add-annotation 按钮不存在');
    fail++;
  }
  // Ctrl+R：选中文字后快速弹评论输入框
  const pm2 = page.locator('.ProseMirror p', { hasText: '这是一段用于测试批注功能的文本内容' }).first();
  const box2 = await pm2.boundingBox();
  if (box2) {
    await page.mouse.move(box2.x + 10, box2.y + box2.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + 200, box2.y + box2.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+r');
    await page.waitForTimeout(700);
    const input2 = await page.locator('.annotation-input-visible').count();
    ok('Ctrl+R 弹出评论输入框', input2 > 0);
    await page.locator('.annotation-input-ta').press('Escape');
  } else {
    console.log('❌ Ctrl+R 测试无选区框');
    fail++;
  }

  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
