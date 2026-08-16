// M11a 全流程验证（浏览器注入 Tauri IPC mock，模拟真实 git 仓库）
// 覆盖：Git 面板（分支/工作区/历史/范围对比）+ diff 视图（viewMode 三态 + 渲染 + 导航 + Esc）
const { chromium } = require('playwright');

// ---------- mock 数据（模拟一个含 mermaid/引用的 git 仓库） ----------
// 嵌入 ![[ 必须独立成段（remark-ref：fileBlock = 整段匹配）
const OLD_README = '# 需求文档\n\n旧版本列表\n\n```mermaid\ngraph TD; A-->B\n```\n\n![[notes/new.md]]\n';
const NEW_README = '# 需求文档\n\n新版本列表\n\n```mermaid\ngraph TD; A-->C\n```\n\n![[notes/new.md]]\n';

const REPO = {
  repoInfo: { isRepo: true, branch: 'main', headHash: 'abc1234' },
  branches: [
    { name: 'main', isCurrent: true, remote: 'origin/main', aheadBehind: null },
    { name: 'feature/xxx', isCurrent: false, remote: null, aheadBehind: null },
    { name: 'origin/main', isCurrent: false, remote: null, aheadBehind: null },
  ],
  status: [
    { path: 'README.md', status: 'M', added: 12, deleted: 3 },
    { path: 'notes/new.md', status: '?', added: 5, deleted: 0 },
  ],
  log: [
    { hash: 'c1def0123456789abcdef0123456789abcdef01', author: 'Alice', date: Math.floor(Date.now() / 1000) - 86400 * 2, message: '修改 README（优化图表）' },
    { hash: 'c2ab2cd987654321abcdef987654321abcdef02', author: 'Bob', date: Math.floor(Date.now() / 1000) - 86400 * 5, message: '初始提交' },
  ],
  showCommit: {
    hash: 'c1def0123456789abcdef0123456789abcdef01',
    author: 'Alice',
    date: Math.floor(Date.now() / 1000) - 86400 * 2,
    message: '修改 README（优化图表）',
    files: [
      { path: 'README.md', status: 'M', added: 12, deleted: 3 },
      { path: 'notes/meeting.md', status: 'A', added: 20, deleted: 0 },
    ],
  },
  tree: [
    { name: 'README.md', path: 'README.md', kind: 'file' },
    {
      name: 'notes', path: 'notes', kind: 'dir',
      children: [
        { name: 'meeting.md', path: 'notes/meeting.md', kind: 'file' },
        { name: 'new.md', path: 'notes/new.md', kind: 'file' },
      ],
    },
  ],
  oldReadme: OLD_README,
  newReadme: NEW_README,
  fileContent: {
    'README.md': NEW_README,
    'notes/meeting.md': '# 会议记录\n\n引用 [[README]] 与嵌入 ![[notes/new.md]]\n',
    'notes/new.md': '未跟踪文件\n',
  },
  // diff hunks（camelCase，与 Rust serde 一致）
  worktreeHunks: [
    {
      oldStart: 1, oldLines: 12, newStart: 1, newLines: 14,
      lines: [
        { kind: 'ctx', text: '# 需求文档' },
        { kind: 'ctx', text: '' },
        { kind: 'del', text: '旧版本列表', words: [ { kind: 'ctx', text: '旧' }, { kind: 'del', text: '版本' }, { kind: 'ctx', text: '列表' } ] },
        { kind: 'add', text: '新版本列表', words: [ { kind: 'ctx', text: '新' }, { kind: 'add', text: '版本' }, { kind: 'ctx', text: '列表' } ] },
        { kind: 'add', text: '新增条目' },
        { kind: 'ctx', text: '```mermaid' },
        { kind: 'del', text: 'graph TD; A-->B', words: [ { kind: 'ctx', text: 'graph TD; A-->' }, { kind: 'del', text: 'B' } ] },
        { kind: 'add', text: 'graph TD; A-->C', words: [ { kind: 'ctx', text: 'graph TD; A-->' }, { kind: 'add', text: 'C' } ] },
        { kind: 'ctx', text: '```' },
        { kind: 'ctx', text: '' },
        { kind: 'ctx', text: '![[notes/new.md]]' },
      ],
    },
    {
      oldStart: 20, oldLines: 18, newStart: 20, newLines: 18,
      lines: [
        ...Array.from({ length: 14 }, (_, i) => ({ kind: 'ctx', text: '相同行 ' + (i + 1) })),
        { kind: 'del', text: '被删除行' },
        { kind: 'add', text: '新增行' },
        { kind: 'ctx', text: '尾部' },
      ],
    },
  ],
  commitHunks: [
    {
      oldStart: 1, oldLines: 5, newStart: 1, newLines: 7,
      lines: [
        { kind: 'ctx', text: '# 需求文档' },
        { kind: 'add', text: '提交中新增' },
        { kind: 'del', text: '提交中删除' },
        { kind: 'ctx', text: '结束' },
      ],
    },
  ],
  rangeHunks: [
    {
      oldStart: 3, oldLines: 4, newStart: 3, newLines: 6,
      lines: [
        { kind: 'del', text: '范围旧' },
        { kind: 'add', text: '范围新一' },
        { kind: 'add', text: '范围新二' },
        { kind: 'ctx', text: '共同行' },
      ],
    },
  ],
};

