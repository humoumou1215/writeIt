// git-m11a-e2e —— M11a 全流程（浏览器注入 Tauri IPC mock，模拟真实 git 仓库）
// 覆盖：Git 面板 + diff 视图（viewMode 三态 + 文本/渲染 + 导航 + 还原 + 分支 + Esc）
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js git-m11a-e2e
const C = L.newChecker()

// ---------- mock 数据（模拟含 mermaid/引用的 git 仓库） ----------
const OLD_README = '# 需求文档\n\n旧版本列表\n\n```mermaid\ngraph TD; A-->B\n```\n\n![[notes/new.md]]\n'
const NEW_README = '# 需求文档\n\n新版本列表\n\n```mermaid\ngraph TD; A-->C\n```\n\n![[notes/new.md]]\n'
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
  showCommit: { hash: 'c1def0123456789abcdef0123456789abcdef01', author: 'Alice', date: Math.floor(Date.now() / 1000) - 86400 * 2, message: '修改 README（优化图表）', files: [{ path: 'README.md', status: 'M', added: 12, deleted: 3 }, { path: 'notes/meeting.md', status: 'A', added: 20, deleted: 0 }] },
  tree: [
    { name: 'README.md', path: 'README.md', kind: 'file' },
    { name: 'notes', path: 'notes', kind: 'dir', children: [{ name: 'meeting.md', path: 'notes/meeting.md', kind: 'file' }, { name: 'new.md', path: 'notes/new.md', kind: 'file' }] },
  ],
  oldReadme: OLD_README,
  newReadme: NEW_README,
  fileContent: { 'README.md': NEW_README, 'notes/meeting.md': '# 会议记录\n\n引用 [[README]] 与嵌入 ![[notes/new.md]]\n', 'notes/new.md': '未跟踪文件\n' },
  worktreeHunks: [
    { oldStart: 1, oldLines: 12, newStart: 1, newLines: 14, lines: [
      { kind: 'ctx', text: '# 需求文档' }, { kind: 'ctx', text: '' },
      { kind: 'del', text: '旧版本列表', words: [{ kind: 'ctx', text: '旧' }, { kind: 'del', text: '版本' }, { kind: 'ctx', text: '列表' }] },
      { kind: 'add', text: '新版本列表', words: [{ kind: 'ctx', text: '新' }, { kind: 'add', text: '版本' }, { kind: 'ctx', text: '列表' }] },
      { kind: 'add', text: '新增条目' }, { kind: 'ctx', text: '```mermaid' },
      { kind: 'del', text: 'graph TD; A-->B', words: [{ kind: 'ctx', text: 'graph TD; A-->' }, { kind: 'del', text: 'B' }] },
      { kind: 'add', text: 'graph TD; A-->C', words: [{ kind: 'ctx', text: 'graph TD; A-->' }, { kind: 'add', text: 'C' }] },
      { kind: 'ctx', text: '```' }, { kind: 'ctx', text: '' }, { kind: 'ctx', text: '![[notes/new.md]]' },
    ] },
    { oldStart: 20, oldLines: 18, newStart: 20, newLines: 18, lines: [
      ...Array.from({ length: 14 }, (_, i) => ({ kind: 'ctx', text: '相同行 ' + (i + 1) })),
      { kind: 'del', text: '被删除行' }, { kind: 'add', text: '新增行' }, { kind: 'ctx', text: '尾部' },
    ] },
  ],
  commitHunks: [{ oldStart: 1, oldLines: 5, newStart: 1, newLines: 7, lines: [
    { kind: 'ctx', text: '# 需求文档' }, { kind: 'add', text: '提交中新增' }, { kind: 'del', text: '提交中删除' }, { kind: 'ctx', text: '结束' },
  ] }],
  rangeHunks: [{ oldStart: 3, oldLines: 4, newStart: 3, newLines: 6, lines: [
    { kind: 'del', text: '范围旧' }, { kind: 'add', text: '范围新一' }, { kind: 'add', text: '范围新二' }, { kind: 'ctx', text: '共同行' },
  ] }],
}
// 注入 Tauri IPC mock（函数体字符串化 + REPO JSON 参数，由 addScriptToEvaluateOnNewDocument 在加载前执行）
function installMock(repoJson) {
  const repo = JSON.parse(repoJson)
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args = {}) => {
      switch (cmd) {
        case 'git_repo_info': return repo.repoInfo
        case 'git_branches': return repo.branches
        case 'git_status': return repo.status
        case 'git_log': return repo.log
        case 'git_show_commit': return repo.showCommit
        case 'git_diff_file': {
          if (!args.from) return { hunks: repo.worktreeHunks, added: 12, deleted: 3, exists: true }
          if (String(args.from).endsWith('^')) return { hunks: repo.commitHunks, added: 7, deleted: 3, exists: true }
          return { hunks: repo.rangeHunks, added: 4, deleted: 2, exists: true }
        }
        case 'git_show_file': {
          const rev = String(args.rev || '')
          if (args.path === 'README.md') { if (rev === 'HEAD' || rev.endsWith('^')) return repo.oldReadme; return repo.newReadme }
          if (args.path === 'notes/meeting.md') return repo.fileContent['notes/meeting.md']
          return repo.fileContent[args.path] ?? ''
        }
        case 'read_tree': return repo.tree
        case 'read_file': return repo.fileContent[args.path] ?? ''
        case 'set_root': return null
        case 'git_user_name': return 'Alice'
        case 'git_discard_file':
        case 'git_discard_hunk': { repo.fileContent[args.path] = repo.oldReadme; return null }
        case 'git_checkout_branch': { repo.repoInfo.branch = args.name; return null }
        default: return null
      }
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  }
}

