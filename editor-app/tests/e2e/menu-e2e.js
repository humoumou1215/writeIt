// menu-e2e —— M2 触发菜单：@ / [[ / ![[ 三级递进 + 模式切换 + 过滤 + 劈分
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js menu-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('menu-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const menuCount = () => L.q('[data-ref-menu] .menu-group li')
const waitMenu = async (open, timeout = 4000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const n = await menuCount()
    if (open && n > 0) return true
    if (!open && n === 0) return true
    await L.waitMs(100)
  }
  return false
}
const menuOpen = async () => (await menuCount()) > 0
const entryLabels = () => js(`[...document.querySelectorAll('[data-ref-menu] .menu-group li > span:nth-child(2)')].map(s => s.textContent.trim())`)
const selectedMode = () => L.txt('[data-ref-menu] .tab-group li.selected')
const freshPara = async () => {
  await L.focusEditor()
  await L.goEnd()
  await L.press('Enter')
  await L.waitMs(200)
}

// 打开测试文件
await L.clickEl('.sidebar-actions .mini[title="新建文件"]', 0, { label: '新建文件' })
await L.waitMs(300)
await L.fill('.tree .rename-input', '菜单测试.md')
await L.press('Enter')
await L.waitMs(1500)
C.check('测试文件已打开', (await js(`[...document.querySelectorAll('.tab-name')].map(e => e.textContent)`)).includes('菜单测试.md'))

// ===== 1. [[ 触发：模式选择器 + 根级文件树 =====
await freshPara()
await L.type('[[')
C.check('[[ 弹出菜单', await waitMenu(true))
const modes = await js(`[...document.querySelectorAll('[data-ref-menu] .tab-group li')].map(m => m.textContent)`)
C.check('模式选择器三态（链接/嵌入/嵌入只读）', modes.length === 3 && modes.some(m => m.includes('链接')) && modes.some(m => m.includes('嵌入')))
C.check('默认链接模式', (await selectedMode()).trim() === '链接')
const rootEntries = await entryLabels()
C.check('根级含目录 笔记', rootEntries.some(t => t === '笔记'))
C.check('根级含文件 README', rootEntries.some(t => t.includes('README')))
C.check('文件只出现一次', rootEntries.filter(t => t.includes('README')).length === 1)

// ===== 2. 目录逐级发现 =====
const noteIdx = (await entryLabels()).findIndex(t => t === '笔记')
for (let i = 0; i < noteIdx; i++) await L.press('ArrowDown')
await L.press('Enter')
await L.waitMs(400)
const noteChildren = await entryLabels()
C.check('进入笔记目录后显示子文件', noteChildren.some(t => t.includes('会议记录')) && noteChildren.some(t => t.includes('待办清单')))
await L.press('Backspace')
await L.waitMs(300)
const backRoot = await entryLabels()
C.check('Backspace 返回根级', backRoot.some(t => t === '笔记'))

// ===== 3. 过滤（全树搜索）=====
await L.type('会议')
await L.waitMs(300)
const filtered = await entryLabels()
// M14：Git 演示仓库新增 Git演示/笔记/会议纪要.md → 过滤 '会议' 命中 2 个
C.check('过滤显示 笔记/会议记录（含 Git 演示同名）', filtered.length >= 2 && filtered.some(t => t.includes('笔记/会议记录')) && filtered.some(t => t.includes('Git演示/笔记/会议纪要')))
await L.press('Backspace')
await L.waitMs(300)
const h6AfterBs = await L.txt('[data-ref-menu] .menu-group h6')
C.check('Backspace 删一个字符细化过滤', h6AfterBs.includes('搜索：会'))
await L.press('Backspace')
await L.waitMs(300)
C.check('清空过滤回到树', (await entryLabels()).some(t => t === '笔记'))

// ===== 4. 过滤词「记录」→ 文件（Git 演示同名存在，用精确词命中 fs 演示文件）=====
await L.type('记录')
await L.waitMs(300)
// 注：应用演进后，文件级 Enter = 直接插入链接（不再下钻实体级）；先 ArrowRight 下钻实体级。
await L.press('ArrowRight')
await L.waitMs(800)
const entFirst = (await entryLabels())[0] ?? ''
C.check('文件进入实体级（首项=文件本身）', entFirst.includes('会议记录'))
await L.press('Enter')
await L.waitMs(400)
C.check('菜单关闭', await waitMenu(false))
C.check('插入 file_ref chip', (await L.q('a.ref-file')) >= 1)
const md1 = await L.pageMd()
C.check('序列化为 [[笔记/会议记录]]', md1.includes('[[笔记/会议记录]]'))

// ===== 5. ![[ 嵌入：默认模式 + 插入物化 =====
await freshPara()
await L.type('![[待办')
C.check('![[ 弹出菜单', await waitMenu(true))
C.check('默认嵌入模式', (await selectedMode()).trim() === '嵌入')
await L.press('Enter')
await L.waitMs(1500)
C.check('插入 file_block 卡片', (await L.q('.ref-file-block')) >= 1)
const blockText = await L.txt('.ref-file-block')
C.check('嵌入卡片已物化(待办清单)', blockText.includes('待办清单'))

// ===== 6. ←→ 切模式（嵌入只读）=====
await freshPara()
await L.type('![[会议')
await waitMenu(true)
await L.press('Tab')
await L.waitMs(200)
C.check('Tab 切到嵌入只读', (await selectedMode()).trim() === '嵌入只读')
await L.press('Enter')
await L.waitMs(1200)
C.check('插入只读卡片', (await L.q('.ref-file-block.readonly')) >= 1)

// ===== 7. @ 边界 =====
await freshPara()
await L.type('联系@小明')
await L.waitMs(400)
C.check('中文紧贴 @ 不触发', !(await menuOpen()))
await L.type(' @')
const okAt = await waitMenu(true)
if (!okAt) {
  const st = await js(`(() => ({
    show: document.querySelector('[data-ref-menu]') ? document.querySelector('[data-ref-menu]').getAttribute('data-show') : null,
    doc: window.__editorGetMarkdown().slice(-30),
    recent: window.__refMenuState ? window.__refMenuState.recentTyped : null,
    q: window.__refMenuState ? window.__refMenuState.query : null,
  }))()`)
  cliLog('[debug] @ 触发失败状态: ' + JSON.stringify(st))
}
C.check('空格后 @ 触发', okAt)
await L.press('Escape')
C.check('Esc 关闭', await waitMenu(false))

// ===== 8. 段落中间嵌入 → 自动劈分 =====
await freshPara()
await L.type('前段文字')
await L.type('![[数据/原始')
await waitMenu(true)
const pre = await js(`(() => ({
  show: document.querySelector('[data-ref-menu]') ? document.querySelector('[data-ref-menu]').getAttribute('data-show') : null,
  items: Array.from(document.querySelectorAll('[data-ref-menu] .menu-group li')).map(li => li.textContent.trim()).slice(0, 3),
  hover: document.querySelector('[data-ref-menu] .menu-group li.hover') ? document.querySelector('[data-ref-menu] .menu-group li.hover').textContent.trim() : null,
}))()`)
cliLog('[debug] Enter 前菜单: ' + JSON.stringify(pre))
await L.press('Enter')
await L.waitMs(1200)
const mdFinal = await L.pageMd()
cliLog('[debug] mdFinal: ' + JSON.stringify(mdFinal.slice(-200)))
C.check('劈分后嵌入存在', mdFinal.includes('![[数据/原始数据]]') && mdFinal.includes('前段文字'))

await L.shotTo('15-三级递进菜单.png')
cliLog(C.summary())
const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)
