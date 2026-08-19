// m3-e2e —— M3 文件树联动：chip 跳转 / 断链替换 / 只读守卫 / 重命名联动
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m3-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('m3-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const freshPara = async () => {
  await L.focusEditor()
  await L.goEnd()
  await L.waitMs(600)
  await L.press('Enter')
  await L.waitMs(300)
}
const ensureSidebar = async () => {
  const collapsed = await js(`(() => { const el = document.querySelector('.content-col'); return el ? el.classList.contains('collapsed') : false })()`)
  if (collapsed) {
    await L.clickEl('.icon-col .icon-btn', 0)
    await L.waitMs(400)
  }
}
const switchToDemo = async () => {
  await L.clickText('.tab', '引用演示')
  await L.waitMs(800)
}
const waitMenu = async (open, timeout = 4000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const n = await js(`document.querySelectorAll('[data-ref-menu] .menu-group li').length`)
    if (open && n > 0) return true
    if (!open && n === 0) return true
    await L.waitMs(100)
  }
  return false
}
const waitBroken = async (timeout = 4000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const n = await js(`document.querySelectorAll('a.ref-file.ref-broken').length`)
    if (n > 0) return n
    await L.waitMs(100)
  }
  return 0
}
const entryLabels = () => js(`[...document.querySelectorAll('[data-ref-menu] .menu-group li > span:nth-child(2)')].map(s => s.textContent.trim())`)
const md = () => L.pageMd()
// 右键弹出树菜单并等待 .menu-item 出现（失败重试右键），替代 playwright 右键+click
const openCtx = async (sel, text, timeout = 3000) => {
  for (let t = 0; t < 3; t++) {
    await L.rightClickText(sel, text)
    const start = Date.now()
    while (Date.now() - start < timeout) {
      await L.waitMs(150)
      if ((await js(`document.querySelectorAll('.menu-item').length`)) > 0) return true
    }
    await L.press('Escape').catch(() => {})
  }
  return false
}

// ===== 1. chip 点击跳转 =====
await L.clickText('.tree .name', '引用演示.md', { label: '打开引用演示' })
await L.waitMs(3500)
const tabsBefore = (await js(`[...document.querySelectorAll('.tab-name')].map(e => e.textContent)`)).length
await L.clickEl('a.ref-file[data-path="README.md"]', 0, { label: '点 chip' })
await L.waitMs(2000)
const tabsAfter = await js(`[...document.querySelectorAll('.tab-name')].map(e => e.textContent)`)
C.check('点击 chip 打开新标签(README)', tabsAfter.length === tabsBefore + 1 && tabsAfter.some(t => t.includes('README')))
// 关闭 README 标签，后续全部在引用演示中操作
await L.middleClickText('.tab', 'README')
await L.waitMs(800)

// ===== 2. 断链（先引用 Mermaid → 删除 → 断链 → 替换）=====
// 注：工作区演进后含多条 mermaid 文件，「[[Mermaid」会匹配到 git-diff 验收文件；
// 用完整名「[[Mermaid 图表集」使其唯一命中；且当前应用文件级 Enter=直接插入链接（旧版需两次 Enter 下钻）。
await switchToDemo()
await freshPara()
await L.type('[[Mermaid 图表集')
await waitMenu(true)
await L.press('Enter')
await L.waitMs(800)
C.check('已引用 Mermaid 图表集', (await md()).includes('[[Mermaid 图表集]]'))

await ensureSidebar()
await openCtx('.tree .name', 'Mermaid 图表集.md')
await L.clickText('.menu-item.danger', '删除')
await L.waitMs(400)
await L.clickText('.modal .danger', '删除')
await L.waitMs(1000)
C.check('删除后引用变断链', (await waitBroken()) >= 1)

// 断链重选（树导航替换）
await L.clickEl('a.ref-file.ref-broken', 0, { label: '点断链' })
await L.waitMs(600)
C.check('断链点击打开替换菜单', await waitMenu(true))
const rootLabels = await entryLabels()
const noteIdx = rootLabels.findIndex(t => t === '笔记')
for (let i = 0; i < noteIdx; i++) await L.press('ArrowDown')
await L.press('Enter')
await L.waitMs(400)
const noteLabels = await entryLabels()
const todoIdx = noteLabels.findIndex(t => t.includes('待办清单'))
for (let i = 0; i < todoIdx; i++) await L.press('ArrowDown')
await L.press('Enter')
await L.waitMs(1000)
C.check('替换后断链消失', (await waitBroken(2000)) === 0)
const md2 = await md()
cliLog('替换后 md 含 Mermaid: ' + md2.includes('Mermaid') + ' | 尾部: ' + JSON.stringify(md2.slice(-120)))
C.check('替换为 [[笔记/待办清单]]', md2.includes('[[笔记/待办清单]]'))

// ===== 3. 只读事务守卫 =====
await switchToDemo()
await freshPara()
await L.type('![[会议')
await waitMenu(true)
await L.press('ArrowRight') // 嵌入只读
await L.waitMs(200)
await L.press('Enter')
await L.waitMs(1200)
await L.clickEl('.ref-file-block.readonly .ref-file-block-content', 0, { dx: 30, dy: 30 })
await L.type('注入内容')
await L.waitMs(500)
const readonlyText = await L.txt('.ref-file-block.readonly')
C.check('只读卡片未被注入内容', !readonlyText.includes('注入内容'))

// ===== 4. 重命名联动 =====
await switchToDemo()
await ensureSidebar()
await openCtx('.tree .name', 'README.md')
await L.clickText('.menu-item', '重命名')
await L.waitMs(400)
await L.fill('.tree .rename-input', 'README-改.md')
await L.press('Enter')
await L.waitMs(1500)
const mdAfter = await md()
cliLog('重命名后 md 中的 README 相关: ' + JSON.stringify(mdAfter.split('\n').filter(l => l.includes('README'))))
C.check('重命名后引用联动更新', mdAfter.includes('[[README-改]]'))
C.check('旧引用已清除', !mdAfter.includes('[[README]]') || mdAfter.includes('![[README.md|ro]]'))
// 恢复
await openCtx('.tree .name', 'README-改.md')
await L.clickText('.menu-item', '重命名')
await L.waitMs(400)
await L.fill('.tree .rename-input', 'README.md')
await L.press('Enter')
await L.waitMs(1200)

await L.shotTo('16-文件树联动-M3.png')
cliLog(C.summary())
const errs = await L.errors()
cliLog('== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
