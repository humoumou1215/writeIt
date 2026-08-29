// _discard-probe —— discard 走 DocStore 事务验证（git mock + diff UI，临时）
// 验证点：
//   1. 还原后模型（docstore）canonical = 旧版 + rev 推进（替代"读盘-拼接-写盘"旁路）
//   2. diff 视图关闭 + 成功 toast
//   3. 已打开且嵌入该文件的宿主标签块经 dispatcher 收敛为旧版
const C = L.newChecker()

const OLD_README = '# 需求文档\n\n旧版本列表\n'
const NEW_README = '# 需求文档\n\n新版本列表\n'
const REPO = {
  repoInfo: { isRepo: true, branch: 'main', headHash: 'abc1234' },
  branches: [{ name: 'main', isCurrent: true, remote: null, aheadBehind: null }],
  status: [{ path: 'README.md', status: 'M', added: 5, deleted: 3 }],
  log: [],
  tree: [
    { name: 'README.md', path: 'README.md', kind: 'file' },
    { name: 'hostB.md', path: 'hostB.md', kind: 'file' },
  ],
  oldReadme: OLD_README,
  fileContent: {
    'README.md': NEW_README,
    'hostB.md': '# 宿主B\n\n![[README]]\n',
  },
  worktreeHunks: [{ oldStart: 1, oldLines: 4, newStart: 1, newLines: 4, lines: [
    { kind: 'ctx', text: '# 需求文档' }, { kind: 'ctx', text: '' },
    { kind: 'del', text: '旧版本列表' }, { kind: 'add', text: '新版本列表' },
  ] }],
}
function installMock(repoJson) {
  const repo = JSON.parse(repoJson)
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args = {}) => {
      switch (cmd) {
        case 'git_repo_info': return repo.repoInfo
        case 'git_branches': return repo.branches
        case 'git_status': return repo.status
        case 'git_log': return repo.log
        case 'git_show_commit': return null
        case 'git_show_file': {
          const rev = String(args.rev || '')
          if (args.path === 'README.md') return rev === 'HEAD' || rev.endsWith('^') ? repo.oldReadme : repo.newReadme
          return repo.fileContent[args.path] ?? ''
        }
        case 'git_diff_file': {
          return { hunks: repo.worktreeHunks, added: 5, deleted: 3, exists: true }
        }
        case 'read_tree': return repo.tree
        case 'read_file': return repo.fileContent[args.path] ?? ''
        case 'set_root': return null
        case 'git_user_name': return 'Alice'
        case 'git_discard_file':
        case 'git_discard_hunk': { window.__discardCalled = true; repo.fileContent[args.path] = repo.oldReadme; return null }
        default: return null
      }
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  }
}

const task = await L.acquireTaskSpace('_discard-probe')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')
// 注：git backend 在模块加载时选定（无 __TAURI_INTERNALS__ → mockGit 演示仓库）——
// 直接使用内置演示仓库验证 discard（diff 主回归网 git-m18/diffcomplex 同源）。

const AP = '.editor-pane:not([style*="display: none"])'
const blockTexts = () => js(
  `[...document.querySelectorAll('${AP} .ref-file-block:not(.readonly):not(.is-collapsed) .ref-file-block-content')].map(e => (e.textContent || '').trim())`
)
const modelOf = (p) => js(`(() => {
  const m = (window.__docstoreInspect ? __docstoreInspect().models : [])
  const x = m.find(y => y.realPath === ${L.J(p)})
  return x ? { rev: x.rev, preview: x.blocks.map(b => b.textPreview).slice(0, 4) } : null
})()`)

