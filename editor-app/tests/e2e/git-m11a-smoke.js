// M12/M14 演示模式 e2e：浏览器（mock 后端）下 Git 工作台完整可用
// M14：真实 git diff 数据（Git演示/ 三文件）+ 全内联标记渲染 + 批注抽屉复用 + mermaid 节点级 DOM 标注
// 覆盖：Git 面板（示例仓库 3 文件）+ README 渲染模式（内联标记/mermaid 节点/嵌入角标/抽屉批注卡）
//       + 会议纪要（嵌入块内容调整）+ 需求表（表格单元格级）+ 文本模式 + Esc
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  let pass = 0, fail = 0;
  const check = (n, c) => { c ? pass++ : (fail++, console.log('❌', n)); };

  // 打开文件后点击编辑区会收纳侧边栏 → 点侧边栏前先展开（📁 图标）
  async function ensureSidebar() {
    const collapsed = await page
      .locator('.content-col')
      .evaluate((el) => el.classList.contains('collapsed'))
      .catch(() => false);
    if (collapsed) {
      await page.locator('.icon-col .icon-btn').first().click();
      await page.waitForTimeout(300);
    }
  }

  // 1. 浏览器（mock）下 Git 可用
  const gitBtn = page.locator('.icon-col .icon-btn:nth-child(2)').first();
  const inlineOp = await gitBtn.evaluate((el) => el.style.opacity);
  check('Git 图标可用（mock 演示模式）', inlineOp === '' || inlineOp === undefined || inlineOp === null);

  // 2. 打开 Git 面板 → 示例仓库（3 文件）
  await gitBtn.click();
  await page.waitForTimeout(900);
  check('Git 面板激活（Git 按钮高亮）', await page.locator('.icon-col .icon-btn:nth-child(2).active').count() === 1);
  const badge = (await page.locator('.repo-badge').textContent() || '');
  check('示例仓库分支 main', badge.includes('main'));
  check('分支区含 feature/图表优化', await page.locator('.branch', { hasText: 'feature/图表优化' }).count() === 1);
  check('工作区 3 文件（README/需求表/会议纪要）', await page.locator('.section', { hasText: '工作区' }).locator('.ws-file').count() === 3);
  check('历史 2 提交', await page.locator('.commit').count() === 2);
  check('HEAD 提交展开', await page.locator('.commit.expanded').count() === 1);
  await page.screenshot({ path: '/tmp/m12-git-panel.png' });

  // 3. 打开 README 工作区 diff → 默认渲染模式（全内联标记）
  await page.locator('.section', { hasText: '工作区' }).locator('.ws-file', { hasText: 'README.md' }).click();
  await page.waitForTimeout(1500);
  check('进入 diff 视图', await page.locator('.git-diff-view').count() === 1);
  check('默认渲染模式激活', await page.locator('.diff-toolbar .mini.active', { hasText: '渲染' }).count() === 1);
  // 渲染是异步的 → 轮询等待内联标记
  try {
    await page.waitForSelector('.render-host .diff-ins', { timeout: 20000 });
  } catch {
    console.log('[warn] 渲染未在 20s 内完成');
  }
  try { await page.waitForSelector('.render-host .diff-del', { timeout: 8000 }); } catch {}
  check('M14 行内标注（diff-ins ≥3）', await page.locator('.render-host .diff-ins').count() >= 3);
  check('M14 行内标注（diff-del ≥2：纯删除块/词级删除）', await page.locator('.render-host .diff-del').count() >= 2);
  // 纯删除块内容
  check('M14 纯删除块（旧版本说明）', await page.locator('.render-host .diff-del', { hasText: '旧版本说明' }).count() === 1);
  check('M14 纯新增段（需求四）', await page.locator('.render-host .diff-ins', { hasText: '消息通知模块' }).count() >= 1);
  // 词级修改
  check('M14 词级修改（与权限）', await page.locator('.render-host .diff-ins', { hasText: '与权限' }).count() === 1);
  // 嵌入卡片 + 内容有改动角标
  try { await page.waitForSelector('.render-host .ref-file-block', { timeout: 8000 }); } catch {}
  check('M14 嵌入卡片 2 个', await page.locator('.render-host .ref-file-block').count() >= 2);
  try { await page.waitForSelector('.render-host .ref-embed-diff-badge', { timeout: 8000 }); } catch {}
  check('M14 嵌入「内容有改动」角标（场景 A）', await page.locator('.render-host .ref-embed-diff-badge').count() >= 2);

  // mermaid：滚动到图（IO 懒加载）→ 节点级标注
  await page.evaluate(() => { document.querySelector('.render-main')?.scrollTo(0, 2500); });
  await page.waitForTimeout(2500);
  try { await page.waitForSelector('.render-host .preview svg, .render-host .mmd-zoomable svg', { timeout: 8000 }); } catch {}
  check('M14 mermaid 图渲染', await page.locator('.render-host .preview svg, .render-host .mmd-zoomable svg').count() > 0);
  await page.waitForTimeout(1500); // 等节点标注轮询
  check('M14 mermaid 修改节点（C 授信成功 黄标）', await page.locator('.render-host svg g.node.diff-node-mod').count() >= 1);
  check('M14 mermaid 新增节点（F 额度查询 绿标）', await page.locator('.render-host svg g.node.diff-node-add').count() >= 1);
  check('M14 mermaid 删除节点（G 余额查询 红标）', await page.locator('.render-host svg g.node.diff-node-del').count() >= 1);

  // 批注抽屉：diff 改动说明卡（复用存量批注体系）
  try { await page.waitForSelector('.annotation-drawer .ad-card', { timeout: 8000 }); } catch {}
  check('M14 批注抽屉「改动说明」卡 ≥5', await page.locator('.annotation-drawer .ad-card .ad-card-title', { hasText: '改动说明' }).count() >= 5);
  check('M14 批注卡含 mermaid 变更说明', (await page.locator('.annotation-drawer .ad-card').allTextContents().then((t) => t.join(''))).includes('流程图'));
  // 点击批注卡 → 连线 + 激活
  await page.locator('.annotation-drawer .ad-card.read-only').nth(2).click();
  await page.waitForTimeout(700);
  check('M14 点击批注卡 → 连线出现', await page.locator('.annotation-connector-path').getAttribute('d').then((d) => (d || '').length > 10));
  check('M14 批注卡激活态', await page.locator('.annotation-drawer .ad-card.active').count() === 1);
  await page.screenshot({ path: '/tmp/m12-render-diff.png' });
  // 退出 README diff
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 4. 会议纪要（嵌入块内容调整）：备注词级 + 议题新增
  await ensureSidebar();
  await page.locator('.section', { hasText: '工作区' }).locator('.ws-file', { hasText: '会议纪要' }).click();
  await page.waitForTimeout(2500);
  try { await page.waitForSelector('.render-host .diff-ins', { timeout: 15000 }); } catch {}
  check('M14 会议纪要：新增议题 3', await page.locator('.render-host .diff-ins', { hasText: '消息通知需求收集' }).count() >= 1);
  check('M14 会议纪要：备注修改词级', await page.locator('.render-host .diff-del', { hasText: '不做退款' }).count() === 1 && await page.locator('.render-host .diff-ins', { hasText: '退款下期排期' }).count() === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 5. 需求表（表格单元格级）
  await ensureSidebar();
  await page.locator('.section', { hasText: '工作区' }).locator('.ws-file', { hasText: '需求表' }).click();
  await page.waitForTimeout(2500);
  try { await page.waitForSelector('.render-host .diff-ins', { timeout: 15000 }); } catch {}
  check('M14 需求表：单元格级（待评审→评审中）', await page.locator('.render-host .diff-del', { hasText: '待评审' }).count() === 1 && await page.locator('.render-host .diff-ins', { hasText: '评审中' }).count() === 1);
  check('M14 需求表：新增行（消息通知）', await page.locator('.render-host .diff-ins', { hasText: '消息通知' }).count() >= 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 6. 文本模式（README）
  await ensureSidebar();
  await page.locator('.section', { hasText: '工作区' }).locator('.ws-file', { hasText: 'README.md' }).click();
  await page.waitForTimeout(1200);
  await page.locator('.diff-toolbar .mini', { hasText: '文本' }).click();
  await page.waitForTimeout(400);
  check('切文本模式', await page.locator('.diff-toolbar .mini.active', { hasText: '文本' }).count() === 1);
  check('分栏布局', await page.locator('.diff-row.split').count() > 0);
  check('词级高亮 word-del', await page.locator('.word-del').count() >= 1);
  check('词级高亮 word-add', await page.locator('.word-add').count() >= 1);
  check('hunk 还原按钮', await page.locator('.hunk-discard').count() >= 1);

  // 7. Esc 退出
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('Esc 退出 diff', await page.locator('.git-diff-view').count() === 0);

  // 8. 无页面错误
  check('无页面错误', errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