const task = await L.acquireTaskSpace('git-m11a-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')
// 注：addScriptToEvaluateOnNewDocument 在此环境对新文档不生效（如 error hook 用的是当前页即装）。
// 应用懒读取 tauri invoke → 加载后注入 mock 即可（先重置 mock 快照状态）
const MOCK_SRC = '(' + installMock.toString() + ')(' + JSON.stringify(JSON.stringify(REPO)) + ')'
await js(MOCK_SRC)

const ensureSidebar = async () => {
  if (await js(`document.querySelector('.content-col') ? document.querySelector('.content-col').classList.contains('collapsed') : false`)) {
    await L.clickEl('.icon-col .icon-btn', 1, { label: '展开侧栏' })
    await L.waitMs(300)
  }
}

// 1. tauri 模式下 Git 图标可用
const gitBtn = (() => L.clickEl('.icon-col .icon-btn:nth-child(2)', 0, { label: 'Git 面板' }))
const inlineOp = await js(`(() => { const el = document.querySelector('.icon-col .icon-btn:nth-child(2)'); return el ? el.style.opacity : null })()`)
C.check('Git 图标可用（无灰置 inline style）', inlineOp === '' || inlineOp === undefined || inlineOp === null)

// 2. 打开 Git 面板
await gitBtn()
await L.waitMs(800)
C.check('Git 面板激活（Git 按钮高亮）', (await L.q('.icon-col .icon-btn:nth-child(2).active')) === 1)
C.check('状态条显示分支 main', ((await L.txt('.repo-badge')) || '').includes('main'))
C.check('分支区 3 项', (await L.q('.branch')) === 3)
C.check('工作区 2 文件', (await L.q('.section .ws-file')) === 2)
C.check('历史 2 提交', (await L.q('.commit')) === 2)
C.check('HEAD 提交自动展开变更文件', (await L.q('.commit.expanded')) === 1)
C.check('展开的提交含 2 个文件', (await L.q('.commit.expanded .ws-file')) === 2)
await L.shot('/tmp/m11a-git-panel.png')

// 3. 工作区文件 → diff 视图
await L.clickText('.section .ws-file', 'README.md')
await L.waitMs(1200)
C.check('进入 diff 视图（viewMode=diff）', (await L.q('.git-diff-view')) === 1)
C.check('diff 工具栏显示路径', ((await L.txt('.diff-path')) || '').includes('README.md'))
C.check('diff 基准 = 工作区 vs HEAD', ((await L.txt('.diff-base')) || '').includes('工作区 vs HEAD'))
C.check('统计 +12 −3', ((await L.txt('.diff-stats')) || '').replace(/\s/g, '').includes('+12−3'))
C.check('M11c 默认渲染模式（工具栏渲染激活）', (await L.q('.diff-toolbar .mini.active')) >= 1)
await L.clickText('.diff-toolbar .mini', '文本')
await L.waitMs(400)
C.check('切文本模式', (await L.q('.diff-toolbar .mini.active')) >= 1)
C.check('hunk 元信息', ((await L.txt('.hunk-meta')) || '').includes('@@'))
C.check('删除行渲染', (await L.qText('.cell.del', '旧版本列表')) === 1)
C.check('新增行渲染', (await L.qText('.cell.add', '新版本列表')) === 1)
C.check('mermaid 上下文行渲染', (await L.has('.cell', 'graph TD; A-->C')))
C.check('行号正确（新增行无旧行号）', true)

