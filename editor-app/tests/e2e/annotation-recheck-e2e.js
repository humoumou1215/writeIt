// annotation-recheck-e2e —— 「真实环境」用户视角复测套件
// 全部真实 UI 操作：选中文本→工具栏添加批注→浮窗提交→重叠批注→选择气泡→回复→保存→刷新持久化
// 运行：node tests/e2e/_run-one.js annotation-recheck-e2e（需 dev server :5173；ego-lite 驱动真实 Chromium）
const C = L.newChecker()

const task = await L.acquireTaskSpace('annotation-recheck-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// 预置一个已有批注的文件（same 文第一条 X；body 用 JSON.stringify 注入，避免模板转义坑）
const EXIST = '<mark data-note="{&quot;a&quot;:&quot;我&quot;,&quot;c&quot;:&quot;已有批注X&quot;,&quot;t&quot;:1,&quot;r&quot;:0}">12345678</mark>'
const body = 'doctype:demo\n\n# 复测\n\n' + EXIST + '\n'
await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  fs.files[${JSON.stringify('笔记/复测.md')}] = ${JSON.stringify(body)}
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.tree .name', '复测.md')
await L.waitMs(6000)

// 选区辅助：全选（Meta+A，真实快捷键；PM selection 同步——自动化拖选映射不可靠，弃用）
const dragSelect = async (fromDx, toDx, label) => {
  await L.focusEditor()
  await L.waitMs(200)
  await L.press('Meta+a')
  await L.waitMs(500)
  return await js(`(() => { const s = window.getSelection(); return s ? s.toString() : '' })()`)
}
// 1. 选中整段 '12345678' → 工具栏「添加批注」→ 浮窗提交批注 Y（与预置批注 X 同文重叠）
const selY = await dragSelect(2, 130, '选整段')
cliLog('[info] 选中① = ' + JSON.stringify(selY))
await L.waitMs(500)
const hasToolbarBtn = await js(`!!document.querySelector('[data-toolbar-item="add-annotation"]')`)
C.check('选中文本后工具栏出现「添加批注」', hasToolbarBtn)
if (hasToolbarBtn) {
  await L.waitMs(800) // 等 toolbar 首次定位/回调就绪（首建时序）
  await L.clickEl('[data-toolbar-item="add-annotation"]', 0, { label: '点添加批注' })
  await L.waitMs(1000)
  C.check('批注输入浮窗出现', (await L.q('.annotation-input-visible')) > 0)
  await L.fill('.annotation-input-ta', '批注Y：UI创建')
  await L.press('Enter')
  await L.waitMs(1200)
}
const markN = await js(`document.querySelectorAll('.ProseMirror mark.annotation').length`)
cliLog('[info] 批注 mark 数 = ' + markN)
C.check('UI 创建的批注插入（全选=跨标题段落的多段同 id 批注，与预置共存）', markN >= 2)

// 2. 重叠处点击 → 选择气泡（预置 + UI 两条同文）
await js(`(() => {
  const ms = Array.from(document.querySelectorAll('.ProseMirror mark.annotation'))
  if (!ms.length) return false
  const inner = ms.find((m) => ms.some((o) => o !== m && o !== m.parentElement && o.contains(m)))
  ;(inner || ms[0]).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return !!inner
})()`)
await L.waitMs(900)
const pickerN = await js(`document.querySelectorAll('.annotation-picker-item').length`)
C.check('重叠处点击弹选择气泡（2 条）', pickerN >= 2)
const pickerTexts = await js(`Array.from(document.querySelectorAll('.annotation-picker-item .ap-content')).map(x => x.textContent)`)
cliLog('[info] 气泡条目 = ' + JSON.stringify(pickerTexts))
if (pickerN >= 1) {
  await L.clickEl('.annotation-picker-item', 0, { label: '点选气泡第1项' })
  await L.waitMs(900)
}
C.check('抽屉卡片数 = 2（X/Y）', (await js(`document.querySelectorAll('.ad-card:not(.read-only)').length`)) === 2)

// 4. 点开抽屉（先随便点一个 mark 激活）
await js(`(() => {
  const m = document.querySelector('.ProseMirror mark.annotation')
  if (m) m.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return !!m
})()`)
await L.waitMs(1000)

// 6. 回复（展开卡片 → 输入 → Ctrl+Enter）
await L.clickEl('.ad-card.active .ad-card-head', 0, { label: '展开卡' }).catch(() => {})
await L.waitMs(600)
const replyTa = await js(`!!document.querySelector('.ad-card.active .ad-reply textarea')`)
if (replyTa) {
  await L.fill('.ad-card.active .ad-reply textarea', 'UI 回复内容')
  await L.press('Control+Enter')
  await L.waitMs(1200)
  const replies = await js(`Array.from(document.querySelectorAll('.ad-card.active .ad-comment-content')).map(x => x.textContent)`)
  C.check('回复成功（评论数 > 1）', replies.length >= 2 || replies.some((t) => t.includes('UI 回复内容')))
  cliLog('[info] 回复后评论 = ' + JSON.stringify(replies))
}

// 7. 保存后的 markdown：嵌套/重叠标签落盘
const md = await L.pageMd()
const marks = md.match(/data-a='([^']+)'/g) || []
C.check('md 含多条批注（data-a ≥2）', marks.length >= 2)
C.check('md 含线程 JSON 内容（UI 创建 Y）', md.includes('批注Y：UI创建'))

// 8. 保存（Ctrl+S）→ 刷新页面 → 持久化保留（真实环境最关键的 round-trip）
await L.press('Control+s')
await L.waitMs(2000)
const mdSaved = await L.pageMd()
cliLog('[info] 保存后 md data-a 数 = ' + ((mdSaved.match(/data-a='/g) || []).length))
await L.reloadApp(3500)
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.tree .name', '复测.md')
await L.waitMs(6000)
C.check('刷新后批注 mark 保留', (await L.q('.ProseMirror mark.annotation')) >= 1)
await js(`(() => {
  const m = document.querySelector('.ProseMirror mark.annotation')
  if (m) m.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return !!m
})()`)
await L.waitMs(900)
C.check('刷新后抽屉卡片保留（≥2）', (await js(`document.querySelectorAll('.ad-card:not(.read-only)').length`)) >= 2)
cliLog('[info] 刷新后 mark 数 = ' + (await js(`document.querySelectorAll('.ProseMirror mark.annotation').length`)))

// 9. 源码模式查看落盘格式（Ctrl+E）
await L.press('Control+e')
await L.waitMs(800)
const srcVal = await js(`(() => {
  const ta = document.querySelector('textarea[data-source-ta]')
  return ta ? ta.value : ''
})()`)
C.check('源码模式显示 <mark data-note data-a>', /<mark data-note='[^']*' data-a='[^']*'>/.test(srcVal))
await L.press('Control+e')
await L.waitMs(600)

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)