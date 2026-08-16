// M7-Drag 拖拽移动 e2e（mock 模式）
// 覆盖：文件入目录 / 目录递归 / 拖到根 / 插入线同级 / 循环拒绝 / 空操作 / 冲突拒绝 /
//       悬停自动展开 / 标签+引用联动 / 真实 HTML5 DnD 冒烟 / 瞄准定位
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
    if (m.text().includes('[M7]')) console.log('LOG:', m.text().slice(0, 130));
  });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  // 等待文件树就绪（首次渲染 / HMR 重载时序兜底）
  const treeReady = async () => {
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const n = await page.locator('.tree [data-path="README.md"]').count();
      if (n > 0) return true;
      await page.waitForTimeout(200);
    }
    return false;
  };
  await treeReady();

  let pass = 0, fail = 0;
  const check = (n, c) => { c ? pass++ : (fail++, console.log('❌', n)); };
  const sel = (p) => `.tree [data-path="${p}"]`;
  const count = (p) => page.locator(sel(p)).count();
  const has = async (p) => (await count(p)) > 0;

  // 手动 dispatch HTML5 DnD 事件（可精确控制悬停位置）
  async function dragDrop(source, target, pos) {
    // into 目录：先展开目标目录（drop 后节点可见，也贴近真实场景）
    if (pos === 'into') await ensureExpanded(target);
    await page.evaluate(
      ([sp, tp, pp]) => {
        const q = (p) => document.querySelector(`.tree [data-path="${p}"]`);
        const src = q(sp);
        const tgt = q(tp);
        if (!src || !tgt) throw new Error('节点不存在: ' + sp + ' / ' + tp);
        const dt = () => new DataTransfer();
        src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt() }));
        const rect = tgt.getBoundingClientRect();
        let y = rect.top + rect.height / 2;
        if (pp === 'before') y = rect.top + 2;
        if (pp === 'after') y = rect.bottom - 2;
        const x = rect.left + rect.width / 2;
        tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt() }));
        tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt() }));
      },
      [source, target, pos]
    );
    await page.waitForTimeout(900);
  }

  // 拖到树根空白区（移动到根）
  async function dragDropRoot(source) {
    await page.evaluate((sp) => {
      const src = document.querySelector(`.tree [data-path="${sp}"]`);
      if (!src) throw new Error('节点不存在: ' + sp);
      const dt = () => new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt() }));
      const tree = document.querySelector('.tree');
      const rect = tree.getBoundingClientRect();
      const x = rect.left + 30;
      const y = rect.bottom - 8;
      tree.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt() }));
      tree.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt() }));
    }, source);
    await page.waitForTimeout(900);
  }

  const ensureSidebar = async () => {
    const collapsed = await page.locator('.content-col').evaluate((el) => el.classList.contains('collapsed'));
    if (collapsed) {
      await page.locator('.icon-col .icon-btn').first().click();
      await page.waitForTimeout(400);
    }
  };
  // 点击树节点名（dispatch click，绕过 actionability/遮挡超时）
  const clickNode = async (path) => {
    await page.evaluate((p) => {
      document.querySelector(`.tree [data-path="${p}"] .name`)?.click();
    }, path);
  };
  const md = () => page.evaluate(() => window.__editorGetMarkdown());
  const ensureExpanded = async (path) => {
    const el = page.locator(sel(path));
    if ((await el.count()) === 0) return false; // 父级未展开，节点不可见
    if ((await el.locator('.arrow.open').count()) === 0) {
      // 直接 dispatch click 到 arrow（绕过 actionability，避免被遮挡超时）
      await page.evaluate((p) => {
        document.querySelector(`.tree [data-path="${p}"] .arrow`)?.click();
      }, path);
      await page.waitForTimeout(450);
    }
    return true;
  };

  // ===== 1. 文件拖入目录（into）=====
  await ensureSidebar();
  await dragDrop('README.md', '笔记', 'into');
  check('文件拖入目录 → 笔记/README.md', await has('笔记/README.md'));
  check('源位置移除', !(await has('README.md')));

  // ===== 2. 插入线 before：拖到文件上缘 = 与目标同级 =====
  await ensureExpanded('笔记');
  await dragDrop('Mermaid 图表集.md', '笔记/会议记录.md', 'before');
  check('插入线 before → 笔记/Mermaid 图表集.md', await has('笔记/Mermaid 图表集.md'));

  // ===== 3. 插入线 after =====
  await dragDrop('引用演示.md', '笔记/会议记录.md', 'after');
  check('插入线 after → 笔记/引用演示.md', await has('笔记/引用演示.md'));

  // ===== 4. 目录递归移动（into）=====
  await dragDrop('数据', '笔记', 'into');
  await ensureExpanded('笔记/数据');
  check('目录递归 → 笔记/数据/原始数据.txt', await has('笔记/数据/原始数据.txt'));

  // ===== 5. 拖到树根空白区 = 移动到根 =====
  await dragDropRoot('笔记/待办清单.md');
  check('拖到根 → 待办清单.md', await has('待办清单.md'));
  check('原位置移除', !(await has('笔记/待办清单.md')));

  // ===== 6. 循环拒绝：目录拖进自己后代 =====
  await ensureExpanded('笔记/数据');
  const before6 = await count('笔记/数据');
  await dragDrop('笔记', '笔记/数据/原始数据.txt', 'before');
  check('循环拒绝（目录→后代）树不变', (await count('笔记/数据')) === before6);
  check('循环拒绝（目录→后代）源未消失', await has('笔记'));

  // ===== 7. 空操作拒绝：拖回原父目录 / 拖到自身 =====
  await dragDrop('笔记/README.md', '笔记', 'into');
  check('拖回原父目录 = 空操作', await has('笔记/README.md'));
  await dragDrop('笔记/README.md', '笔记/README.md', 'before');
  check('拖到自身 = 空操作', await has('笔记/README.md'));

  // ===== 8. 冲突拒绝：目标已存在 =====
  // 8a 新建 新文件.md 到根
  await ensureSidebar();
  await page.locator('.sidebar-actions .mini[title="新建文件"]').click();
  await page.waitForTimeout(300);
  await page.locator('.tree .rename-input').fill('新文件.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  // 8b 拖入笔记
  await dragDrop('新文件.md', '笔记', 'into');
  check('冲突前置：新文件.md 移入笔记', await has('笔记/新文件.md'));
  // 8c 根再建同名
  await ensureSidebar();
  await page.locator('.sidebar-actions .mini[title="新建文件"]').click();
  await page.waitForTimeout(300);
  await page.locator('.tree .rename-input').fill('新文件.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  // 新建后自动打开标签（侧边栏不收纳）→ 恢复展开再拖拽
  await ensureSidebar();
  // 8d 拖 笔记/新文件.md 到根空白 → newPath=新文件.md 已存在 → 拒绝
  await dragDropRoot('笔记/新文件.md');
  check('冲突拒绝：根同名文件仍在', await has('新文件.md'));
  check('冲突拒绝：源未移动（仍在笔记）', await has('笔记/新文件.md'));

  // ===== 9. 悬停目录中间 → 自动展开（不 drop）=====
  // 先折叠笔记目录
  await clickNode('笔记');
  await page.waitForTimeout(400);
  check('前置：笔记已折叠', (await page.locator(sel('笔记/会议记录.md')).count()) === 0);
  // 拖起根/新文件.md，悬停笔记中间 900ms（只 dragover，不 drop）
  await page.evaluate(() => {
    const src = document.querySelector('.tree [data-path="新文件.md"]');
    const tgt = document.querySelector('.tree [data-path="笔记"]');
    const dt = () => new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt() }));
    const rect = tgt.getBoundingClientRect();
    tgt.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        dataTransfer: dt(),
      })
    );
  });
  await page.waitForTimeout(1100);
  check('悬停目录 500ms 自动展开', (await page.locator(sel('笔记/会议记录.md')).count()) > 0);
  // 取消拖拽（dragend 清理状态）
  await page.evaluate(() => {
    const src = document.querySelector('.tree [data-path="新文件.md"]');
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(300);

  // ===== 10. 真实 HTML5 DnD 冒烟（playwright dragAndDrop）=====
  // 前置：根下应有 新文件.md（8c 建的）与 待办清单.md（5）；把 待办清单.md 拖到 template
  await dragDrop('待办清单.md', '.template', 'into');
  check('冒烟前置：待办清单.md → template', await has('.template/待办清单.md'));
  // 真实拖拽：.template/待办清单.md → 笔记（dragAndDrop 用真实 CDP 拖拽事件）
  await page.dragAndDrop(sel('.template/待办清单.md'), sel('笔记'));
  await page.waitForTimeout(1200);
  check('真实 dragAndDrop 生效 → 笔记/待办清单.md', await has('笔记/待办清单.md'));
  check('真实拖拽后源移除', !(await has('.template/待办清单.md')));

  // ===== 11. 标签 + 引用联动 =====
  // 打开 笔记/引用演示.md（原文含 [[笔记/会议记录]]）与 笔记/会议记录.md（验证标签跟随）
  await ensureSidebar();
  await ensureExpanded('笔记');
  await clickNode('笔记/引用演示.md');
  await page.waitForTimeout(2500);
  check('引用演示标签已打开', (await page.locator('.tab', { hasText: '引用演示' }).count()) > 0);
  // 打开文件不收纳侧边栏；若已收纳（如点击编辑区）则先展开，再打开会议记录
  await ensureSidebar();
  await ensureExpanded('笔记');
  await clickNode('笔记/会议记录.md');
  await page.waitForTimeout(2500);
  check('会议记录标签已打开', (await page.locator('.tab', { hasText: '会议记录' }).count()) > 0);
  // 切到引用演示，验证原文引用
  await page.locator('.tab', { hasText: '引用演示' }).click();
  await page.waitForTimeout(1500);
  const mdBefore = await md();
  check('引用原文含 [[笔记/会议记录]]', mdBefore.includes('[[笔记/会议记录]]'));
  // 拖「笔记」目录 → template（into）：合法（template 非笔记后代），不冲突
  await dragDrop('笔记', '.template', 'into');
  await ensureExpanded('.template/笔记');
  check('目录移动 → template/笔记/会议记录.md', await has('.template/笔记/会议记录.md'));
  // 引用联动：引用演示.md 中的 [[笔记/会议记录]] 应更新为 [[.template/笔记/会议记录]]
  const mdAfter = await md();
  check('引用联动：[[.template/笔记/会议记录]]', mdAfter.includes('[[.template/笔记/会议记录]]'));
  check('旧引用路径已不存在', !mdAfter.includes('[[笔记/会议记录]]'));
  // 标签存活：会议记录 tab 未被关闭（路径已跟随迁移）
  check('联动后标签未关闭', (await page.locator('.tab', { hasText: '会议记录' }).count()) > 0);

  // ===== 12. 瞄准定位（🎯）：展开祖先链 + 高亮 =====
  // 先折叠 template（含 笔记）目录，再点定位
  await clickNode('.template');
  await page.waitForTimeout(400);
  check('前置：template 已折叠', (await page.locator(sel('.template/笔记/会议记录.md')).count()) === 0);
  // 激活会议记录标签（当前 activeTab 是引用演示）
  await page.locator('.tab', { hasText: '会议记录' }).click();
  await page.waitForTimeout(800);
  // 确保侧边栏展开（打开文件不收纳；若已收纳则展开）
  await ensureSidebar();
  await page.locator('.sidebar-actions .mini', { hasText: '定位' }).click();
  await page.waitForTimeout(700);
  check('定位：祖先链展开（template/笔记 可见）', (await page.locator(sel('.template/笔记/会议记录.md')).count()) > 0);
  check('定位：节点高亮 revealed', (await page.locator(sel('.template/笔记/会议记录.md') + '.revealed').count()) > 0);
  // 高亮 2.4s 后自动清除
  await page.waitForTimeout(2200);
  check('定位：高亮自动清除', (await page.locator(sel('.template/笔记/会议记录.md') + '.revealed').count()) === 0);

  // ===== 页面错误检查 =====
  check('无页面错误', errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));

  await browser.close();
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
