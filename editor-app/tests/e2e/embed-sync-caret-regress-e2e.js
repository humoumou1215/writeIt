// embed-sync-caret-regress —— 验证修复A（update 返回 true）：光标保持 + 输入落点 + 物化内容显示
const C = L.newChecker()
const task = await L.acquireTaskSpace('embed-sync-caret-regress')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')
const AP = '.editor-pane:not([style*="display: none"])'
const MK = 'milkdown-note-mock-fs-v2'
const blockTexts = () => js(
  `[...document.querySelectorAll('${AP} .ref-file-block:not(.readonly) .ref-file-block-content')].map(e => e.textContent || '')`
)
const selDetail = () => js(`(() => {
  const s = window.getSelection()
  if (!s || s.rangeCount === 0) return 'no-sel'
  const r = s.getRangeAt(0)
  const blocks = [...document.querySelectorAll('${AP} .ref-file-block-content')]
  const idx = blocks.findIndex(b => b.contains(r.startContainer))
  return 'block:' + idx + (s.isCollapsed ? '/col' : '/range')
})()`)
await js(`(() => {
  const fs = JSON.parse(localStorage.getItem(${L.J(MK)}) || '{}')
  fs.files['probe.md'] = ['# 探针','','开场段落第一行','','![[数据库字段引用]]','','![[数据库字段引用]]','','结尾段落末行'].join('\\n')
  localStorage.setItem(${L.J(MK)}, JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.clickText('.tree .name', 'probe.md', { label: '打开 probe' })
await L.waitMs(6000)
const bl0 = await blockTexts()
cliLog('[init] 块数: ' + bl0.length + ' 块1含源内容: ' + bl0[0].includes('数据库字段引用演示4444'))
await js(`(() => {
  const es = [...document.querySelectorAll('${AP} .ref-file-block:not(.readonly) .ref-file-block-content')]
  window.__b1 = es[0] || null
  return true
})()`)
// 点击块1 → 输入 → 检查落点 + 重建 + 光标
await L.clickEl(`${AP} .ref-file-block:not(.readonly) .ref-file-block-content`, 0, { label: '点块1' })
await L.waitMs(400)
cliLog('[点击后] sel: ' + (await selDetail()))
await L.type('1')
await L.waitMs(400)
cliLog('[输入后] sel: ' + (await selDetail()))
const rb = await js(`(() => {
  const es = [...document.querySelectorAll('${AP} .ref-file-block:not(.readonly) .ref-file-block-content')]
  return { b1Same: es[0] === window.__b1, cnt: es.length }
})()`)
cliLog('[输入后] 重建检测: ' + JSON.stringify(rb))
const bl1 = await blockTexts()
cliLog('[输入后] 块1尾: ' + JSON.stringify(bl1[0].slice(-60)))
cliLog('[输入后] 块2尾: ' + JSON.stringify(bl1[1].slice(-60)))
cliLog('[输入后] 块1长度: ' + bl1[0].length + ' 块2长度: ' + bl1[1].length)
C.check('块1 NodeView 未重建（DOM 复用）', rb.b1Same === true)
C.check('光标仍在块内', String(await selDetail()).startsWith('block:0'))
const errs = await L.errors()
cliLog('\n== 错误 =='); cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)