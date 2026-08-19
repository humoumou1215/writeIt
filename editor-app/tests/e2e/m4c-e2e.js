// m4c-e2e —— 问题 1/3/4：完整路径显示、object_ref 点击跳转、平滑滚动
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m4c-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('m4c-e2e')
await L.installErrors()
await L.openApp('http://localhost:5173/?backend=mock')
await L.clickText('.tree .name', '引用演示.md', { label: '打开引用演示' })
await L.waitMs(8000)

// ---- 1. 完整路径显示 ----
const chipTexts = await js(`Array.from(document.querySelectorAll('a.ref-file')).map(a => a.textContent)`)
cliLog('file_ref 显示: ' + JSON.stringify(chipTexts))
C.check('显示完整路径（笔记/会议记录）', chipTexts.some(t => t === '笔记/会议记录'))
C.check('显示完整路径+片段', chipTexts.some(t => t === '笔记/会议记录#2026-08-11 周会'))

// ---- 3. object_ref 点击跳转 ----
// 当前在引用演示；点 版本号 对象 → 打开 周报 并滚到 版本 标题
C.check('找到 version 对象', (await L.q('span.ref-object[data-object="version"]')) > 0)
await L.clickEl('span.ref-object[data-object="version"]', 0, { label: '点 version 对象' })
await L.waitMs(1800)
const after = await js(`(() => {
  const tabs = Array.from(document.querySelectorAll('.tabbar .tab-name')).map(t => t.textContent.trim())
  return { tabs, active: tabs[tabs.length - 1] }
})()`)
cliLog('点击后标签: ' + JSON.stringify(after))
C.check('点击对象跳转打开周报', after.active === '周报.md')
// 检查是否滚动到版本标题附近（smooth 需要时间）
await L.waitMs(1200)
const scrollInfo = await js(`(() => {
  const visible = Array.from(document.querySelectorAll('.editor-pane')).find(p => p.offsetParent !== null || getComputedStyle(p).display !== 'none')
  const pm = visible ? visible.querySelector('.ProseMirror') : null
  const pane = visible
  const headings = pm ? Array.from(pm.querySelectorAll('h2')).map(h => ({ text: h.textContent.trim(), top: Math.round(h.getBoundingClientRect().top) })) : []
  return { scrollTop: pane ? pane.scrollTop : -1, headings }
})()`)
cliLog('滚动信息: ' + JSON.stringify(scrollInfo))
const verHeading = scrollInfo.headings.find(h => h.text.includes('版本'))
C.check('版本标题在视口内', verHeading && verHeading.top > -50 && verHeading.top < 600)

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