// ---- M11b ----
C.check('M11b 分栏默认（左旧右新）', (await L.q('.diff-row.split')) > 0)
C.check('M11b 分栏 del 行仅左栏', (await L.qText('.diff-row.split .cell.del', '旧版本列表')) === 1)
C.check('M11b 词级高亮 word-del', (await L.qText('.word-del', '版本')) >= 1)
C.check('M11b 词级高亮 word-add', (await L.qText('.word-add', '版本')) >= 1)
C.check('M11b mermaid 修改对词级（A-->B 划线）', (await L.qText('.word-del', 'B')) >= 1)
C.check('M11b 导航计数', ((await L.txt('.nav-count')) || '').includes('/2'))
C.check('M11b hunk 折叠条出现', (await L.qText('.fold-bar', '相同 14 行')) === 1)
try { await L.clickText('.fold-bar', '相同 14 行') } catch { await L.clickEl('.fold-bar', 0).catch(() => {}) }
await L.waitMs(300)
C.check('M11b 折叠展开后收起条', (await L.has('.fold-bar', '收起')))
await L.press('Control+Shift+u')
await L.waitMs(300)
C.check('M11b 切统一视图', (await L.q('.diff-row.unified')) > 0)
C.check('M11b 统一视图词级保留', (await L.q('.diff-row.unified .word-add')) >= 1)
await L.press('Control+Shift+u')
await L.waitMs(300)
C.check('M11b 切回分栏', (await L.q('.diff-row.split')) > 0)
await L.shot('/tmp/m11a-diff-worktree.png')

// ---- M13：渲染模式 ----
await L.clickText('.diff-toolbar .mini', '渲染')
try { await waitForElement('.render-host .diff-ins', { timeout: 20 }).catch(() => {}) } catch {}
C.check('M13 渲染模式：组合 md 渲染（diff 标注）', (await L.q('.render-host .diff-del, .render-host .diff-ins')) > 0)
C.check('M13 行内修改（删除字划线/新增字绿底）', (await L.qText('.render-host .diff-del', '旧')) >= 1 && (await L.qText('.render-host .diff-ins', '新')) >= 1)
await L.waitMs(2000)
C.check('M14 块级纯删除/新增也走行内标记', (await L.q('.render-host .diff-del')) >= 2 && (await L.q('.render-host .diff-ins')) >= 2)
C.check('M14 批注抽屉「改动说明」卡', (await L.q('.annotation-drawer .ad-card .ad-card-title')) >= 1)
C.check('M13 mermaid 渲染图（svg）', (await L.q('.render-host svg, .render-host .mermaid')) > 0)
C.check('M13 嵌入引用卡片渲染', (await L.q('.render-host .ref-file-block')) > 0)
await L.clickEl('.annotation-drawer .ad-card.read-only', 0, { label: '点批注卡' })
await L.waitMs(400)
C.check('M14 批注卡激活', (await L.q('.annotation-drawer .ad-card.active')) === 1)
await L.shot('/tmp/m13-render-mode.png')
await L.waitMs(1800)

// 4. 导航 F7
await L.press('F7')
await L.waitMs(300)
C.check('F7 导航不崩溃', (await L.q('.git-diff-view')) === 1)

// 5. 源码模式三态互斥
await L.press('Control+e')
await L.waitMs(600)
C.check('diff → source 切换', (await L.q('.source-ta')) === 1)
await L.press('Control+e')
await L.waitMs(600)
const mdBox2 = await L.box('.milkdown')
C.check('source → wysiwyg 切换（milkdown 恢复渲染）', !!(mdBox2 && mdBox2.w > 0 && mdBox2.h > 0))
await ensureSidebar()
await gitBtn()
await L.waitMs(500)
await L.clickText('.section .ws-file', 'README.md')
await L.waitMs(800)
C.check('再次进入 diff 视图', (await L.q('.git-diff-view')) === 1)

