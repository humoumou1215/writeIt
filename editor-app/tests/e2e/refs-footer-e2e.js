// refs-footer-e2e —— 引用/被引用 底部展示区：点击 chip 打开目标文件
// 回归：b3be328 引入的 footer 点击直接 openTab(path)，而向外引用 path 是文档内写法（无扩展名）
//   → fs.readFile 失败「打开失败」；修复：复用 handleOpenRef（resolveRefPath 补扩展名/Obsidian 基线名匹配）。
// 注意：每个标签有独立 footer（全在 DOM，非活动 display:none）——查询/点击必须限定活动 pane。
// 运行：node tests/e2e/_run-one.js refs-footer-e2e
const task = await L.acquireTaskSpace('refs-footer-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const C = L.newChecker()
// 活动 pane（可见编辑器容器）限定选择器
const AP = '.editor-pane:not([style*="display: none"])'
const hasTab = (name) => js(
  `[...document.querySelectorAll('.tab-name')].some(e => (e.textContent || '').includes(${L.J(name)}))`
)
const errToastCount = () => L.q('.toast.error')

// ---------- 场景 1：向外引用（「引用了」区）点击打开 ----------
// 引用演示.md 向外引用：README.md / 笔记/会议记录(链接) / 笔记/待办清单(嵌入) / 笔记/周报(对象)
await L.treeClick('引用演示.md')
await L.waitMs(4000)

C.check('footer 展示区存在', (await L.q(`${AP} .refs-footer`)) >= 1)
C.check('「引用了」区 chip 数量 >= 3', (await L.q(`${AP} .refs-footer-section.outgoing .refs-chip`)) >= 3)
C.check('「引用了」区含 会议记录', (await L.txt(`${AP} .refs-footer-section.outgoing`)).includes('会议记录'))

// 点击「笔记/会议记录」chip（文档内写法、无扩展名 → 修复前 fs.readFile 直接失败）
await L.clickText(`${AP} .refs-footer-section.outgoing .refs-chip`, '笔记/会议记录', { label: '点击引用了区 会议记录' })
await L.waitMs(2500)
C.check('新标签打开 会议记录', await hasTab('会议记录'))
C.check('无「打开失败」toast(会议记录)', (await errToastCount()) === 0)

// 点击「README.md」chip（无目录前缀 → 需 Obsidian 基线名匹配）
await L.clickText('.tab', '引用演示', { label: '切回引用演示' })
await L.waitMs(800)
await L.clickText(`${AP} .refs-footer-section.outgoing .refs-chip`, 'README.md', { label: '点击引用了区 README' })
await L.waitMs(2500)
C.check('新标签打开 README.md', await hasTab('README'))
C.check('无「打开失败」toast(README)', (await errToastCount()) === 0)

// 点击「笔记/待办清单」chip（嵌入引用，无扩展名）
await L.clickText('.tab', '引用演示', { label: '切回引用演示(2)' })
await L.waitMs(800)
await L.clickText(`${AP} .refs-footer-section.outgoing .refs-chip`, '待办清单', { label: '点击引用了区 待办清单' })
await L.waitMs(2500)
C.check('新标签打开 待办清单', await hasTab('待办清单'))
C.check('无「打开失败」toast(待办清单)', (await errToastCount()) === 0)

// ---------- 场景 2：反向引用（「被引用」区）点击打开 ----------
// 笔记/会议记录.md 的反向引用来源 = 引用演示.md（两处 [[笔记/会议记录]]）
await L.treeClick('笔记')
await L.waitMs(500)
await L.treeClick('笔记/会议记录.md')
await L.waitMs(4000)
const incomingTxt = await L.txt(`${AP} .refs-footer-section.incoming`)
C.check('「被引用」区含来源 引用演示', incomingTxt.includes('引用演示'))
await L.clickText(`${AP} .refs-footer-section.incoming .refs-chip`, '引用演示', { label: '点击被引用区 引用演示' })
await L.waitMs(2500)
C.check('点击被引用来源激活 引用演示', (await L.txt('.tab.active .tab-name')).includes('引用演示'))
C.check('无「打开失败」toast(incoming)', (await errToastCount()) === 0)

const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)