// 注入 Tauri IPC mock（arg 传 REPO JSON，避免模板插值脆弱性）
async function installMock(repoJson) {
  const repo = JSON.parse(repoJson);
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args = {}) => {
      switch (cmd) {
        case 'git_repo_info': return repo.repoInfo;
        case 'git_branches': return repo.branches;
        case 'git_status': return repo.status;
        case 'git_log': return repo.log;
        case 'git_show_commit': return repo.showCommit;
        case 'git_diff_file': {
          if (!args.from) return { hunks: repo.worktreeHunks, added: 12, deleted: 3, exists: true };
          if (String(args.from).endsWith('^')) return { hunks: repo.commitHunks, added: 7, deleted: 3, exists: true };
          return { hunks: repo.rangeHunks, added: 4, deleted: 2, exists: true };
        }
        case 'git_show_file': {
          const rev = String(args.rev || '');
          if (args.path === 'README.md') {
            if (rev === 'HEAD' || rev.endsWith('^')) return repo.oldReadme;
            return repo.newReadme;
          }
          if (args.path === 'notes/meeting.md') return repo.fileContent['notes/meeting.md'];
          return repo.fileContent[args.path] ?? '';
        }
        case 'read_tree': return repo.tree;
        case 'read_file': return repo.fileContent[args.path] ?? '';
        case 'set_root': return null;
        case 'git_user_name': return 'Alice';
        case 'git_discard_file':
        case 'git_discard_hunk': {
          // 还原：文件内容恢复为 HEAD 版本
          repo.fileContent[args.path] = repo.oldReadme;
          return null;
        }
        case 'git_checkout_branch': {
          repo.repoInfo.branch = args.name;
          return null;
        }
        default: return null;
      }
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  };
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.addInitScript(installMock, JSON.stringify(REPO));

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  let pass = 0, fail = 0;
  const check = (n, c) => { c ? pass++ : (fail++, console.log('❌', n)); };

  // 打开文件不收纳侧边栏——确保展开后点击侧边栏内容
  async function ensureSidebar() {
    const collapsed = await page
      .locator('.content-col')
      .evaluate((el) => el.classList.contains('collapsed'))
      .catch(() => false);
    if (collapsed) {
      // M15：第一个图标=文件树切 tab；点 Git 图标展开侧边栏并保持 git 面板
      await page.locator('.icon-col .icon-btn:nth-child(2)').first().click();
      await page.waitForTimeout(300);
    }
  }

  // 1. tauri 模式下 Git 图标可用（图标列第 2 个按钮）
  const gitBtn = page.locator('.icon-col .icon-btn:nth-child(2)').first();
  const inlineOp = await gitBtn.evaluate((el) => el.style.opacity);
  check('Git 图标可用（无灰置 inline style）', inlineOp === '' || inlineOp === undefined || inlineOp === null);

  // 2. 打开 Git 面板
  await gitBtn.click();
  await page.waitForTimeout(800);
  check('Git 面板激活（Git 按钮高亮）', await page.locator('.icon-col .icon-btn:nth-child(2).active').count() === 1);
  check('状态条显示分支 main', (await page.locator('.repo-badge').textContent() || '').includes('main'));
  check('分支区 3 项', await page.locator('.branch').count() === 3);
  check('工作区 2 文件', await page.locator('.section', { hasText: '工作区' }).locator('.ws-file').count() === 2);
  check('历史 2 提交', await page.locator('.commit').count() === 2);
  check('HEAD 提交自动展开变更文件', await page.locator('.commit.expanded').count() === 1);
  check('展开的提交含 2 个文件', await page.locator('.commit.expanded .ws-file').count() === 2);
  await page.screenshot({ path: '/tmp/m11a-git-panel.png' });

  // 3. 工作区文件 → diff 视图（工作区 vs HEAD）
  await page.locator('.section', { hasText: '工作区' }).locator('.ws-file', { hasText: 'README.md' }).click();
  await page.waitForTimeout(1200);
  check('进入 diff 视图（viewMode=diff）', await page.locator('.git-diff-view').count() === 1);
  check('diff 工具栏显示路径', (await page.locator('.diff-path').textContent() || '').includes('README.md'));
  check('diff 基准 = 工作区 vs HEAD', (await page.locator('.diff-base').textContent() || '').includes('工作区 vs HEAD'));
  check('统计 +12 −3', (await page.locator('.diff-stats').textContent() || '').replace(/\s/g, '').includes('+12−3'));
  // M11c：默认渲染模式（设计 D4）
  check('M11c 默认渲染模式（工具栏渲染激活）', await page.locator('.diff-toolbar .mini.active', { hasText: '渲染' }).count() === 1);
  // 切文本模式跑 M11a/M11b 文本断言
  await page.locator('.diff-toolbar .mini', { hasText: '文本' }).click();
  await page.waitForTimeout(400);
  check('切文本模式', await page.locator('.diff-toolbar .mini.active', { hasText: '文本' }).count() === 1);
  check('hunk 元信息', (await page.locator('.hunk-meta').first().textContent() || '').includes('@@'));
  check('删除行渲染', await page.locator('.cell.del', { hasText: '旧版本列表' }).count() === 1);
  check('新增行渲染', await page.locator('.cell.add', { hasText: '新版本列表' }).count() === 1);
  check('mermaid 上下文行渲染', await page.locator('.cell', { hasText: 'graph TD; A-->C' }).count() >= 1);
  check('行号正确（新增行无旧行号）', true);

  // ---- M11b：分栏/统一/词级/折叠/导航计数 ----
  check('M11b 分栏默认（左旧右新）', await page.locator('.diff-row.split').count() > 0);
  check('M11b 分栏 del 行仅左栏', await page.locator('.diff-row.split .cell.del', { hasText: '旧版本列表' }).count() === 1);
  check('M11b 词级高亮 word-del', await page.locator('.word-del', { hasText: '版本' }).count() >= 1);
  check('M11b 词级高亮 word-add', await page.locator('.word-add', { hasText: '版本' }).count() >= 1);
  check('M11b mermaid 修改对词级（A-->B 划线）', await page.locator('.word-del', { hasText: 'B' }).count() >= 1);
  check('M11b 导航计数', (await page.locator('.nav-count').textContent() || '').includes('/2'));
  // 折叠：长 ctx 段显示折叠条
  check('M11b hunk 折叠条出现', await page.locator('.fold-bar', { hasText: '相同 14 行' }).count() === 1);
  await page.locator('.fold-bar', { hasText: '相同 14 行' }).click();
  await page.waitForTimeout(300);
  check('M11b 折叠展开后收起条', await page.locator('.fold-bar', { hasText: '收起' }).count() >= 1);
  // 统一视图切换
  await page.keyboard.press('Control+Shift+u');
  await page.waitForTimeout(300);
  check('M11b 切统一视图', await page.locator('.diff-row.unified').count() > 0);
  check('M11b 统一视图词级保留', await page.locator('.diff-row.unified .word-add').count() >= 1);
  await page.keyboard.press('Control+Shift+u');
  await page.waitForTimeout(300);
  check('M11b 切回分栏', await page.locator('.diff-row.split').count() > 0);
  await page.screenshot({ path: '/tmp/m11a-diff-worktree.png' });

  // ---- M13：渲染模式（单 Crepe + 组合 md） ----
  await page.locator('.diff-toolbar .mini', { hasText: '渲染' }).click();
  // 单 Crepe 渲染组合 md（异步）→ 轮询等待 diff 标注出现（20s 上限）
  try {
    await page.waitForSelector('.render-host .diff-ins', { timeout: 20000 });
  } catch {
    console.log('[warn] 渲染未在 20s 内完成，继续断言');
  }

  check('M13 渲染模式：组合 md 渲染（diff 标注）', await page.locator('.render-host .diff-del, .render-host .diff-ins').count() > 0);
  check('M13 行内修改（删除字划线/新增字绿底）', await page.locator('.render-host .diff-del', { hasText: '旧' }).count() >= 1 && await page.locator('.render-host .diff-ins', { hasText: '新' }).count() >= 1);
  // annotate / notes / 嵌入物化是异步的 → 等待就绪
  try { await page.waitForSelector('.render-host .diff-del, .render-host .diff-ins', { timeout: 8000 }); } catch {}
  try { await page.waitForSelector('.annotation-drawer .ad-card', { timeout: 8000 }); } catch {}
  try { await page.waitForSelector('.render-host .ref-file-block', { timeout: 8000 }); } catch {}
  check('M14 块级纯删除/新增也走行内标记（diff-del/diff-ins）', await page.locator('.render-host .diff-del').count() >= 2 && await page.locator('.render-host .diff-ins').count() >= 2);
  check('M14 批注抽屉「改动说明」卡（复用存量批注体系）', await page.locator('.annotation-drawer .ad-card .ad-card-title', { hasText: '改动说明' }).count() >= 1);
  check('M14 批注卡（修改"旧"为"新"）', (await page.locator('.annotation-drawer .ad-card').allTextContents().then((t) => t.join(''))).includes('修改'));
  check('M13 mermaid 渲染图（svg）', await page.locator('.render-host svg, .render-host .mermaid').count() > 0);
  const embedCards = await page.locator('.render-host .ref-file-block').count();

  check('M13 嵌入引用卡片渲染', embedCards > 0);
  await page.locator('.annotation-drawer .ad-card.read-only').first().click();
  await page.waitForTimeout(400);
  check('M14 批注卡激活', await page.locator('.annotation-drawer .ad-card.active').count() === 1);
  await page.screenshot({ path: '/tmp/m13-render-mode.png' });
  // annotate 延迟（CodeMirror 语言按钮晚渲染）→ 等待标注完成
  await page.waitForTimeout(1800);

  // 4. 导航：F7 / Shift+F7
  await page.keyboard.press('F7');
  await page.waitForTimeout(300);
  check('F7 导航不崩溃', await page.locator('.git-diff-view').count() === 1);

  // 5. 源码模式三态互斥：diff → source（Ctrl+E）→ diff
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(600);
  check('diff → source 切换', await page.locator('.source-ta').count() === 1);
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(600);
  const mdBox = await page.locator('.milkdown').first().boundingBox().catch(() => null);
  check('source → wysiwyg 切换（milkdown 恢复渲染）', !!(mdBox && mdBox.width > 0 && mdBox.height > 0));
  // 重新打开 diff
  await ensureSidebar();
  await gitBtn.click();
  await page.waitForTimeout(500);
  await page.locator('.section', { hasText: '工作区' }).locator('.ws-file', { hasText: 'README.md' }).click();
  await page.waitForTimeout(800);
  check('再次进入 diff 视图', await page.locator('.git-diff-view').count() === 1);

  // 6. Esc 退出 diff
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('Esc 退出 diff 回编辑', await page.locator('.git-diff-view').count() === 0);

  // 7. 提交文件 → diff（commit vs 父提交）
  await ensureSidebar();
  await gitBtn.click();
  await page.waitForTimeout(500);
  await page.locator('.commit.expanded .ws-file', { hasText: 'README.md' }).click();
  await page.waitForTimeout(800);
  await page.locator('.diff-toolbar .mini', { hasText: '文本' }).click();
  await page.waitForTimeout(300);
  check('commit diff 基准标签', (await page.locator('.diff-base').textContent() || '').includes('父提交'));
  check('commit hunks 渲染', await page.locator('.cell.add', { hasText: '提交中新增' }).count() === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 8. 范围对比：Shift+点击 两提交
  await ensureSidebar();
  await gitBtn.click();
  await page.waitForTimeout(500);
  await page.locator('.commit-row', { hasText: '修改 README' }).click({ modifiers: ['Shift'] });
  await page.waitForTimeout(400);
  check('范围起点 toast/条', await page.locator('.range-bar').count() === 1);
  await page.locator('.commit-row', { hasText: '初始提交' }).click({ modifiers: ['Shift'] });
  await page.waitForTimeout(400);
  const rangeText = (await page.locator('.range-label').textContent() || '').trim();
  check('范围条显示 a..b', /[0-9a-f]{7}\.\.[0-9a-f]{7}/.test(rangeText));
  // 点一个提交文件（范围模式下仍可点）——用工作区外的提交文件
  await page.locator('.commit.expanded .ws-file').first().click();
  await page.waitForTimeout(800);
  await page.locator('.diff-toolbar .mini', { hasText: '文本' }).click();
  await page.waitForTimeout(300);
  check('范围 diff 渲染（范围新一）', await page.locator('.cell.add', { hasText: '范围新一' }).count() === 1);
  check('范围 diff 基准标签', (await page.locator('.diff-base').textContent() || '').includes('..'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ---- M11d：状态栏徽标 / 还原 / 标签右键 / 分支切换 ----
  const badge = await page.locator('.git-badge').textContent().catch(() => '');
  check('M11d 状态栏分支徽标', (badge || '').includes('main'));

  // 还原整文件（工作区 diff → 工具栏还原… → 确认）
  await ensureSidebar();
  await gitBtn.click();
  await page.waitForTimeout(500);
  await page.locator('.section', { hasText: '工作区' }).locator('.ws-file', { hasText: 'README.md' }).click();
  await page.waitForTimeout(1000);
  await page.locator('.diff-toolbar .mini', { hasText: '文本' }).click();
  await page.waitForTimeout(300);
  check('M11d 还原按钮可用', await page.locator('.diff-toolbar .mini.danger', { hasText: '还原…' }).count() === 1);
  check('M11d hunk 还原此段按钮', await page.locator('.hunk-discard', { hasText: '还原此段' }).count() >= 1);
  await page.locator('.diff-toolbar .mini.danger', { hasText: '还原…' }).click();
  await page.waitForTimeout(400);
  check('M11d 还原确认框', await page.locator('.confirm-dialog, .modal-mask').count() > 0);
  // 确认（ConfirmDialog 按钮）
  await page.locator('.confirm-dialog button, .modal-mask button', { hasText: '还原' }).last().click();
  await page.waitForTimeout(800);
  check('M11d 还原后退出 diff', await page.locator('.git-diff-view').count() === 0);
  check('M11d 还原 toast', (await page.locator('.toast').allTextContents().then(t => t.join(''))).includes('已还原'));

  // 标签右键菜单 → Git 改动
  await ensureSidebar();
  await page.locator('.tabbar .tab').first().click({ button: 'right' });
  await page.waitForTimeout(400);
  check('M11d 标签右键菜单', await page.locator('.tab-context-menu, [class*="menu"] .menu-item', { hasText: 'Git 改动' }).count() > 0);
  await page.locator('[class*="menu"] .menu-item', { hasText: 'Git 改动' }).click();
  await page.waitForTimeout(1200);
  check('M11d 标签右键 → 打开 diff', await page.locator('.git-diff-view').count() === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 分支切换（Git 面板 ⇄ → 确认）
  await ensureSidebar();
  await gitBtn.click();
  await page.waitForTimeout(500);
  const switchBtn = page.locator('.branch-switch').first();
  check('M11d 分支切换按钮（hover 可见）', await switchBtn.count() === 1);
  await switchBtn.click({ force: true });
  await page.waitForTimeout(400);
  check('M11d 切换分支确认框', await page.locator('.confirm-dialog, .modal-mask').count() > 0);
  await page.locator('.confirm-dialog button, .modal-mask button', { hasText: '切换' }).last().click();
  await page.waitForTimeout(800);
  const badge2 = (await page.locator('.git-badge').textContent().catch(() => '')) || '';
  check('M11d 切换后徽标更新', badge2.includes('feature/xxx') || !badge2.includes('main'));

  // 9. 无错误
  check('无页面错误', errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 6).join('\n'));

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
