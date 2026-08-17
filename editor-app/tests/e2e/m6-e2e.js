// M6 批注插件 e2e（v3 抽屉）：round-trip / 锚点激活 / 动态批注只读卡
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/?backend=mock', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  // 1. 持久化批注 round-trip（产品路径格式：&quot; 转义）
  const note = JSON.stringify([{ a: '我', c: '这里需要补充说明', t: Date.now() - 60000, r: 0 }]).replace(/"/g, '&quot;');
  await page.evaluate((noteVal) => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/周报.md'] = 'doctype:demo\n\n# 周报\n\n<mark data-note="' + noteVal + '">本周进展</mark> 已同步。\n\n## 版本\n\nv0.2.1\n\n## 需求\n\n| 前置 | 后置 |\n| --- | --- |\n| A | B |\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  }, note);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(6000);
  const marks = await page.locator('.ProseMirror mark.annotation').count();
  ok('持久化批注渲染为 mark.annotation', marks > 0);
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  ok('round-trip 保留 <mark data-note>', md.includes('<mark data-note='));

  // 2. 点击批注 → 抽屉激活对应卡 + 内容
  await page.locator('.ProseMirror mark.annotation').first().click();
  await page.waitForTimeout(800);
  const cardText = await page.evaluate(() => {
    const card = document.querySelector('.ad-card.active .ad-comment-content');
    return card ? card.textContent : 'NO';
  });
  ok('点击批注 → 抽屉激活卡显示内容', (cardText || '').includes('这里需要补充说明'));

  // 3. 动态批注（校验）：需求表部分填写 → 锚定行高亮 + 抽屉只读卡
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    const z = fs.files['笔记/周报.md'];
    fs.files['笔记/周报.md'] = z.replace('| A | B |', '| A |  |');
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(6000);
  const dynRows = await page.locator('tr.annotation-dynamic').count();
  ok('动态批注锚定行高亮', dynRows > 0);
  await page.evaluate(() => {
    const tr = document.querySelector('tr.annotation-dynamic');
    if (tr) tr.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(800);
  const dynCard = await page.evaluate(() => {
    const card = document.querySelector('.ad-card.read-only.active .ad-card-content');
    return card ? card.textContent : 'NO';
  });
  ok('动态批注抽屉卡显示校验消息', (dynCard || '').includes('后置不能为空'));
  const dynDel = await page.evaluate(() => {
    const card = document.querySelector('.ad-card.read-only.active');
    return card ? card.querySelectorAll('.mini.danger').length : -1;
  });
  ok('动态批注只读（无删除按钮）', dynDel === 0);

  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
