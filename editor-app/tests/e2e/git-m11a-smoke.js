// M12 演示模式 e2e：浏览器（mock 后端）下 Git 工作台完整可用
// 覆盖：Git 面板（示例仓库）+ 打开工作区文件 diff（默认渲染模式）+ 文本模式词级 + Esc
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

  // 1. 浏览器（mock）下 Git 可用
  const gitBtn = page.locator('.icon-col .icon-btn', { hasText: '🔀' }).first();
  const inlineOp = await gitBtn.evaluate((el) => el.style.opacity);
  check('Git 图标可用（mock 演示模式）', inlineOp === '' || inlineOp === undefined || inlineOp === null);

  // 2. 打开 Git 面板 → 示例仓库
  await gitBtn.click();
  await page.waitForTimeout(900);
  check('Git tab 激活', await page.locator('.panel-tab.active', { hasText: 'Git' }).count() === 1);
  const badge = (await page.locator('.repo-badge').textContent() || '');
  check('示例仓库分支 main', badge.includes('main'));
  check('分支区含 feature/图表优化', await page.locator('.branch', { hasText: 'feature/图表优化' }).count() === 1);
  check('工作区 2 文件（README/会议记录）', await page.locator('.section', { hasText: '工作区' }).locator('.ws-file').count() === 2);
  check('历史 2 提交', await page.locator('.commit').count() === 2);
  check('HEAD 提交展开', await page.locator('.commit.expanded').count() === 1);
  await page.screenshot({ path: '/tmp/m12-git-panel.png' });

  // 3. 打开 README 工作区 diff → 默认渲染模式（单栏融合）
  await page.locator('.section', { hasText: '工作区' }).locator('.ws-file', { hasText: 'README.md' }).click();
  await page.waitForTimeout(1200);
  check('进入 diff 视图', await page.locator('.git-diff-view').count() === 1);
  check('默认渲染模式激活', await page.locator('.diff-toolbar .mini.active', { hasText: '渲染' }).count() === 1);
  // 渲染是异步的 → 轮询等待融合块
  try {
    await page.waitForSelector('.render-host .rd-block', { timeout: 20000 });
  } catch {
    console.log('[warn] 渲染未在 20s 内完成');
  }
  const rdSame = await page.locator('.rd-same').count();
  const rdMod = await page.locator('.rd-mod').count();
  const rdDel = await page.locator('.rd-del').count();
  check('渲染模式：未变块', rdSame >= 2);
  check('渲染模式：修改对（需求清单/流程图）', rdMod >= 2);
  check('渲染模式：删除块', rdDel >= 1);
  check('渲染模式：mermaid 图渲染', await page.locator('.render-host svg, .render-host .mermaid').count() > 0);
  check('渲染模式：嵌入卡片', await page.locator('.render-host .ref-file-block').count() > 0);
  await page.screenshot({ path: '/tmp/m12-render-diff.png' });

  // 4. 切文本模式 → 分栏 + 词级
  await page.locator('.diff-toolbar .mini', { hasText: '文本' }).click();
  await page.waitForTimeout(400);
  check('切文本模式', await page.locator('.diff-toolbar .mini.active', { hasText: '文本' }).count() === 1);
  check('分栏布局', await page.locator('.diff-row.split').count() > 0);
  check('词级高亮 word-del', await page.locator('.word-del').count() >= 1);
  check('词级高亮 word-add', await page.locator('.word-add').count() >= 1);
  check('hunk 还原按钮', await page.locator('.hunk-discard').count() >= 2);
  await page.screenshot({ path: '/tmp/m12-text-diff.png' });

  // 5. Esc 退出 diff
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('Esc 退出 diff', await page.locator('.git-diff-view').count() === 0);

  // 6. 无页面错误
  check('无页面错误', errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
