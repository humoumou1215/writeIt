// M6 v3：批注抽屉（评论线程 / 标记已解决 / 校验只读卡 / 连线 / 拖拽）
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  // 构造：周报 + 一条人工批注（线程）+ 校验违规（需求表部分填写）
  // 产品路径格式：双引号属性 + &quot; 转义（与 toMarkdown 一致）
  const note = JSON.stringify([{ a: '张三', c: '这里需要补充**验收标准**', t: Date.now() - 7200000, r: 0 }]).replace(/"/g, '&quot;');
  await page.evaluate((noteVal) => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/周报.md'] = 'doctype:demo\n\n# 周报\n\n<mark data-note="' + noteVal + '">本周进展</mark>已同步。\n\n## 版本\n\nv0.2.1\n\n## 需求\n\n| 前置 | 后置 |\n| --- | --- |\n| A |  |\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  }, note);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(6000);

  // 1. 抽屉默认展开 + 批注卡（1 人工 + 1 校验违规）
  const drawerOpen = await page.locator('.annotation-drawer.open').count();
  ok('抽屉默认展开', drawerOpen > 0);
  const cards = await page.locator('.ad-card').count();
  ok('抽屉显示 2 张卡（人工 + 校验）', cards === 2);
  const threadText = await page.locator('.ad-card .ad-comment-content').first().textContent().catch(() => '');
  ok('人工批注评论内容显示', (threadText || '').includes('验收标准'));

  // 2. 校验违规只读卡（无回复输入）
  const readonlyCards = await page.locator('.ad-card.read-only').count();
  ok('校验违规只读卡', readonlyCards === 1);
  const replyBoxes = await page.locator('.ad-reply').count();
  ok('只有人工批注卡有回复框（1 个）', replyBoxes === 1);

  // 3. 回复评论（追加线程）
  await page.locator('.ad-reply textarea').fill('我补充了量化指标：通过率 ≥ 95%');
  await page.locator('.ad-reply-actions button', { hasText: '发送' }).click();
  await page.waitForTimeout(1200);
  const comments = await page.locator('.ad-comment').count();
  ok('回复后评论 2 条', comments === 2);

  // 4. 持久化 round-trip（md 里线程 JSON 两条）
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  const parseOk = await page.evaluate((t) => {
    // 从 md 提取 data-note 检查 JSON
    const m = /data-note="([^"]*)"/.exec(t);
    if (!m) return false;
    const arr = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    return Array.isArray(arr) && arr.length === 2;
  }, md);
  ok('线程持久化到 md（2 条评论 JSON）', parseOk);

  // 5. 已解决状态圆：非创建人不可点（张三的评论 mine=false）；创建人可点（我 的评论 mine=true）
  const zhangDot = await page.evaluate(() => {
    const comment = Array.from(document.querySelectorAll('.ad-comment')).find(c =>
      (c.querySelector('.ad-author')?.textContent || '').includes('张三'));
    const dot = comment ? comment.querySelector('.ad-resolve-dot') : null;
    return dot ? { mine: dot.classList.contains('mine'), resolved: dot.classList.contains('resolved') } : null;
  });
  ok('非创建人（张三）圆不可点（非 mine）', zhangDot && !zhangDot.mine);
  const myDot = await page.evaluate(() => {
    const comment = Array.from(document.querySelectorAll('.ad-comment')).find(c =>
      (c.querySelector('.ad-author')?.textContent || '').includes('我'));
    const dot = comment ? comment.querySelector('.ad-resolve-dot') : null;
    return dot ? dot.classList.contains('mine') : false;
  });
  ok('创建人（我）圆可点（mine）', myDot === true);
  // 点击「我」的圆 → 已解决（✔）
  await page.evaluate(() => {
    const comment = Array.from(document.querySelectorAll('.ad-comment')).find(c =>
      (c.querySelector('.ad-author')?.textContent || '').includes('我'));
    const dot = comment.querySelector('.ad-resolve-dot');
    dot.click();
  });
  await page.waitForTimeout(1000);
  const resolvedDot = await page.evaluate(() => {
    const comment = Array.from(document.querySelectorAll('.ad-comment')).find(c =>
      (c.querySelector('.ad-author')?.textContent || '').includes('我'));
    return comment ? comment.querySelector('.ad-resolve-dot')?.classList.contains('resolved') : false;
  });
  ok('点击圆 → 已解决（✔）', resolvedDot === true);
  // 再点 → 重新打开（空圆）
  await page.evaluate(() => {
    const comment = Array.from(document.querySelectorAll('.ad-comment')).find(c =>
      (c.querySelector('.ad-author')?.textContent || '').includes('我'));
    comment.querySelector('.ad-resolve-dot').click();
  });
  await page.waitForTimeout(1000);
  const reopenedDot = await page.evaluate(() => {
    const comment = Array.from(document.querySelectorAll('.ad-comment')).find(c =>
      (c.querySelector('.ad-author')?.textContent || '').includes('我'));
    return comment ? !comment.querySelector('.ad-resolve-dot')?.classList.contains('resolved') : false;
  });
  ok('再点圆 → 重新打开（空圆）', reopenedDot === true);

  // 6. 点击正文锚点 → 激活批注 + 连线出现
  await page.locator('.ProseMirror mark.annotation').first().click();
  await page.waitForTimeout(800);
  const activeCard = await page.locator('.ad-card.active').count();
  ok('点击锚点激活对应批注卡', activeCard > 0);
  // 点击卡片头部 → 折叠：评论列表仍显示、输入框隐藏 → 再点展开
  await page.locator('.ad-card.active .ad-card-head').first().click();
  await page.waitForTimeout(600);
  const collapsedCard = await page.locator('.ad-card.active.collapsed').count();
  ok('点击卡片头部折叠', collapsedCard > 0);
  const replyHidden = await page.locator('.ad-card.active.collapsed .ad-reply').count();
  ok('折叠时无评论输入框', replyHidden === 0);
  const commentsShown = await page.evaluate(() => {
    const card = document.querySelector('.ad-card.active.collapsed');
    return card ? card.querySelectorAll('.ad-comment').length : 0;
  });
  ok('折叠仍显示评论列表', commentsShown > 0);
  await page.locator('.ad-card.active .ad-card-head').first().click();
  await page.waitForTimeout(600);
  const expanded = await page.locator('.ad-card.active:not(.collapsed)').count();
  ok('再点展开（输入框回来）', expanded > 0);
  const connDisplay = await page.evaluate(() => {
    const svg = document.querySelector('.annotation-connector');
    return svg ? getComputedStyle(svg).display : 'none';
  });
  ok('连线显示', connDisplay !== 'none');

  // 7. 宽度拖拽（50-480 限制）
  await page.evaluate(() => {
    const drawer = document.querySelector('.annotation-drawer.open');
    const r = drawer.getBoundingClientRect();
    const resizer = drawer.querySelector('.annotation-drawer-resizer');
    const rect = resizer.getBoundingClientRect();
    resizer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left, clientY: rect.top + 50 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left - 400, clientY: rect.top + 50 }));
    document.dispatchEvent(new MouseEvent('mouseup', {}));
  });
  await page.waitForTimeout(400);
  const w1 = await page.evaluate(() => document.querySelector('.annotation-drawer.open')?.getBoundingClientRect().width ?? -1);
  ok('拖拽宽度受限（50-480）', w1 >= 50 && w1 <= 480);

  // 8. 折叠
  await page.locator('.annotation-drawer-head .mini', { hasText: '»' }).click();
  await page.waitForTimeout(400);
  const collapsed = await page.locator('.annotation-drawer-tab').count();
  ok('折叠后显示把手', collapsed > 0);
  const connGone = await page.evaluate(() => {
    const svg = document.querySelector('.annotation-connector');
    return svg ? getComputedStyle(svg).display : 'none';
  });
  ok('折叠后连线隐藏', connGone === 'none');

  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