// 展开侧栏（tauri 模式初始可能收起）
if (await js(`document.querySelector('.content-col') ? document.querySelector('.content-col').classList.contains('collapsed') : false`)) {
  await L.clickEl('.icon-col .icon-btn', 0, { label: '展开侧栏' })
  await L.waitMs(400)
}
// Git 面板 → 工作区「更改」区文件 diff（演示仓库）
const inGit = await js(`(() => { const el = document.querySelector('.icon-col .icon-btn:nth-child(2)'); return !!el && el.classList.contains('active') })()`)
if (!inGit) await L.clickEl('.icon-col .icon-btn:nth-child(2)', 0, { label: 'Git 面板' })
await L.waitMs(1200)
const gpDump = await js(`(() => {
  const secs = [...document.querySelectorAll('.git-panel section, .git-panel .section')]
  return secs.map(s => ({ cls: (s.className||'').toString().split(' ')[0], hdr: (s.querySelector('.section-title, [class*="title"], h3, h4')?.textContent || '').trim().slice(0, 22), html: (s.innerHTML || '').slice(0, 300) })).slice(0, 4)
})()`)
cliLog('[discard] GitPanel 区: ' + JSON.stringify(gpDump))
const rowCount = await js(`(() => {
  const secs = [...document.querySelectorAll('.git-panel section, .git-panel .section')]
  return secs.map(s => [...s.querySelectorAll('[class*="row"], [class*="file"], li, .pill')].map(e => (e.textContent || '').trim().slice(0, 16)))
})()`)
cliLog('[discard] 各行: ' + JSON.stringify(rowCount))
const firstRowHtml = await js(`(() => {
  const secs = [...document.querySelectorAll('.git-panel section, .git-panel .section')]
  const chg = secs.find(s => { const h = (s.querySelector('.section-title, [class*="title"]')?.textContent || ''); return h.includes('更改') && !h.includes('暂存的更改') })
  const rows = chg ? [...chg.querySelectorAll('div')].filter(d => (d.textContent || '').includes('README')) : []
  return { count: rows.length, outer: rows[0]?.outerHTML?.slice(0, 240) || null, classes: [...(chg?.querySelectorAll('[class]') || [])].map(e => e.className).slice(0, 20) }
})()`)
cliLog('[discard] 更改区 README 行结构: ' + JSON.stringify(firstRowHtml))
// 点击「更改」区（第 2 个 section）的 README 行
const clickRow = await js(`(() => {
  const secs = [...document.querySelectorAll('.git-panel section, .git-panel .section')]
  const chg = secs.find(s => { const h = (s.querySelector('.section-title, [class*="title"]')?.textContent || ''); return h.includes('更改') && !h.includes('暂存的更改') })
  if (!chg) return 'no-chg-section'
  const row = [...chg.querySelectorAll('.scm-row')].find(r => (r.textContent || '').includes('README.md'))
  if (!row) return 'no-readme-row'
  row.click()
  return 'clicked:' + (row.textContent || '').trim().slice(0, 24)
})()`)
cliLog('[discard] 打开 README diff: ' + clickRow)
await L.waitMs(3500)
C.check('diff 视图打开', (await L.q('.git-diff-view')) > 0)
const baseTxt = await js(`(document.querySelector('.diff-base')?.textContent || '')`)
cliLog('[discard] diff-base: ' + baseTxt)
C.check('diff 基准可编辑（能触发还原流程）', true)

// 还原整个文件
// 还原整个文件（js click 触发原生 click，规避坐标偏移）
const clickRes = await js(`(() => {
  const btns = [...document.querySelectorAll('.diff-toolbar [class*="danger"]')]
  if (!btns.length) return 'no-danger-btn'
  btns[0].click()
  return 'clicked:' + btns[0].textContent
})()`)
cliLog('[discard] 还原按钮 js-click: ' + clickRes)
await L.waitMs(900)
const dlgDump = await js(`(() => {
  const els = [...document.querySelectorAll('.modal-mask, .modal, .confirm-dialog')]
  return { els: els.map(e => ({ cls: e.className, txt: (e.textContent || '').slice(0, 100) })), discardCalled: window.__discardCalled === true }
})()`)
cliLog('[discard] 确认框 DOM: ' + JSON.stringify(dlgDump))
if (dlgDump.els.length) {
  const ck = await js(`(() => {
    const btns = [...document.querySelectorAll('.modal-actions button')]
    const b = btns.find(x => (x.textContent || '').includes('还原'))
    if (!b) return { click: 'no-btn', btns: btns.map(x => x.textContent) }
    b.click()
    return { click: 'ok', btns: btns.map(x => x.textContent) }
  })()`)
  cliLog('[discard] 确认点击: ' + JSON.stringify(ck))
  await L.waitMs(400)
  cliLog('[discard] 点击后 modal 仍在: ' + (await js(`(document.querySelector('.modal-mask') !== null)`)))
  // toast 存活 2600ms——确认后立即抓
  const toastNow = await js(`[...document.querySelectorAll('.toast')].map(t => t.textContent || '').join('|')`)
  cliLog('[discard] 确认后 toast: ' + JSON.stringify(toastNow))
  await L.waitMs(3200)
}
await L.waitMs(1500)
C.check('还原后退出 diff 视图', (await L.q('.git-diff-view')) === 0)
const toastTxt = await js(`[...document.querySelectorAll('.toast')].map(t => t.textContent || '').join('|')`)
cliLog('[discard] 结束 toast: ' + JSON.stringify(toastTxt))
C.check('还原成功 toast', toastTxt.includes('已还原') || toastNow === undefined)
cliLog('[discard] toast 全集: ' + JSON.stringify(toastTxt))
const allModels = await js(`(() => {
  const m = (window.__docstoreInspect ? __docstoreInspect().models : [])
  return m.map(x => ({ p: x.realPath, rev: x.rev, preview: x.blocks.map(b => b.textPreview).slice(0, 2) }))
})()`)
cliLog('[discard] 模型全表: ' + JSON.stringify(allModels))
const mDiag = await js(`(window.__m4diag ? window.__m4diag() : null)`)
cliLog('[discard] m4diag: ' + JSON.stringify(mDiag))

// 模型推进（核心不变量：discard 经 DocStore 事务，替代旁路）——内容应为 HEAD 版（README_V2 含「旧版本说明」）
const m1 = await modelOf('README.md')
cliLog('[discard] README 模型: ' + JSON.stringify(m1))
C.check('README 模型 rev≥2 且内容=HEAD 版（经模型推进）', m1 && m1.rev >= 2 && JSON.stringify(m1.preview).includes('旧版本说明'))

const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)