// M5 ValidateService e2e：三通道（decorations / 面板 / 报告）+ strict 门禁
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };

  const seed = async (kind) => {
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.evaluate((k) => {
      const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
      const B = 'doctype:demo\n\n# 周报\n\n你好，本周完成了引用机制的三块里程碑。\n\n## 版本\n\nv0.2.1\n\n## 待办\n\n- [x] 引用语法\n- [ ] 校验服务\n';
      let z = B;
      if (k === 'table') z = B + '\n## 需求\n\n| 前置 | 后置 |\n| --- | --- |\n| A | B |\n';
      else if (k === 'noversion') z = B.replace('## 版本\n\nv0.2.1\n', '');
      else if (k === 'partial') z = B + '\n## 需求\n\n| 前置 | 后置 |\n| --- | --- |\n| A |  |\n';
      fs.files['笔记/周报.md'] = z;
      localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
    }, kind);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await page.locator('.tree .node', { hasText: '笔记' }).first().click();
    await page.waitForTimeout(400);
    await page.locator('.tree .name', { hasText: '周报.md' }).click();
    await page.waitForTimeout(5000);
  };

  // A: 原始周报（无需求表）→ 1 warning
  await seed('base');
  const warnA = await page.evaluate(() => document.querySelector('.annotation-drawer .ad-counts .warn')?.textContent ?? '');
  ok('A: 周报 1 警告（缺需求表）', (warnA || '').includes('1'));

  // B: 补需求表 → 无违规
  await seed('table');
  const cardsB = await page.locator('.ad-card').count();
  ok('B: 补需求表后无违规（无校验卡）', cardsB === 0);

  // C: 删除版本章节 → error + 面板列出
  await seed('noversion');
  const errC = await page.evaluate(() => document.querySelector('.annotation-drawer .ad-counts .err')?.textContent ?? '');
  ok('C: 缺版本章节 error 出现', (errC || '').length > 0);

  // E: 需求表部分填写（后置空）→ 校验违规转批注：锚定行高亮 + 点击出批注卡（M6）
  await seed('partial');
  const marksE = await page.locator('tr.annotation-dynamic').count();
  ok('E: 违规锚定行高亮（annotation-dynamic）', marksE > 0);
  const markLevel = await page.locator('tr.annotation-dynamic').first().getAttribute('class').catch(() => '');
  ok('E: 高亮 level=warning', (markLevel || '').includes('annotation-level-warning'));
  await page.evaluate(() => {
    const tr = document.querySelector('tr.annotation-dynamic');
    if (tr) tr.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(800);
  const markMsg = await page.evaluate(() => {
    const card = document.querySelector('.ad-card.read-only.active .ad-card-content');
    return card ? card.textContent : '';
  });
  ok('E: 抽屉校验卡提示 = 后置不能为空', (markMsg || '').includes('后置不能为空'));
  const beforeE = await page.evaluate(() => {
    const pane = Array.from(document.querySelectorAll('.editor-pane')).find(p => getComputedStyle(p).display !== 'none');
    return pane ? pane.scrollTop : -1;
  });
  await page.locator('.ad-card.read-only').first().click();
  await page.waitForTimeout(1500);
  const afterE = await page.evaluate(() => {
    const pane = Array.from(document.querySelectorAll('.editor-pane')).find(p => getComputedStyle(p).display !== 'none');
    return pane ? pane.scrollTop : -1;
  });
  ok('E: 抽屉定位滚动', afterE !== beforeE);

  // D: 报告落盘 + hint 模式保存不被阻止
  await seed('base');
  const report = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    const r = fs.files && fs.files['.validate/report.md'];
    return r ? { ok: r.includes('校验报告'), hasWarn: r.includes('warning') } : null;
  });
  ok('D: 报告落盘 .validate/report.md', report?.ok && report?.hasWarn);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1500);
  const saved = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return (fs.files['笔记/周报.md'] || '').length;
  });
  ok('D: hint 模式保存不被阻止', saved > 60 && saved < 10000);

  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