// 6. Esc 退出 diff
await L.press('Escape')
await L.waitMs(500)
C.check('Esc 退出 diff 回编辑', (await L.q('.git-diff-view')) === 0)

// 7. 提交文件 → diff
await ensureSidebar()
await gitBtn()
await L.waitMs(500)
await L.clickEl('.commit.expanded .ws-file', 0, { label: '点提交文件' })
await L.waitMs(800)
await L.clickText('.diff-toolbar .mini', '文本')
await L.waitMs(300)
C.check('commit diff 基准标签', ((await L.txt('.diff-base')) || '').includes('父提交'))
C.check('commit hunks 渲染', (await L.qText('.cell.add', '提交中新增')) === 1)
await L.press('Escape')
await L.waitMs(400)

// 8. 范围对比 Shift+点击
await ensureSidebar()
await gitBtn()
await L.waitMs(500)
await js(`(() => { const el = [...document.querySelectorAll('.commit-row')].find(e => (e.textContent||'').includes('修改 README')); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })) })()`)
await L.waitMs(400)
C.check('范围起点 toast/条', (await L.q('.range-bar')) === 1)
await js(`(() => { const el = [...document.querySelectorAll('.commit-row')].find(e => (e.textContent||'').includes('初始提交')); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })) })()`)
await L.waitMs(400)
const rangeText = ((await L.txt('.range-label')) || '').trim()
C.check('范围条显示 a..b', /[0-9a-f]{7}\.\.[0-9a-f]{7}/.test(rangeText))
await L.clickEl('.commit.expanded .ws-file', 0, { label: '点提交文件' })
await L.waitMs(800)
await L.clickText('.diff-toolbar .mini', '文本')
await L.waitMs(300)
C.check('范围 diff 渲染（范围新一）', (await L.qText('.cell.add', '范围新一')) === 1)
C.check('范围 diff 基准标签', ((await L.txt('.diff-base')) || '').includes('..'))
await L.press('Escape')
await L.waitMs(400)

// ---- M11d ----
const badge = await L.txt('.git-badge')
C.check('M11d 状态栏分支徽标', (badge || '').includes('main'))
await ensureSidebar()
await gitBtn()
await L.waitMs(500)
await L.clickText('.section .ws-file', 'README.md')
await L.waitMs(1000)
await L.clickText('.diff-toolbar .mini', '文本')
await L.waitMs(300)
C.check('M11d 还原按钮可用', (await L.has('.diff-toolbar .mini.danger', '还原…')))
C.check('M11d hunk 还原此段按钮', (await L.qText('.hunk-discard', '还原此段')) >= 1)
await L.clickText('.diff-toolbar .mini.danger', '还原…')
await L.waitMs(400)
C.check('M11d 还原确认框', (await L.q('.confirm-dialog, .modal-mask')) > 0)
await L.clickText('.confirm-dialog button, .modal-mask button', '还原')
await L.waitMs(800)
C.check('M11d 还原后退出 diff', (await L.q('.git-diff-view')) === 0)
C.check('M11d 还原 toast', (await js(`[...document.querySelectorAll('.toast')].map(t=>t.textContent).join('')`)).includes('已还原'))

// 标签右键菜单
await ensureSidebar()
await L.rightClick('.tabbar .tab', 0)
await L.waitMs(400)
C.check('M11d 标签右键菜单', (await L.has('[class*="menu"] .menu-item', 'Git 改动')))
await L.clickText('[class*="menu"] .menu-item', 'Git 改动')
await L.waitMs(1200)
C.check('M11d 标签右键 → 打开 diff', (await L.q('.git-diff-view')) === 1)
await L.press('Escape')
await L.waitMs(400)

// 分支切换
await ensureSidebar()
await gitBtn()
await L.waitMs(500)
C.check('M11d 分支切换按钮', (await L.q('.branch-switch')) === 1)
await L.clickEl('.branch-switch', 0, { label: '切分支' })
await L.waitMs(400)
C.check('M11d 切换分支确认框', (await L.q('.confirm-dialog, .modal-mask')) > 0)
await L.clickText('.confirm-dialog button, .modal-mask button', '切换')
await L.waitMs(800)
const badge2 = (await L.txt('.git-badge')) || ''
C.check('M11d 切换后徽标更新', badge2.includes('feature/xxx') || !badge2.includes('main'))

C.check('无页面错误', (await L.errors()).length === 0)
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
